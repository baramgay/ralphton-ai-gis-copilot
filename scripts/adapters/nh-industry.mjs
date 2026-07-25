import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";

/**
 * NH 업종별 카드매출 → 상권 업종 구성 큐브.
 *
 * 원천: 경상남도_1_유입지별카드매출_YYYYMM.csv (헤더 없음, 콤마, UTF-8 BOM)
 * 컬럼: 0 행정동코드(10) | 1 기준일자 | 2 업종_대 | 3 업종_중 | 4 업종_소 |
 *       5 이용자_시도 | 6 이용자_시군구 | 7 농협건수 | 8 농협금액 | 9 전체건수 | 10 전체금액
 *
 * 업종_대는 표준산업분류(11차) 대분류 코드다((매핑테이블)NH업종_표준산업분류(11차)).
 * 카드매출 총액만으로는 "무엇을 파는 상권인지" 알 수 없어, 정책에서 자주 쓰는 5개
 * 업종군의 매출 비중을 만든다. 비중이라 상권 규모와 무관하게 동 간 비교가 된다.
 */

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\NH 데이터";
const INPUT_DIR = process.env.NH_DIR ?? DEFAULT_INPUT_DIR;

export const COL = { dong: 0, industry: 2, amountAll: 10 };

/** 표준산업분류 대분류 코드 → 정책 업종군. 그 외(제조·건설 등)는 비중 대상에서 제외. */
export const INDUSTRY_GROUPS = {
  I: "food", // 숙박 및 음식점업
  G: "retail", // 도매 및 소매업
  Q: "health", // 보건업 및 사회복지 서비스업
  R: "leisure", // 예술, 스포츠 및 여가관련 서비스업
  P: "education", // 교육 서비스업
};

// --- pure helpers ---

export function cleanDongCode(raw) {
  return String(raw ?? "").replace(/^\uFEFF/, "").replace(/[^0-9]/g, "");
}

export function industryGroupOf(code) {
  return INDUSTRY_GROUPS[String(code ?? "").trim()] ?? null;
}

/** acc: Map<dong, { total, food, retail, health, leisure, education }> — 전체카드 금액(원). */
export function accumulateLine(acc, line) {
  if (!line) return acc;
  const f = line.split(",");
  const dong = cleanDongCode(f[COL.dong]);
  if (dong.length !== 10) return acc;
  const amount = Number(f[COL.amountAll]);
  if (!Number.isFinite(amount)) return acc;

  const entry =
    acc.get(dong) ?? { total: 0, food: 0, retail: 0, health: 0, leisure: 0, education: 0 };
  entry.total += amount;
  const group = industryGroupOf(f[COL.industry]);
  if (group) entry[group] += amount;
  acc.set(dong, entry);
  return acc;
}

export function aggregateRows(lines) {
  const acc = new Map();
  for (const line of lines) accumulateLine(acc, line);
  return acc;
}

/** 각 업종군 비중(%) = 해당 업종 매출 ÷ 그 동의 전체 카드매출 × 100. */
export function finalizeShares(entry) {
  const pct = (part) => (entry.total > 0 ? (part / entry.total) * 100 : null);
  return {
    food_share: pct(entry.food),
    retail_share: pct(entry.retail),
    health_share: pct(entry.health),
    leisure_share: pct(entry.leisure),
    education_share: pct(entry.education),
  };
}

// --- streaming ---

async function aggregateMonthFile(filePath) {
  const rl = readline.createInterface({
    input: createReadStream(filePath, "utf8"),
    crlfDelay: Infinity,
  });
  const acc = new Map();
  for await (const line of rl) accumulateLine(acc, line);
  return acc;
}

function round(value, decimals) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const METRIC_KEYS = ["food_share", "retail_share", "health_share", "leisure_share", "education_share"];

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "layers", "nh-industry.json");

  const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));
  const monthLabels = [];
  const perDong = new Map();
  for (const feature of boundary.features) {
    const series = {};
    for (const key of METRIC_KEYS) series[key] = new Array(12).fill(null);
    perDong.set(feature.properties.adm_cd2, series);
  }

  const unmatched = new Set();
  for (let month = 1; month <= 12; month += 1) {
    const yyyymm = `2025${String(month).padStart(2, "0")}`;
    monthLabels.push(`2025-${String(month).padStart(2, "0")}`);
    const filePath = path.join(INPUT_DIR, `경상남도_1_유입지별카드매출_${yyyymm}.csv`);
    const stats = await aggregateMonthFile(filePath);

    for (const [dong, entry] of stats) {
      const series = perDong.get(dong);
      if (!series) {
        unmatched.add(dong);
        continue;
      }
      const shares = finalizeShares(entry);
      for (const key of METRIC_KEYS) series[key][month - 1] = round(shares[key], 1);
    }
    console.log(`${yyyymm} NH 업종 집계 완료 (${stats.size}개 동)`);
  }

  if (unmatched.size > 0) {
    console.warn(`경계에 없는 동 코드 ${unmatched.size}개 무시: ${[...unmatched].slice(0, 20).join(", ")}`);
  }

  const cells = boundary.features.map((feature) => {
    const properties = feature.properties;
    const areaKm2 = turfArea(feature) / 1_000_000;
    const [lng, lat] = pointOnFeature(feature).geometry.coordinates;
    return {
      code: properties.adm_cd2,
      name: properties.adm_nm,
      point: { lat, lng },
      areaKm2,
      series: perDong.get(properties.adm_cd2),
    };
  });

  for (const cell of cells) {
    for (const [key, values] of Object.entries(cell.series)) {
      if (values.length !== 12) throw new Error(`${cell.code} ${key} 길이 오류: ${values.length}`);
    }
  }

  const cube = {
    layerId: "nh-industry",
    adminLevel: "dong",
    referenceMonth: "2025-12",
    months: monthLabels,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube));
  console.log(`NH 업종구성 큐브 생성 완료 (${outputPath}): ${cells.length}개 동, ${monthLabels.length}개월`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(`NH 업종구성 큐브 생성 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
