import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";

/**
 * SKT 생활인구 시간대 분해 → 주간·야간 인구 큐브.
 *
 * 원천: gn_living_pop_hjd_YYYYMM.csv (pipe, 헤더 有)
 *   BASEDATE|TIMEZN_CD('00'~'23')|ADMDONG_CD|M00..F80
 * ADMDONG_CD(8) + "00" = adm_cd2(10).
 *
 * 주간(09~18시)·야간(22~05시) 시간대의 시간당 평균 생활인구를 각각 구하고
 * 주야비 = 주간 ÷ 야간 × 100 을 산출한다. 주야비 100 초과 = 낮에 인구가 늘어나는
 * 상권·업무지구, 100 미만 = 밤에 인구가 많은 정주지역.
 */

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\SKT 데이터\\3. 생활인구";
const INPUT_DIR = process.env.SKT_LIVING_DIR ?? DEFAULT_INPUT_DIR;

const DAY_HOURS = new Set(["09", "10", "11", "12", "13", "14", "15", "16", "17", "18"]);
const NIGHT_HOURS = new Set(["22", "23", "00", "01", "02", "03", "04", "05"]);

// --- pure helpers ---

export function toAdmCd2(admdongCd) {
  return `${admdongCd}00`;
}

export function computeColumnIndices(columns) {
  const hourIdx = columns.indexOf("TIMEZN_CD");
  const admIdx = columns.indexOf("ADMDONG_CD");
  if (hourIdx < 0) throw new Error("CSV 헤더에 TIMEZN_CD 컬럼이 없습니다.");
  if (admIdx < 0) throw new Error("CSV 헤더에 ADMDONG_CD 컬럼이 없습니다.");
  const m00 = columns.indexOf("M00");
  return { hourIdx, admIdx, numericStart: m00 >= 0 ? m00 : admIdx + 1 };
}

/** 시간대 코드를 정규화한다("9" → "09"). 원자료는 2자리지만 방어적으로 처리. */
export function normalizeHour(raw) {
  const text = String(raw ?? "").trim();
  return text.length === 1 ? `0${text}` : text;
}

/**
 * acc: Map<ADMDONG_CD, { daySum, dayRows, nightSum, nightRows }>
 * 주간/야간 버킷별로 밴드합과 행 수를 누적한다(행 = 일자×시간대).
 */
export function accumulateLine(acc, line, indices) {
  if (!line) return acc;
  const fields = line.split("|");
  const hour = normalizeHour(fields[indices.hourIdx]);
  const isDay = DAY_HOURS.has(hour);
  const isNight = NIGHT_HOURS.has(hour);
  if (!isDay && !isNight) return acc;

  const dong = fields[indices.admIdx];
  if (!dong) return acc;

  let sumBands = 0;
  for (let i = indices.numericStart; i < fields.length; i += 1) {
    const value = Number(fields[i]);
    if (Number.isFinite(value)) sumBands += value;
  }

  const entry = acc.get(dong) ?? { daySum: 0, dayRows: 0, nightSum: 0, nightRows: 0 };
  if (isDay) {
    entry.daySum += sumBands;
    entry.dayRows += 1;
  } else {
    entry.nightSum += sumBands;
    entry.nightRows += 1;
  }
  acc.set(dong, entry);
  return acc;
}

export function aggregateRows(lines, columns) {
  const indices = computeColumnIndices(columns);
  const acc = new Map();
  for (const line of lines) accumulateLine(acc, line, indices);
  return acc;
}

/** 버킷 평균과 주야비(%) 산출. 야간 인구가 0이면 비율은 null. */
export function finalizeDongStats(acc) {
  const result = new Map();
  for (const [dong, { daySum, dayRows, nightSum, nightRows }] of acc) {
    const day = dayRows > 0 ? daySum / dayRows : null;
    const night = nightRows > 0 ? nightSum / nightRows : null;
    const ratio = day === null || night === null || night <= 0 ? null : (day / night) * 100;
    result.set(dong, { day_population: day, night_population: night, day_night_ratio: ratio });
  }
  return result;
}

// --- streaming ---

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
  return finalizeDongStats(acc);
}

function round(value, decimals) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "layers", "skt-daynight.json");

  const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));
  const monthLabels = [];
  const perDong = new Map();
  for (const feature of boundary.features) {
    perDong.set(feature.properties.adm_cd2, {
      day_population: new Array(12).fill(null),
      night_population: new Array(12).fill(null),
      day_night_ratio: new Array(12).fill(null),
    });
  }

  const unmatched = new Set();
  for (let month = 1; month <= 12; month += 1) {
    const yyyymm = `2025${String(month).padStart(2, "0")}`;
    monthLabels.push(`2025-${String(month).padStart(2, "0")}`);
    const filePath = path.join(INPUT_DIR, `gn_living_pop_hjd_${yyyymm}.csv`);
    const stats = await aggregateMonthFile(filePath);

    for (const [dong, metrics] of stats) {
      const series = perDong.get(toAdmCd2(dong));
      if (!series) {
        unmatched.add(dong);
        continue;
      }
      series.day_population[month - 1] = round(metrics.day_population, 1);
      series.night_population[month - 1] = round(metrics.night_population, 1);
      series.day_night_ratio[month - 1] = round(metrics.day_night_ratio, 1);
    }
    console.log(`${yyyymm} 주야간 집계 완료 (${stats.size}개 동)`);
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
    layerId: "skt-daynight",
    adminLevel: "dong",
    referenceMonth: "2025-12",
    months: monthLabels,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube));
  console.log(`SKT 주야간 인구 큐브 생성 완료 (${outputPath}): ${cells.length}개 동, ${monthLabels.length}개월`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(`SKT 주야간 큐브 생성 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
