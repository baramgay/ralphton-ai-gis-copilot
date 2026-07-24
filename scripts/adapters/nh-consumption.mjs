import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";

/**
 * NH 농협카드 소비(카드매출) → 소비 큐브.
 *
 * 원천: 경상남도_1_유입지별카드매출_YYYYMM.csv (헤더 없음, 콤마 구분, UTF-8 BOM)
 * 컬럼(명세서 "1. 유입지별"): 0 행정동코드(10자리) | 1 기준일자 | 2 업종_대 | 3 업종_중 |
 *   4 업종_소 | 5 이용자_시도 | 6 이용자_시군구 | 7 농협건수 | 8 농협금액 |
 *   9 전체카드이용건수(전수화) | 10 전체카드이용금액(원, 전수화)
 *
 * 헤드라인 = 전체카드이용금액 합(전수화라 실카드 시장 추정). 행은 (일자×업종×유입지)라
 * 동별 월 총합 = 그 동 상권의 월 카드소비 규모. 금액은 백만원으로 저장.
 */

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\NH 데이터";
const INPUT_DIR = process.env.NH_DIR ?? DEFAULT_INPUT_DIR;

// 헤더가 없으므로 컬럼은 고정 인덱스로 접근한다.
export const COL = { dong: 0, txnAll: 9, amountAll: 10 };

// --- pure helpers ---

/** BOM 제거 후 10자리 행정동코드만 남긴다(선행 BOM/따옴표 방지). */
export function cleanDongCode(raw) {
  return String(raw ?? "").replace(/^﻿/, "").replace(/[^0-9]/g, "");
}

/**
 * acc: Map<dong, { sales:number, txns:number }>
 * 전체카드이용금액·건수를 동별로 누적한다.
 */
export function accumulateLine(acc, line) {
  if (!line) return acc;
  const fields = line.split(",");
  const dong = cleanDongCode(fields[COL.dong]);
  if (dong.length !== 10) return acc;

  const amount = Number(fields[COL.amountAll]);
  const txn = Number(fields[COL.txnAll]);
  const entry = acc.get(dong) ?? { sales: 0, txns: 0 };
  if (Number.isFinite(amount)) entry.sales += amount;
  if (Number.isFinite(txn)) entry.txns += txn;
  acc.set(dong, entry);
  return acc;
}

export function aggregateRows(lines) {
  const acc = new Map();
  for (const line of lines) accumulateLine(acc, line);
  return acc;
}

// --- streaming aggregation ---

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

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "layers", "nh-consumption.json");

  const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));
  const monthLabels = [];
  const perDong = new Map();
  for (const feature of boundary.features) {
    perDong.set(feature.properties.adm_cd2, {
      card_sales: new Array(12).fill(null), // 백만원
      card_txns: new Array(12).fill(null), // 건
    });
  }

  const unmatched = new Set();
  for (let month = 1; month <= 12; month += 1) {
    const yyyymm = `2025${String(month).padStart(2, "0")}`;
    monthLabels.push(`2025-${String(month).padStart(2, "0")}`);
    const filePath = path.join(INPUT_DIR, `경상남도_1_유입지별카드매출_${yyyymm}.csv`);
    const stats = await aggregateMonthFile(filePath);

    for (const [dong, { sales, txns }] of stats) {
      const series = perDong.get(dong);
      if (!series) {
        unmatched.add(dong);
        continue;
      }
      series.card_sales[month - 1] = round(sales / 1_000_000, 1); // 원 → 백만원
      series.card_txns[month - 1] = round(txns, 0);
    }
    console.log(`${yyyymm} NH 카드매출 집계 완료 (${stats.size}개 동)`);
  }

  if (unmatched.size > 0) {
    console.warn(`경계에 없는 NH 동 코드 ${unmatched.size}개 무시: ${[...unmatched].slice(0, 20).join(", ")}`);
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

  if (monthLabels.length !== 12) throw new Error(`months 길이 오류: ${monthLabels.length}`);
  for (const cell of cells) {
    for (const [key, values] of Object.entries(cell.series)) {
      if (values.length !== 12) throw new Error(`${cell.code} ${key} 길이 오류: ${values.length}`);
    }
  }

  const cube = {
    layerId: "nh-consumption",
    adminLevel: "dong",
    referenceMonth: "2025-12",
    months: monthLabels,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube));
  console.log(`NH 소비 큐브 생성 완료 (${outputPath}): ${cells.length}개 동, ${monthLabels.length}개월`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(`NH 소비 큐브 생성 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
