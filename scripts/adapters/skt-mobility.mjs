import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";

/**
 * SKT 유입(inflow)·유출(outflow) 인구 → 이동인구(mobility) 큐브.
 *
 * 원천(pipe 구분, 헤더 있음):
 *   유입: BASE_DATE|ADM_CD|RSDN_SGG_CD|M00..M80|F00..F80  (거주지 시군구별 유입)
 *   유출: BASE_DATE|ADM_CD|RSDN_SGG_CD|M00..M80|F00..F80
 * ADM_CD(8자리) + "00" = adm_cd2(10자리). 성·연령 밴드의 합이 인원.
 *
 * 한 동의 하루 총 유입인구 = 그 날 모든 거주지-sgg 행의 밴드합. 월 대푯값은
 * 동별 밴드 총합 ÷ 구분일수(distinct BASE_DATE) = 일평균 유입인구.
 * (생활인구 어댑터는 rows로 나눴지만, 유입/유출은 행 수가 거주지×일수라서 일수로 나눠야 함.)
 */

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\SKT 데이터";
const INPUT_DIR = process.env.SKT_MOBILITY_DIR ?? DEFAULT_INPUT_DIR;

// --- pure helpers (unit-testable without the multi-GB CSVs) ---

export function toAdmCd2(admCd) {
  return `${admCd}00`;
}

export function computeColumnIndices(columns) {
  const dateIdx = columns.indexOf("BASE_DATE");
  // 유입 파일은 목적지 동을 ADM_CD, 유출 파일은 거주지 동을 RSDN_ADM_CD로 표기한다.
  // 두 경우 모두 "그 동에 귀속되는 유입/유출 인구"의 기준 동 컬럼이다.
  let admIdx = columns.indexOf("ADM_CD");
  if (admIdx < 0) admIdx = columns.indexOf("RSDN_ADM_CD");
  if (dateIdx < 0) throw new Error("CSV 헤더에 BASE_DATE 컬럼이 없습니다.");
  if (admIdx < 0) throw new Error("CSV 헤더에 ADM_CD/RSDN_ADM_CD 컬럼이 없습니다.");
  // 성·연령 밴드는 M00부터 시작한다(유입 RSDN_SGG_CD / 유출 SGG_CD 다음).
  const m00Idx = columns.indexOf("M00");
  const numericStart = m00Idx >= 0 ? m00Idx : admIdx + 2;
  return { dateIdx, admIdx, numericStart };
}

/**
 * acc: Map<ADM_CD, { sumBands:number, dates:Set<string> }>
 * 동별 밴드 총합과 등장 일자 집합을 누적한다(메모리: 동 305개 × 소형 Set).
 */
export function accumulateLine(acc, line, indices) {
  if (!line) return acc;
  const fields = line.split("|");
  const admCd = fields[indices.admIdx];
  if (!admCd) return acc;

  let sumBands = 0;
  for (let i = indices.numericStart; i < fields.length; i += 1) {
    const value = Number(fields[i]);
    if (Number.isFinite(value)) sumBands += value;
  }

  const entry = acc.get(admCd);
  if (entry) {
    entry.sumBands += sumBands;
    entry.dates.add(fields[indices.dateIdx]);
  } else {
    acc.set(admCd, { sumBands, dates: new Set([fields[indices.dateIdx]]) });
  }
  return acc;
}

export function aggregateRows(lines, columns) {
  const indices = computeColumnIndices(columns);
  const acc = new Map();
  for (const line of lines) accumulateLine(acc, line, indices);
  return acc;
}

/** 동별 일평균 인원 = 밴드 총합 ÷ 구분일수. 일수 0이면 null. */
export function finalizeDailyMean(acc) {
  const result = new Map();
  for (const [admCd, { sumBands, dates }] of acc) {
    const days = dates.size;
    result.set(admCd, days > 0 ? sumBands / days : null);
  }
  return result;
}

// --- streaming aggregation ---

async function aggregateMonthFile(filePath) {
  const rl = readline.createInterface({
    input: createReadStream(filePath, "utf8"),
    crlfDelay: Infinity,
  });
  let indices = null;
  const acc = new Map();
  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) {
      indices = computeColumnIndices(line.split("|"));
      isHeader = false;
      continue;
    }
    accumulateLine(acc, line, indices);
  }
  return finalizeDailyMean(acc);
}

function round(value, decimals) {
  if (value == null) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "layers", "skt-mobility.json");

  const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));
  const monthLabels = [];
  const perDong = new Map();
  for (const feature of boundary.features) {
    perDong.set(feature.properties.adm_cd2, {
      inflow_total: new Array(12).fill(null),
      outflow_total: new Array(12).fill(null),
      net_flow: new Array(12).fill(null),
    });
  }

  const unmatched = new Set();
  for (let month = 1; month <= 12; month += 1) {
    const yyyymm = `2025${String(month).padStart(2, "0")}`;
    monthLabels.push(`2025-${String(month).padStart(2, "0")}`);

    const inflowPath = path.join(INPUT_DIR, "4. 유입인구", `gn_inflow_pop_dong_${yyyymm}.csv`);
    const outflowPath = path.join(INPUT_DIR, "5. 유출인구", `gn_outflow_pop_dong_${yyyymm}.csv`);
    const inflow = await aggregateMonthFile(inflowPath);
    const outflow = await aggregateMonthFile(outflowPath);

    const codes = new Set([...inflow.keys(), ...outflow.keys()]);
    for (const admCd of codes) {
      const admCd2 = toAdmCd2(admCd);
      const series = perDong.get(admCd2);
      if (!series) {
        unmatched.add(admCd);
        continue;
      }
      const inValue = inflow.get(admCd) ?? null;
      const outValue = outflow.get(admCd) ?? null;
      series.inflow_total[month - 1] = round(inValue, 1);
      series.outflow_total[month - 1] = round(outValue, 1);
      series.net_flow[month - 1] =
        inValue == null || outValue == null ? null : round(inValue - outValue, 1);
    }
    console.log(`${yyyymm} 유입/유출 집계 완료 (유입 ${inflow.size}동, 유출 ${outflow.size}동)`);
  }

  if (unmatched.size > 0) {
    console.warn(`경계에 없는 SKT 동 코드 ${unmatched.size}개 무시: ${[...unmatched].slice(0, 20).join(", ")}`);
  }

  const cells = boundary.features.map((feature) => {
    const properties = feature.properties;
    const areaKm2 = turfArea(feature) / 1_000_000;
    const [lng, lat] = pointOnFeature(feature).geometry.coordinates;
    const series = perDong.get(properties.adm_cd2);
    return {
      code: properties.adm_cd2,
      name: properties.adm_nm,
      point: { lat, lng },
      areaKm2,
      series,
    };
  });

  if (monthLabels.length !== 12) throw new Error(`months 길이가 12가 아닙니다: ${monthLabels.length}`);
  for (const cell of cells) {
    for (const [key, values] of Object.entries(cell.series)) {
      if (values.length !== 12) throw new Error(`${cell.code} ${key} 시리즈 길이 오류: ${values.length}`);
    }
  }

  const cube = {
    layerId: "skt-mobility",
    adminLevel: "dong",
    referenceMonth: "2025-12",
    months: monthLabels,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube));
  console.log(`SKT 이동인구 큐브 생성 완료 (${outputPath}): ${cells.length}개 동, ${monthLabels.length}개월`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(`SKT 이동인구 큐브 생성 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
