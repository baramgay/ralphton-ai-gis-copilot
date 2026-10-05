"""Independent standard-library CSV audit; never imports the JavaScript adapter."""
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import sys
import tempfile

root = Path(__file__).resolve().parent.parent
cache = Path(tempfile.gettempdir()) / "nurimap-official-residents"
snapshot = json.loads((root / "public/data/official-snapshot.json").read_text(encoding="utf-8"))
manifest = json.loads((root / "public/data/official-residents-manifest.json").read_text(encoding="utf-8"))
checks = 0


def check(condition, context):
    global checks
    checks += 1
    if not condition:
        raise AssertionError(context)


def number(row, field):
    value = row[field].replace(",", "")
    check(value.isdigit(), field)
    return int(value)


for month_index, month in enumerate(snapshot["months"]):
    prefix = month.replace("-", "년") + "월_"
    tables = {}
    for dataset in ["population", "ages", "onePerson", "births", "deaths"]:
        entry = next(f for f in manifest["files"] if f["dataset"] == dataset and f["month"] == month)
        file = cache / entry["filename"]
        raw = file.read_bytes()
        check(hashlib.sha256(raw).hexdigest() == entry["sha256"], str(file))
        with file.open(encoding="cp949", newline="") as source:
            rows = list(csv.DictReader(source))
        tables[dataset] = {}
        for row in rows:
            code = re.search(r"\((\d{10})\)\s*$", row["행정구역"]).group(1)
            check(code not in tables[dataset], "duplicate " + code)
            tables[dataset][code] = row
    district_totals = {}
    for region in snapshot["regions"]:
        code = region["adm_cd2"]
        branches = {"4824051000": "4824089000", "4827025000": "4827025100", "4831036000": "4831036600", "4831038000": "4831038500", "4831039000": "4831039500"}
        component_codes = [code] + ([branches[code]] if code in branches else [])
        def source_value(dataset, field):
            return sum(number(tables[dataset][component], field) for component in component_codes)
        pop = source_value("population", prefix + "총인구수")
        households = source_value("population", prefix + "세대수")
        ages = [source_value("ages", prefix + "계_" + ("100세 이상" if age == 100 else f"{age}세")) for age in range(101)]
        one = source_value("onePerson", prefix + "1인세대")
        births = source_value("births", prefix + "계")
        deaths = source_value("deaths", prefix + "계")
        expected = {"population": pop, "households": households, "youthPopulation": sum(ages[:15]), "workingAgePopulation": sum(ages[15:65]), "elderlyPopulation": sum(ages[65:]), "onePersonHouseholds": one, "births": births, "deaths": deaths, "naturalChange": births-deaths}
        check(sum(ages) == pop, "age total " + code)
        check(one <= households, "one-person " + code)
        for metric, value in expected.items():
            check(region[metric][month_index] == value, f"{month}/{code}/{metric}")
        check(math.isclose(region["populationDensity"][month_index], pop / region["areaSquareKm"], rel_tol=1e-12), "density " + code)
        values = district_totals.setdefault(code[:5] + "00000", [0] * 5)
        for i, value in enumerate([pop, households, one, births, deaths]):
            values[i] += value
    # Compare sum of all child dongs to the source's direct district rows, not another aggregation implementation.
    for district, values in district_totals.items():
        for i, (dataset, field) in enumerate([("population", "총인구수"), ("population", "세대수"), ("onePerson", "1인세대"), ("births", "계"), ("deaths", "계")]):
            check(values[i] == number(tables[dataset][district], prefix + field), f"district {month}/{district}/{dataset}")
    for i, (dataset, field) in enumerate([("population", "총인구수"), ("population", "세대수"), ("onePerson", "1인세대"), ("births", "계"), ("deaths", "계")]):
        check(sum(v[i] for v in district_totals.values()) == number(tables[dataset]["4800000000"], prefix + field), f"province {month}/{dataset}")

result = {"checks": checks, "months": len(snapshot["months"]), "regions": len(snapshot["regions"]), "sourceFiles": len(manifest["files"]), "failures": 0, "method": "Python csv/int; raw SHA256; source direct district and province totals; 101 individual age counts; all output metrics"}
if len(sys.argv) > 1:
    Path(sys.argv[1]).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False))
