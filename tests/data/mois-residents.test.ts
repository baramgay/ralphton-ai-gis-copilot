import { describe, expect, it } from "vitest";
// @ts-expect-error Node adapter is also exercised directly by the acquisition CLI.
import { parseOfficialCsv, mergeOfficialResidents } from "../../scripts/adapters/mois-residents.mjs";

const month = "2026-06";
const code = "4817025000";
function csv(headers: string[], values: string[]) {
  return [headers, values].map((row) => row.map((v) => `"${v.replaceAll('"', '""')}"`).join(",")).join("\r\n");
}
function sources() {
  const prefix = "2026년06월_계_";
  const ages = Array.from({ length: 101 }, (_, i) => i === 100 ? "100세 이상" : `${i}세`);
  const counts = ages.map((_, i) => [0, 14, 15, 64, 65, 100].includes(i) ? String(i + 1) : "0");
  const district = `경상남도 진주시 문산읍(${code})`;
  return {
    population: parseOfficialCsv(csv(["행정구역", "2026년06월_총인구수", "2026년06월_세대수"], [district, "264", "200"])),
    ages: parseOfficialCsv(csv(["행정구역", prefix + "총인구수", ...ages.map((a) => prefix + a)], [district, "264", ...counts])),
    onePerson: parseOfficialCsv(csv(["행정구역", "2026년06월_1인세대"], [district, "120"])),
    births: parseOfficialCsv(csv(["행정구역", "2026년06월_계"], [district, "0"])),
    deaths: parseOfficialCsv(csv(["행정구역", "2026년06월_계"], [district, "7"])),
  };
}
const base = { months: [month], regions: [{ adm_cd2: code, areaSquareKm: 2, population: [999], facilities: [] }] };
describe("공식 주민등록 CSV", () => {
  it("따옴표 내부 천 단위 구분과 escaped quote를 보존한다", () => {
    expect(parseOfficialCsv('"행정구역","값"\r\n"가""나","1,234"\r\n')[0]).toEqual({ 행정구역: '가"나', 값: "1,234" });
  });
  it("0~14/15~64/65+ 경계와 실제 0 출생, 자연감소, 정확 밀도를 연결한다", () => {
    const result = mergeOfficialResidents(base, new Map([[month, sources()]]));
    expect(result.regions[0]).toMatchObject({ population: [264], households: [200], youthPopulation: [16], workingAgePopulation: [81], elderlyPopulation: [167], onePersonHouseholds: [120], births: [0], deaths: [7], naturalChange: [-7], populationDensity: [132] });
  });
  it.each(["population", "ages", "onePerson", "births", "deaths"])("%s 누락은 합성 유지나 0 대입 대신 실패한다", (dataset) => {
    const rows = sources();
    rows[dataset as keyof typeof rows] = [];
    expect(() => mergeOfficialResidents(base, new Map([[month, rows]]))).toThrow();
  });
  it("총인구와 연령합 불일치, 빈 세대수, 중복 행을 거부한다", () => {
    for (const defect of ["sum", "blank", "duplicate"]) {
      const rows = sources();
      if (defect === "sum") rows.ages[0]["2026년06월_계_0세"] = "2";
      if (defect === "blank") rows.population[0]["2026년06월_세대수"] = "";
      if (defect === "duplicate") rows.births.push(rows.births[0]);
      expect(() => mergeOfficialResidents(base, new Map([[month, rows]]))).toThrow();
    }
  });
  it("출장소 별도 인구는 관할 경계 동에 합쳐 시군구 분모에서 빠뜨리지 않는다", () => {
    const rows = sources();
    for (const dataset of Object.keys(rows) as Array<keyof typeof rows>) {
      const original = rows[dataset][0];
      rows[dataset] = [
        { ...original, 행정구역: "경상남도 사천시 동서동(4824051000)" },
        { ...original, 행정구역: "경상남도 사천시 신수출장소(4824089000)" },
      ];
    }
    const result = mergeOfficialResidents({ ...base, regions: [{ ...base.regions[0], adm_cd2: "4824051000" }] }, new Map([[month, rows]]));
    expect(result.regions[0]).toMatchObject({ population: [528], households: [400], elderlyPopulation: [334], births: [0], deaths: [14], naturalChange: [-14] });
  });
});
