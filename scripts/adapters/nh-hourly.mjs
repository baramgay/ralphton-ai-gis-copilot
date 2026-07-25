import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";

/**
 * NH 시간대별 카드매출 → 소비 시간대 큐브.
 *
 * 원천: 경상남도_3_시간대별카드매출_YYYYMM.csv (헤더 없음, 콤마, UTF-8 BOM)
 * 컬럼(명세서 "3. 시간대별"): 0 행정동코드(10) | 1 개인/법인 | 2 기준일자 | 3 소비 시간대('00'~'23')
 *   | 4~6 업종 대·중·소 | 7 농협건수 | 8 농협금액 | 9 전체건수 | 10 전체금액
 *
 * 주간(09~18)·야간(22~05) 구간은 SKT 주야간인구 어댑터와 동일하게 맞췄다. 같은 구간을
 * 써야 "야간에 사람은 있는데 소비는 없는 동" 같은 교차분석이 성립한다.
 */

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\NH 데이터";
const INPUT_DIR = process.env.NH_DIR ?? DEFAULT_INPUT_DIR;

export const COL = { dong: 0, hour: 3, amountAll: 10 };

const DAY_HOURS = new Set(["09", "10", "11", "12", "13", "14", "15", "16", "17", "18"]);
const NIGHT_HOURS = new Set(["22", "23", "00", "01", "02", "03", "04", "05"]);

// --- pure helpers ---

export function cleanDongCode(raw) {
  return String(raw ?? "").replace(/^\uFEFF/, "").replace(/[^0-9]/g, "");
}

export function normalizeHour(raw) {
  const text = String(raw ?? "").trim();
  return text.length === 1 ? `0${text}` : text;
}

/** acc: Map<dong, { day, night, total }> — 전체카드 이용금액(원) 합계. */
export function accumulateLine(acc, line) {
  if (!line) return acc;
  const f = line.split(",");
  const dong = cleanDongCode(f[COL.dong]);
  if (dong.length !== 10) return acc;
  const amount = Number(f[COL.amountAll]);
  if (!Number.isFinite(amount)) return acc;

  const hour = normalizeHour(f[COL.hour]);
  const entry = acc.get(dong) ?? { day: 0, night: 0, total: 0 };
  entry.total += amount;
  if (DAY_HOURS.has(hour)) entry.day += amount;
  else if (NIGHT_HOURS.has(hour)) entry.night += amount;
  acc.set(dong, entry);
  return acc;
}

export function aggregateRows(lines) {
  const acc = new Map();
  for (const line of lines) accumulateLine(acc, line);
  return acc;
}

/**
 * 금액은 백만원, 야간 비중은 전체 대비 %.
 * 주간·야간 어느 구간에도 없는 19~21시 매출이 있으므로 day+night는 total보다 작다.
 */
export function finalizeStats(entry) {
  const toMillion = (won) => won / 1_000_000;
  return {
    day_sales: toMillion(entry.day),
    night_sales: toMillion(entry.night),
    night_share: entry.total > 0 ? (entry.night / entry.total) * 100 : null,
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

const METRIC_KEYS = ["day_sales", "night_sales", "night_share"];

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "layers", "nh-hourly.json");

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
    const filePath = path.join(INPUT_DIR, `경상남도_3_시간대별카드매출_${yyyymm}.csv`);
    const stats = await aggregateMonthFile(filePath);

    for (const [dong, entry] of stats) {
      const series = perDong.get(dong);
      if (!series) {
        unmatched.add(dong);
        continue;
      }
      const finalized = finalizeStats(entry);
      series.day_sales[month - 1] = round(finalized.day_sales, 1);
      series.night_sales[month - 1] = round(finalized.night_sales, 1);
      series.night_share[month - 1] = round(finalized.night_share, 1);
    }
    console.log(`${yyyymm} NH 시간대 집계 완료 (${stats.size}개 동)`);
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
    layerId: "nh-hourly",
    adminLevel: "dong",
    referenceMonth: "2025-12",
    months: monthLabels,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube));
  console.log(`NH 시간대 소비 큐브 생성 완료 (${outputPath}): ${cells.length}개 동, ${monthLabels.length}개월`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(`NH 시간대 소비 큐브 생성 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
