import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\SKT 데이터\\3. 생활인구";
const INPUT_DIR = process.env.SKT_LIVING_DIR ?? DEFAULT_INPUT_DIR;

const ELDERLY_COLUMNS = ["M65", "M70", "M75", "M80", "F65", "F70", "F75", "F80"];

// --- pure helpers (unit-testable without touching the real CSV files) ---

export function toAdmCd2(admdongCd) {
  return `${admdongCd}00`;
}

export function computeColumnIndices(columns) {
  const admIdx = columns.indexOf("ADMDONG_CD");
  if (admIdx < 0) {
    throw new Error("CSV 헤더에 ADMDONG_CD 컬럼이 없습니다.");
  }
  const numericStart = admIdx + 1;
  const elderlyIdx = ELDERLY_COLUMNS.map((name) => {
    const idx = columns.indexOf(name);
    if (idx < 0) throw new Error(`CSV 헤더에 ${name} 컬럼이 없습니다.`);
    return idx;
  });
  return { admIdx, numericStart, elderlyIdx };
}

/**
 * Folds one data line (no header) into the per-dong accumulator.
 * acc: Map<ADMDONG_CD, { sumBands: number, elderly: number, rows: number }>
 */
export function accumulateLine(acc, line, indices) {
  if (!line) return acc;
  const fields = line.split("|");
  const dong = fields[indices.admIdx];

  let sumBands = 0;
  for (let i = indices.numericStart; i < fields.length; i += 1) {
    sumBands += Number(fields[i]);
  }
  let elderly = 0;
  for (const idx of indices.elderlyIdx) {
    elderly += Number(fields[idx]);
  }

  const entry = acc.get(dong);
  if (entry) {
    entry.sumBands += sumBands;
    entry.elderly += elderly;
    entry.rows += 1;
  } else {
    acc.set(dong, { sumBands, elderly, rows: 1 });
  }
  return acc;
}

/**
 * Aggregates an in-memory array of data lines (header excluded) for one month.
 * Used by unit tests with a small synthetic set; production streaming uses
 * accumulateLine directly so the 226k-row files are never held in memory.
 */
export function aggregateLivingRows(lines, columns) {
  const indices = computeColumnIndices(columns);
  const acc = new Map();
  for (const line of lines) {
    accumulateLine(acc, line, indices);
  }
  return acc;
}

/**
 * Converts the raw per-dong accumulator into the final metrics:
 * living_total = day×hour mean of sumBands; elderly_ratio = elderly/sumBands * 100 (null if sumBands is 0).
 */
export function finalizeDongStats(acc) {
  const result = new Map();
  for (const [dong, { sumBands, elderly, rows }] of acc) {
    const living_total = rows > 0 ? sumBands / rows : 0;
    const elderly_ratio = sumBands > 0 ? (elderly / sumBands) * 100 : null;
    result.set(dong, { living_total, elderly_ratio });
  }
  return result;
}

// --- streaming file aggregation (memory-bounded: only the per-dong accumulator is kept) ---

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
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(
    projectRoot,
    "public",
    "data",
    "administrative-dong-20260701.geojson",
  );
  const outputPath = path.join(projectRoot, "public", "data", "layers", "skt-living.json");

  const boundaryRaw = await readFile(boundaryPath, "utf8");
  const boundary = JSON.parse(boundaryRaw);

  const monthLabels = [];
  const perDongSeries = new Map();
  for (const feature of boundary.features) {
    perDongSeries.set(feature.properties.adm_cd2, {
      living_total: new Array(12).fill(null),
      elderly_ratio: new Array(12).fill(null),
    });
  }

  const unmatched = new Set();

  for (let month = 1; month <= 12; month += 1) {
    const yyyymm = `2025${String(month).padStart(2, "0")}`;
    monthLabels.push(`2025-${String(month).padStart(2, "0")}`);

    const filePath = path.join(INPUT_DIR, `gn_living_pop_hjd_${yyyymm}.csv`);
    const stats = await aggregateMonthFile(filePath);

    for (const [dong, { living_total, elderly_ratio }] of stats) {
      const admCd2 = toAdmCd2(dong);
      const series = perDongSeries.get(admCd2);
      if (!series) {
        unmatched.add(dong);
        continue;
      }
      series.living_total[month - 1] = round(living_total, 1);
      series.elderly_ratio[month - 1] = elderly_ratio == null ? null : round(elderly_ratio, 2);
    }

    console.log(`${yyyymm} 집계 완료 (${stats.size}개 동)`);
  }

  if (unmatched.size > 0) {
    console.warn(`경계 데이터에 없는 SKT 동 코드 ${unmatched.size}개 무시: ${[...unmatched].join(", ")}`);
  }

  const cells = boundary.features.map((feature) => {
    const properties = feature.properties;
    const areaKm2 = turfArea(feature) / 1_000_000;
    const representative = pointOnFeature(feature);
    const [lng, lat] = representative.geometry.coordinates;
    const series = perDongSeries.get(properties.adm_cd2);

    return {
      code: properties.adm_cd2,
      name: properties.adm_nm,
      point: { lat, lng },
      areaKm2,
      series: {
        living_total: series.living_total,
        elderly_ratio: series.elderly_ratio,
      },
    };
  });

  // Manual shape assertions mirroring LayerCubeSchema (src/lib/layers/types.ts),
  // avoiding a TS import from this .mjs script.
  if (monthLabels.length !== 12) {
    throw new Error(`months 길이가 12가 아닙니다: ${monthLabels.length}`);
  }
  for (const cell of cells) {
    if (!cell.code || !cell.name) {
      throw new Error(`셀에 code/name이 없습니다: ${JSON.stringify(cell)}`);
    }
    for (const [key, values] of Object.entries(cell.series)) {
      if (values.length !== 12) {
        throw new Error(`${cell.code}의 ${key} 시리즈 길이가 12가 아닙니다: ${values.length}`);
      }
    }
  }

  const cube = {
    layerId: "skt-living",
    adminLevel: "dong",
    referenceMonth: "2025-12",
    months: monthLabels,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube));

  console.log(
    `SKT 생활인구 큐브 생성 완료 (${outputPath}): ${cells.length}개 동, ${monthLabels.length}개월`,
  );
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(`SKT 생활인구 큐브 생성 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
