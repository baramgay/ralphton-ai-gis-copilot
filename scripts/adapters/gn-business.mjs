import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";

/**
 * 경상남도 기업정보 → 기업정보(business) 큐브.
 *
 * 원천(data.go.kr 15123783, `경상남도_기업정보.zip`, cc-zero, 제공 경상남도):
 *   cp949 CSV. 행 = 기업 1곳. 열: 데이터기준일, 행정동코드, 인력그룹, 대표자연령,
 *   기업형태, 신용등급, 장애인기업여부, 보증건수, 보증금액, 사고건수, 사고금액.
 *   2015~2019년 1회성. 행정동코드는 10자리(시군구까지만 유의미 — 뒤가 0이다).
 *
 * 설계 결정(KOSIS 패턴을 따른다):
 * - 시군구 단위 집계 후 소속 읍면동에 같은 값을 복제한다. 시군구 값을 동에 임의
 *   배분하지 않는다. 지표는 전부 `scope: "sgg"` + 가중치 없는 평균이라 되접으면
 *   원래 값이 그대로 나온다(`sum`을 쓰면 동 수만큼 곱해진다).
 * - 월 축은 연말(12월). 추세를 물으면 "연간"임이 보이도록 한계에 적는다.
 * - 행정동코드가 비어 있어 시군구에 붙일 수 없는 행은 세지 않는다(연 119~183건).
 *   조용히 버리는 게 아니라 여기서 센다 — 아래 로그와 한계 문장에 남는다.
 */

const INPUT_FILE = process.env.GN_HUB_BUSINESS_CSV ?? null;
const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\경남빅데이터허브";

function inputPath(projectRoot) {
  if (INPUT_FILE) return INPUT_FILE;
  return path.join(DEFAULT_INPUT_DIR, "경상남도_기업정보.csv");
}

/** 법인으로 세는 기업형태. 원자료 표기 그대로 둔다(바꾸면 다음 갱신 때 어긋난다). */
export const CORP_TYPES = new Set([
  "주식회사",
  "유한회사",
  "합자회사",
  "합명회사",
  "협동조합",
  "영농조합",
  "사단법인",
]);

export function isGyeongnamSgg(code) {
  return typeof code === "string" && /^\d{10}$/.test(code) && code.startsWith("48");
}

function yearOf(dateText) {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec((dateText ?? "").trim());
  return match ? match[1] : null;
}

/**
 * CSV 한 줄 → 집계 키. 쓸 수 없는 행은 null(호출자가 센다).
 * 행정동코드가 시군구까지만 유의미하므로 앞 5자리로 접는다.
 */
export function parseBusinessRow(cells) {
  const year = yearOf(cells[0]);
  const adm = (cells[1] ?? "").trim();
  const type = (cells[4] ?? "").trim();
  if (!year || !isGyeongnamSgg(adm) || !type) return null;
  return { year, sgg5: adm.slice(0, 5), corp: CORP_TYPES.has(type) };
}

/** `${year}|${sgg5}` → { count, corp }. 행 하나가 기업 1곳이다. */
export function accumulateBusiness(acc, parsed) {
  if (!parsed) {
    acc.skipped += 1;
    return acc;
  }
  const key = `${parsed.year}|${parsed.sgg5}`;
  const entry = acc.cells.get(key) ?? { count: 0, corp: 0 };
  entry.count += 1;
  if (parsed.corp) entry.corp += 1;
  acc.cells.set(key, entry);
  return acc;
}

export function emptyAcc() {
  return { cells: new Map(), skipped: 0 };
}

export function yearLabel(year) {
  return `${year}-12`;
}

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "layers", "gn-business.json");
  const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));

  const raw = await readFile(inputPath(projectRoot));
  // euc-kr에 없는 바이트가 있으면 깨진 채로 집계하지 않고 여기서 죽는다.
  const text = new TextDecoder("euc-kr", { fatal: true }).decode(raw);
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new Error("기업정보 CSV가 비어 있습니다.");
  const header = lines[0].split(",");
  if (header[0] !== "데이터기준일" || header[1] !== "행정동코드" || header[4] !== "기업형태") {
    throw new Error(`기업정보 CSV 헤더가 바뀌었습니다: ${lines[0].slice(0, 60)}`);
  }

  const acc = emptyAcc();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    accumulateBusiness(acc, parseBusinessRow(line.split(",")));
  }

  const years = [...new Set([...acc.cells.keys()].map((key) => key.split("|")[0]))].sort();
  if (years.length === 0) throw new Error("기업정보에서 연도를 찾지 못했습니다.");
  const monthLabels = years.map(yearLabel);

  const cells = boundary.features.map((feature) => {
    const properties = feature.properties;
    const areaKm2 = turfArea(feature) / 1_000_000;
    const [lng, lat] = pointOnFeature(feature).geometry.coordinates;
    const sgg5 = properties.adm_cd2.slice(0, 5);
    const firmCount = monthLabels.map((month, i) => acc.cells.get(`${years[i]}|${sgg5}`)?.count ?? null);
    const corpShare = monthLabels.map((month, i) => {
      const entry = acc.cells.get(`${years[i]}|${sgg5}`);
      if (!entry || entry.count === 0) return null;
      return (entry.corp / entry.count) * 100;
    });
    return {
      code: properties.adm_cd2,
      name: properties.adm_nm,
      point: { lat, lng },
      areaKm2,
      series: { firm_count: firmCount, corp_share: corpShare },
    };
  });

  for (const cell of cells) {
    for (const [key, values] of Object.entries(cell.series)) {
      if (values.length !== monthLabels.length) throw new Error(`${cell.code} ${key} 길이 오류`);
    }
  }

  const cube = {
    layerId: "gn-business",
    adminLevel: "dong",
    referenceMonth: monthLabels[monthLabels.length - 1],
    months: monthLabels,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube));
  console.log(
    `경상남도 기업 큐브 생성 완료 (${outputPath}): ${cells.length}개 동, ${monthLabels.length}개년 [${monthLabels.join(",")}], 집계 제외 ${acc.skipped}행`,
  );
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(`기업 큐브 생성 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
