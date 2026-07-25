import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";

/**
 * KCB 통근통계(KCB_STAT_06) → 통근 큐브.
 *
 * 원천(파이프, 헤더 有, 분기 CRTR_YQ):
 *   CRTR_YQ | CUR_CTN_CD(거주 시군구5) | CUR_ADM_CD(거주 행정동8)
 *          | COM_CTN_CD(직장 시군구5) | COM_ADM_CD(직장 행정동8) | MP00001(인원) | …
 *
 * 거주지·직장 모두 행정동까지 있어 양방향 집계가 된다. 한 동을 두 관점에서 본다:
 *   - 직장지 관점: 그 동으로 출근하는 인원(일자리 규모)
 *   - 거주지 관점: 그 동에 사는 취업자, 그중 거주 시군구 밖으로 통근하는 비율
 * 두 관점을 나눈 주간 일자리 배율(일자리 ÷ 취업 거주자 × 100)이 100을 넘으면 직장
 * 중심지, 밑돌면 베드타운이다.
 *
 * 한계: KCB 직장 위치는 본사 주소로 잡히는 경우가 있어 관외 통근이 과대 추정될 수 있다.
 */

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\KCB 데이터";
const INPUT_DIR = process.env.KCB_DIR ?? DEFAULT_INPUT_DIR;
const STAT_FILE = "KCB_STAT_06.txt";

export const COLUMNS = ["CRTR_YQ", "CUR_CTN_CD", "CUR_ADM_CD", "COM_CTN_CD", "COM_ADM_CD", "MP00001"];

// --- pure helpers ---

export function parseHeader(headerLine) {
  const cols = headerLine.split("|");
  const idx = {};
  for (const name of COLUMNS) {
    const at = cols.indexOf(name);
    if (at < 0) throw new Error(`KCB 통근 헤더에 ${name} 컬럼이 없습니다.`);
    idx[name] = at;
  }
  return idx;
}

export function toAdmCd2(admCd8) {
  return `${admCd8}00`;
}

export function isGyeongnam(code) {
  return typeof code === "string" && code.slice(0, 2) === "48";
}

/** "20254" → "2025-12" (분기 종료월. LayerCubeSchema가 YYYY-MM만 허용). */
export function quarterLabel(yq) {
  const endMonth = String(Number(yq.slice(4)) * 3).padStart(2, "0");
  return `${yq.slice(0, 4)}-${endMonth}`;
}

/**
 * 한 행을 거주지·직장지 양쪽 누적기에 반영한다.
 * jobs:      Map<`${yq}|${comDong8}`, 인원>  — 그 동으로 출근하는 인원
 * residents: Map<`${yq}|${curDong8}`, {working, outbound}> — 그 동 취업 거주자 / 그중 관외 통근
 */
export function accumulateLine(acc, line, idx) {
  if (!line) return acc;
  const f = line.split("|");
  const people = Number(f[idx.MP00001]);
  if (!Number.isFinite(people)) return acc;

  const yq = f[idx.CRTR_YQ];
  const curDong = f[idx.CUR_ADM_CD];
  const comDong = f[idx.COM_ADM_CD];

  if (isGyeongnam(comDong) && comDong.length === 8) {
    const key = `${yq}|${comDong}`;
    acc.jobs.set(key, (acc.jobs.get(key) ?? 0) + people);
  }

  if (isGyeongnam(curDong) && curDong.length === 8) {
    const key = `${yq}|${curDong}`;
    const entry = acc.residents.get(key) ?? { working: 0, outbound: 0 };
    entry.working += people;
    // 거주 시군구와 직장 시군구가 다르면 관외 통근.
    if (f[idx.CUR_CTN_CD] !== f[idx.COM_CTN_CD]) entry.outbound += people;
    acc.residents.set(key, entry);
  }

  return acc;
}

export function createAccumulator() {
  return { jobs: new Map(), residents: new Map() };
}

export function aggregateRows(lines, headerLine) {
  const idx = parseHeader(headerLine);
  const acc = createAccumulator();
  for (const line of lines) accumulateLine(acc, line, idx);
  return acc;
}

/** 한 동·한 분기의 최종 지표. 취업 거주자가 없으면 비율 지표는 null. */
export function finalizeDong(jobs, resident) {
  const working = resident?.working ?? 0;
  return {
    jobs_in: jobs ?? null,
    outbound_ratio: working > 0 ? (resident.outbound / working) * 100 : null,
    job_ratio: working > 0 && jobs != null ? (jobs / working) * 100 : null,
  };
}

// --- streaming ---

async function streamFile(filePath, acc) {
  const rl = readline.createInterface({ input: createReadStream(filePath, "utf8"), crlfDelay: Infinity });
  let idx = null;
  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) {
      idx = parseHeader(line);
      isHeader = false;
      continue;
    }
    accumulateLine(acc, line, idx);
  }
  return acc;
}

function round(value, decimals) {
  if (value == null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

const METRIC_KEYS = ["jobs_in", "outbound_ratio", "job_ratio"];

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "layers", "kcb-commute.json");
  const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));

  const dirs = (await readdir(INPUT_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(INPUT_DIR, entry.name));

  const acc = createAccumulator();
  for (const dir of dirs) {
    try {
      await streamFile(path.join(dir, STAT_FILE), acc);
      console.log(`집계: ${path.basename(dir)}`);
    } catch (error) {
      console.warn(`건너뜀 ${path.basename(dir)}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const quarters = [
    ...new Set([...acc.jobs.keys(), ...acc.residents.keys()].map((key) => key.split("|")[0])),
  ]
    .filter((yq) => yq.startsWith("2025"))
    .sort();
  if (quarters.length === 0) throw new Error("2025년 KCB 통근 데이터를 찾지 못했습니다.");
  const monthLabels = quarters.map(quarterLabel);

  const cells = boundary.features.map((feature) => {
    const properties = feature.properties;
    const areaKm2 = turfArea(feature) / 1_000_000;
    const [lng, lat] = pointOnFeature(feature).geometry.coordinates;
    const dong8 = properties.adm_cd2.slice(0, 8);

    const series = {};
    for (const key of METRIC_KEYS) series[key] = [];
    for (const yq of quarters) {
      const metrics = finalizeDong(acc.jobs.get(`${yq}|${dong8}`), acc.residents.get(`${yq}|${dong8}`));
      series.jobs_in.push(round(metrics.jobs_in, 0));
      series.outbound_ratio.push(round(metrics.outbound_ratio, 1));
      series.job_ratio.push(round(metrics.job_ratio, 1));
    }

    return { code: properties.adm_cd2, name: properties.adm_nm, point: { lat, lng }, areaKm2, series };
  });

  for (const cell of cells) {
    for (const [key, values] of Object.entries(cell.series)) {
      if (values.length !== monthLabels.length) throw new Error(`${cell.code} ${key} 길이 오류`);
    }
  }

  const cube = {
    layerId: "kcb-commute",
    adminLevel: "dong",
    referenceMonth: monthLabels[monthLabels.length - 1],
    months: monthLabels,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube));
  console.log(`KCB 통근 큐브 생성 완료 (${outputPath}): ${cells.length}개 동, ${monthLabels.length}분기 [${monthLabels.join(",")}]`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(`KCB 통근 큐브 생성 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
