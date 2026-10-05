import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Public download forms on jumin.mois.go.kr, inspected 2026-10-05.
const SOURCES = {
  population: ["downloadCsv.do", "month"],
  ages: ["downloadCsvAge.do", "month"],
  onePerson: ["downloadCsvEtc.do", "households"],
  births: ["downloadCsvEtc.do", "birth"],
  deaths: ["downloadCsvEtc.do", "death"],
};
// Official jurisdiction evidence is listed in docs/nurimap-official-data-access.md.
export const BRANCH_PARENTS = {
  "4824089000": "4824051000", // 신수출장소 → 동서동
  "4827025100": "4827025000", // 임천출장소 → 삼랑진읍
  "4831036600": "4831036000", // 가조출장소 → 사등면
  "4831038500": "4831038000", // 칠천출장소 → 하청면
  "4831039500": "4831039000", // 외포출장소 → 장목면
};

export function parseOfficialCsv(text) {
  const records = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === "," || c === "\n")) {
      row.push(field.replace(/\r$/, "")); field = "";
      if (c === "\n") { records.push(row); row = []; }
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (field || row.length) { row.push(field.replace(/\r$/, "")); records.push(row); }
  const headers = records.shift()?.map((v) => v.replace(/^\uFEFF/, ""));
  if (!headers || headers[0] !== "행정구역") throw new Error("Not an official resident CSV");
  return records.filter((r) => r.some(Boolean)).map((r) => {
    if (r.length !== headers.length) throw new Error("CSV column count mismatch");
    return Object.fromEntries(headers.map((h, i) => [h, r[i]]));
  });
}

function indexed(rows) {
  const map = new Map();
  for (const row of rows) {
    const code = row["행정구역"]?.match(/\((\d{10})\)\s*$/)?.[1];
    if (!code || map.has(code)) throw new Error("Missing or duplicate official region code");
    map.set(code, row);
  }
  return map;
}

function count(row, header) {
  const raw = row?.[header];
  if (typeof raw !== "string" || !/^\d[\d,]*$/.test(raw.trim())) throw new Error(`Missing or invalid count: ${header}`);
  const value = Number(raw.replaceAll(",", ""));
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid count: ${header}`);
  return value;
}

export function mergeOfficialResidents(base, sourceMonths) {
  const months = [...sourceMonths.keys()].sort();
  const tables = new Map(months.map((month) => [month, Object.fromEntries(
    Object.entries(sourceMonths.get(month)).map(([dataset, rows]) => [dataset, indexed(rows)]),
  )]));
  const regions = base.regions.map((region) => {
    const values = months.map((month) => {
      const table = tables.get(month);
      const prefix = month.replace("-", "년") + "월_";
      const value = (dataset, header) => {
        const codes = [region.adm_cd2, ...Object.keys(BRANCH_PARENTS).filter((code) => BRANCH_PARENTS[code] === region.adm_cd2)];
        return codes.reduce((sum, code) => {
          const result = table[dataset]?.get(code);
          if (!result) throw new Error(`Missing ${dataset}: ${code}/${month}`);
          return sum + count(result, header);
        }, 0);
      };
      const population = value("population", prefix + "총인구수");
      const households = value("population", prefix + "세대수");
      const ages = Array.from({ length: 101 }, (_, i) => value("ages", prefix + "계_" + (i === 100 ? "100세 이상" : `${i}세`)));
      if (ages.reduce((a, b) => a + b, 0) !== population || value("ages", prefix + "계_총인구수") !== population) throw new Error(`Age total mismatch: ${region.adm_cd2}/${month}`);
      const onePersonHouseholds = value("onePerson", prefix + "1인세대");
      if (onePersonHouseholds > households) throw new Error(`One-person households exceed households: ${region.adm_cd2}/${month}`);
      const births = value("births", prefix + "계");
      const deaths = value("deaths", prefix + "계");
      if (!Number.isFinite(region.areaSquareKm) || region.areaSquareKm <= 0) throw new Error("Invalid boundary area");
      return { population, households, populationDensity: population / region.areaSquareKm,
        youthPopulation: ages.slice(0, 15).reduce((a, b) => a + b, 0),
        workingAgePopulation: ages.slice(15, 65).reduce((a, b) => a + b, 0),
        elderlyPopulation: ages.slice(65).reduce((a, b) => a + b, 0),
        onePersonHouseholds, births, deaths, naturalChange: births - deaths };
    });
    return { ...region, months, ...Object.fromEntries(Object.keys(values[0]).map((metric) => [metric, values.map((v) => v[metric])])) };
  });
  return { ...base, mode: "live", referenceMonth: months.at(-1), months, regions };
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const latest = process.argv[2] ?? "2026-09";
  if (!process.argv[3]) throw new Error("검증된 시설 기준 스냅샷 파일 경로가 필요합니다.");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(latest)) throw new Error("Expected latest month YYYY-MM");
  const [year, month] = latest.split("-").map(Number);
  const months = Array.from({ length: 13 }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 13 + i, 1));
    return d.toISOString().slice(0, 7);
  });
  const cache = path.join(os.tmpdir(), "nurimap-official-residents");
  await mkdir(cache, { recursive: true });
  const sourceMonths = new Map();
  const files = [];
  // Sequential requests keep load on the official download service bounded.
  for (const month of months) {
    const datasets = {};
    for (const [dataset, [endpoint, category]] of Object.entries(SOURCES)) {
      const filename = `${dataset}${dataset === "onePerson" ? "-households" : ""}-${month}.csv`;
      const cached = path.join(cache, filename);
      let bytes;
      try { bytes = await readFile(cached); } catch {
        const [y, m] = month.split("-");
        const params = new URLSearchParams({ sltOrgType: "2", sltOrgLvl1: "4800000000", sltOrgLvl2: "", gender: "", genderPer: "", generation: "generation", sum: "sum", sltUndefType: "", searchYearStart: y, searchMonthStart: m, searchYearEnd: y, searchMonthEnd: m, sltOrderType: "1", sltOrderValue: "ASC", sltArgTypes: dataset === "ages" ? "1" : "10", sltArgTypeA: "0", sltArgTypeB: "100", sttsGbn: "admm", category });
        const response = await fetch(`https://jumin.mois.go.kr/${endpoint}?searchYearMonth=month&xlsStats=3&downType=Csv`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: params, signal: AbortSignal.timeout(60_000) });
        if (!response.ok || !response.headers.get("content-disposition")?.includes("attachment")) throw new Error(`Official download failed: ${dataset}/${month}`);
        bytes = Buffer.from(await response.arrayBuffer());
        parseOfficialCsv(new TextDecoder("euc-kr").decode(bytes));
        await writeFile(cached, bytes);
      }
      datasets[dataset] = parseOfficialCsv(new TextDecoder("euc-kr").decode(bytes));
      files.push({ dataset, month, filename, source: `https://jumin.mois.go.kr/${endpoint}`, category, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), rows: datasets[dataset].length });
    }
    sourceMonths.set(month, datasets);
    console.log(`Official CSV acquired: ${month}`);
  }
  const basePath = process.argv[3];
  const baseBytes = await readFile(basePath);
  const base = JSON.parse(baseBytes.toString("utf8"));
  let facilityMetadata = {};
  if (process.argv[3]) {
    try { facilityMetadata = JSON.parse(await readFile(basePath + ".meta.json", "utf8")); } catch { /* Source dates are optional, never inferred. */ }
  }
  const snapshot = mergeOfficialResidents(base, sourceMonths);
  snapshot.sourceNotes = [
    ...base.sourceNotes.filter((note) => !(/인구|세대|출생|사망/.test(note) && /합성|기준 스냅샷|실데이터 연결 시/.test(note)))
      .filter((note, index, all) => !/HIRA.*갱신/.test(note) || index === all.findLastIndex((v) => /HIRA.*갱신/.test(v)))
      .map((note) => note.replace("경상남도 행정동 경계를 기준으로 만든 결정론적 시연 데이터입니다.", "경상남도 행정동 경계를 기준으로 구성한 자료입니다.")),
    `행정안전부 주민등록 인구통계 공식 CSV: ${months[0]}~${latest}, 경남 ${snapshot.regions.length}개 행정동 전수. 총인구·세대·연령별 인구·1인세대·출생등록·사망말소를 실제 자료로 교체했습니다.`,
    "주민등록 인구는 매월 말일 기준 거주자·거주불명자·재외국민이며 외국인은 제외합니다. 1인세대는 주민등록 세대 기준으로 통계청 1인가구와 다릅니다.",
    "출생은 주민등록기준 출생등록, 사망은 주민등록기준 사망말소입니다. 발생일 기준 인구동향통계와 다르며 자연증가는 출생등록−사망말소로 계산합니다.",
    "공식 출처: https://jumin.mois.go.kr/ (행정안전부 주민등록 인구통계); 공공데이터포털 관련 데이터 이용허락범위 제한 없음.",
    "공식 CSV의 별도 출장소 5곳(신수·임천·가조·칠천·외포)은 관할 경계 동서동·삼랑진읍·사등면·하청면·장목면에 합산했습니다.",
  ];
  await writeFile(path.join(root, "public/data/official-snapshot.json"), JSON.stringify(snapshot));
  await writeFile(path.join(root, "public/data/official-residents-manifest.json"), JSON.stringify({ acquiredAt: new Date().toISOString(), provider: "행정안전부", source: "https://jumin.mois.go.kr/", months, regions: snapshot.regions.length, facilities: { ...facilityMetadata, count: base.facilities.length, baseSha256: createHash("sha256").update(baseBytes).digest("hex"), notes: base.sourceNotes.filter((note) => /HIRA.*갱신|시설.*PRNG/.test(note)).slice(-1) }, files }, null, 2));
  console.log(`Official snapshot written: ${snapshot.regions.length} regions, ${months.length} months`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
