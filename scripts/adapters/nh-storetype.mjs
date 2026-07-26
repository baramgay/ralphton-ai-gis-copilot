import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";

/**
 * NH 업태별 카드매출 → 생활업종 큐브.
 *
 * 원천: 경상남도_1_유입지별카드매출_YYYYMM.csv (헤더 없음, 콤마, UTF-8 BOM)
 * 컬럼: 0 행정동코드(10) | 1 기준일자 | 2 업종_대 | 3 업종_중 | 4 업종_소 | … | 10 전체금액
 *
 * 업종 대분류(nh-industry)는 "도소매 66%"처럼 뭉뚱그려져 상권 성격이 잘 안 보인다.
 * 중분류는 대분류와 거의 1:1로 수렴해(G47이 대분류 G의 99%) 별도 정보가 없다. 반면
 * 소분류는 주유소·한식·편의점·커피전문점 같은 실제 업태를 드러낸다.
 *
 * 정책에서 자주 보는 생활업종만 골라 매출 비중으로 만든다. 비중이라 상권 규모와 무관하게
 * 동 간 비교가 되고, 대분류 레이어와 함께 보면 "소매가 많다 → 그중 주유소가 대부분" 같은
 * 해석이 가능하다.
 */

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\NH 데이터";
const INPUT_DIR = process.env.NH_DIR ?? DEFAULT_INPUT_DIR;

export const COL = { dong: 0, subIndustry: 4, amountAll: 10 };

/**
 * 표준산업분류 11차 소분류 코드 → 생활업종 그룹.
 * 한 그룹에 여러 코드가 들어가는 것은 실무에서 한 업태로 묶어 보기 때문이다.
 */
export const STORE_TYPES = {
  // 주유소 — 상권 매출 1위지만 생활 소비와 성격이 달라 따로 본다.
  G47711: "fuel",
  // 음식점(한식·간이·중식·일식 등)
  I56111: "restaurant",
  I56191: "restaurant",
  I56112: "restaurant",
  I56113: "restaurant",
  I56114: "restaurant",
  I56121: "restaurant",
  I56122: "restaurant",
  // 식료품 소매(슈퍼마켓·편의점·종합소매)
  G47121: "grocery",
  G47122: "grocery",
  G47129: "grocery",
  G47190: "grocery",
  // 카페·제과
  I56221: "cafe",
  I56150: "cafe",
  // 주점(유흥·일반)
  I56211: "pub",
  I56219: "pub",
  // 의료(종합병원·일반병원·의원·약국)
  Q86101: "medical",
  Q86102: "medical",
  Q86201: "medical",
  Q86202: "medical",
  G47811: "medical",
};

// --- pure helpers ---

export function cleanDongCode(raw) {
  return String(raw ?? "").replace(/^\uFEFF/, "").replace(/[^0-9]/g, "");
}

export function storeTypeOf(code) {
  return STORE_TYPES[String(code ?? "").trim()] ?? null;
}

/** acc: Map<dong, { total, fuel, restaurant, grocery, cafe, pub, medical }> — 전체카드 금액(원). */
export function accumulateLine(acc, line) {
  if (!line) return acc;
  const f = line.split(",");
  const dong = cleanDongCode(f[COL.dong]);
  if (dong.length !== 10) return acc;
  const amount = Number(f[COL.amountAll]);
  if (!Number.isFinite(amount)) return acc;

  const entry =
    acc.get(dong) ?? { total: 0, fuel: 0, restaurant: 0, grocery: 0, cafe: 0, pub: 0, medical: 0 };
  entry.total += amount;
  const type = storeTypeOf(f[COL.subIndustry]);
  if (type) entry[type] += amount;
  acc.set(dong, entry);
  return acc;
}

export function aggregateRows(lines) {
  const acc = new Map();
  for (const line of lines) accumulateLine(acc, line);
  return acc;
}

/** 각 업태 비중(%) = 해당 업태 매출 ÷ 그 동의 전체 카드매출 × 100. */
export function finalizeShares(entry) {
  const pct = (part) => (entry.total > 0 ? (part / entry.total) * 100 : null);
  return {
    // 비중의 분모. 시군구 가중평균에 필요해 큐브에 함께 싣는다.
    card_sales: entry.total > 0 ? entry.total / 1_000_000 : null,
    fuel_share: pct(entry.fuel),
    restaurant_share: pct(entry.restaurant),
    grocery_share: pct(entry.grocery),
    cafe_share: pct(entry.cafe),
    pub_share: pct(entry.pub),
    medical_store_share: pct(entry.medical),
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

const METRIC_KEYS = [
  "card_sales",
  "fuel_share",
  "restaurant_share",
  "grocery_share",
  "cafe_share",
  "pub_share",
  "medical_store_share",
];

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "layers", "nh-storetype.json");

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
    console.log(`${yyyymm} NH 업태 집계 완료 (${stats.size}개 동)`);
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
    layerId: "nh-storetype",
    adminLevel: "dong",
    referenceMonth: "2025-12",
    months: monthLabels,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube));
  console.log(`NH 생활업종 큐브 생성 완료 (${outputPath}): ${cells.length}개 동, ${monthLabels.length}개월`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(`NH 생활업종 큐브 생성 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
