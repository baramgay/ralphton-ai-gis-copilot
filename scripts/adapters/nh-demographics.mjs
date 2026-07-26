import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";

/**
 * NH 성연령별 카드매출 → 소비 주체 구성 큐브.
 *
 * 원천: 경상남도_2_성연령별카드매출_YYYYMM.csv (헤더 없음, 콤마, UTF-8 BOM)
 * 컬럼(명세서 "2. 성연령별"): 0 행정동코드(10) | 1 개인/법인 | 2 기준일자 | 3 성별 |
 *   4 연령구분 | 5~7 업종 대·중·소 | 8 농협건수 | 9 농협금액 | 10 전체건수 | 11 전체금액
 *
 * 연령구분 코드: '1.20대미만','2.2024','3.2529','4.3034','5.3539','6.4044','7.4549',
 * '8.5054','9.5559','10.6064','11.6569','12.70대이상','법인'
 *
 * 카드매출 총액(nh-consumption)만으로는 "누가 쓰는 상권인지"를 알 수 없다. 여기서는
 * 전체카드 이용금액을 연령대·성별·법인으로 나눠 구성비를 만든다. 구성비는 그 동의
 * 개인 소비 총액 대비 비율이라 상권 규모와 무관하게 비교할 수 있다.
 */

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\NH 데이터";
const INPUT_DIR = process.env.NH_DIR ?? DEFAULT_INPUT_DIR;

export const COL = { dong: 0, entity: 1, gender: 3, ageBand: 4, amountAll: 11 };

// 연령구분 코드 → 정책에서 쓰는 3개 구간.
const YOUTH_BANDS = new Set(["2.2024", "3.2529", "4.3034", "5.3539"]); // 20~39
const MIDDLE_BANDS = new Set(["6.4044", "7.4549", "8.5054", "9.5559"]); // 40~59
const SENIOR_BANDS = new Set(["10.6064", "11.6569", "12.70대이상"]); // 60+

// --- pure helpers ---

export function cleanDongCode(raw) {
  return String(raw ?? "").replace(/^\uFEFF/, "").replace(/[^0-9]/g, "");
}

/** 연령구분 코드를 정책 구간으로. 해당 없음(20대 미만·법인 등)은 null. */
export function ageGroupOf(band) {
  if (YOUTH_BANDS.has(band)) return "youth";
  if (MIDDLE_BANDS.has(band)) return "middle";
  if (SENIOR_BANDS.has(band)) return "senior";
  return null;
}

/**
 * acc: Map<dong, {personal, corporate, youth, middle, senior, female}>
 * 모두 전체카드 이용금액(원) 합계.
 */
export function accumulateLine(acc, line) {
  if (!line) return acc;
  const f = line.split(",");
  const dong = cleanDongCode(f[COL.dong]);
  if (dong.length !== 10) return acc;
  const amount = Number(f[COL.amountAll]);
  if (!Number.isFinite(amount)) return acc;

  const entry =
    acc.get(dong) ?? { personal: 0, corporate: 0, youth: 0, middle: 0, senior: 0, female: 0 };

  const isCorporate = f[COL.entity] === "법인";
  if (isCorporate) {
    entry.corporate += amount;
  } else {
    entry.personal += amount;
    const group = ageGroupOf(f[COL.ageBand]);
    if (group) entry[group] += amount;
    if (f[COL.gender] === "여성") entry.female += amount;
  }

  acc.set(dong, entry);
  return acc;
}

export function aggregateRows(lines) {
  const acc = new Map();
  for (const line of lines) accumulateLine(acc, line);
  return acc;
}

/** 구성비(%) 산출. 개인 소비가 없으면 비율은 null. */
export function finalizeShares(entry) {
  const personal = entry.personal;
  const total = entry.personal + entry.corporate;
  const pct = (part, base) => (base > 0 ? (part / base) * 100 : null);
  return {
    // 비중의 분모(개인+법인 전체 카드매출). 시군구 가중평균에 필요해 큐브에 함께 싣는다.
    card_sales: total > 0 ? total / 1_000_000 : null,
    youth_share: pct(entry.youth, personal),
    middle_share: pct(entry.middle, personal),
    senior_share: pct(entry.senior, personal),
    female_share: pct(entry.female, personal),
    corporate_share: pct(entry.corporate, total),
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

const METRIC_KEYS = ["card_sales", "youth_share", "middle_share", "senior_share", "female_share", "corporate_share"];

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "layers", "nh-demographics.json");

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
    const filePath = path.join(INPUT_DIR, `경상남도_2_성연령별카드매출_${yyyymm}.csv`);
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
    console.log(`${yyyymm} NH 성연령 집계 완료 (${stats.size}개 동)`);
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
    layerId: "nh-demographics",
    adminLevel: "dong",
    referenceMonth: "2025-12",
    months: monthLabels,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube));
  console.log(`NH 소비주체 큐브 생성 완료 (${outputPath}): ${cells.length}개 동, ${monthLabels.length}개월`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(`NH 소비주체 큐브 생성 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
