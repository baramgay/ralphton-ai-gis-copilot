import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";

/**
 * KCB 신용정보(행정동 단위, KCB_STAT_02.txt) → 소득·신용·소비·부채 큐브.
 *
 * 원천: 파이프(|) 구분, 헤더 있음, 부울경 포함. 행 = (기준연월 × 행정동 × 5세연령구간).
 * ADM_CD(8자리) + "00" = adm_cd2(10). 경남만(ADM_CD 앞 2자리 "48") 사용.
 *
 * 평균 지표(소득·신용평점·1인소비)는 연령구간 단순평균이 아니라 인구수(MP00001) 가중평균으로
 * 합산한다. 보유자·연체자 수는 연령구간 합산 후 인구 대비 비율로 환산한다. 소득/소비 단위는
 * 천원 → 만원으로 변환.
 */

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\KCB 데이터";
const INPUT_DIR = process.env.KCB_DIR ?? DEFAULT_INPUT_DIR;
const STAT_FILE = "KCB_STAT_02.txt";

// --- pure helpers ---

const NEEDED = [
  "CRTR_YM", "ADM_CD", "MP00001", "MP00003", "MA00001", "MS00002",
  "MC00006", "ML00001", "MD00001", "MD00003", "ECON_CNT",
];

export function parseHeader(headerLine) {
  const cols = headerLine.split("|");
  const idx = {};
  for (const name of NEEDED) {
    const at = cols.indexOf(name);
    if (at < 0) throw new Error(`KCB 헤더에 ${name} 컬럼이 없습니다.`);
    idx[name] = at;
  }
  return idx;
}

export function toAdmCd2(admCd) {
  return `${admCd}00`;
}

function num(fields, index) {
  const value = Number(fields[index]);
  return Number.isFinite(value) ? value : null;
}

/**
 * acc: Map<`${crtrYm}|${admCd8}`, aggregator>. 경남(ADM_CD 앞2 "48") 행만 누적.
 * pop 가중 평균을 위해 (지표×인구) 합과 인구 합을 함께 모은다.
 */
export function accumulateLine(acc, line, idx) {
  if (!line) return acc;
  const f = line.split("|");
  const admCd = f[idx.ADM_CD];
  if (!admCd || admCd.slice(0, 2) !== "48") return acc;
  const crtrYm = f[idx.CRTR_YM];
  const pop = num(f, idx.MP00001) ?? 0;

  const key = `${crtrYm}|${admCd}`;
  const entry =
    acc.get(key) ??
    {
      crtrYm,
      admCd,
      pop: 0,
      incomeW: 0,
      scoreW: 0,
      spendW: 0,
      spendWeight: 0,
      loanHolders: 0,
      delinquent: 0,
      highend: 0,
    };

  entry.pop += pop;
  const income = num(f, idx.MA00001);
  if (income !== null) entry.incomeW += income * pop;
  const score = num(f, idx.MS00002);
  if (score !== null) entry.scoreW += score * pop;
  const spend = num(f, idx.MC00006);
  const econ = num(f, idx.ECON_CNT) ?? pop;
  if (spend !== null) {
    entry.spendW += spend * econ;
    entry.spendWeight += econ;
  }
  entry.loanHolders += num(f, idx.ML00001) ?? 0;
  entry.delinquent += (num(f, idx.MD00001) ?? 0) + (num(f, idx.MD00003) ?? 0);
  entry.highend += num(f, idx.MP00003) ?? 0;

  acc.set(key, entry);
  return acc;
}

/** 집계자 → 최종 지표(만원·점·%). pop 0이면 null. */
export function finalizeEntry(entry) {
  const pop = entry.pop;
  const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    avg_income: pop > 0 && entry.incomeW > 0 ? round1(entry.incomeW / pop / 10) : null, // 천원→만원
    credit_score: pop > 0 && entry.scoreW > 0 ? Math.round(entry.scoreW / pop) : null,
    card_spend: entry.spendWeight > 0 ? round1(entry.spendW / entry.spendWeight / 10) : null, // 천원→만원
    loan_ratio: pop > 0 ? round1((entry.loanHolders / pop) * 100) : null,
    delinquency_ratio: pop > 0 ? round1((entry.delinquent / pop) * 100) : null,
    highend_ratio: pop > 0 ? round1((entry.highend / pop) * 100) : null,
  };
}

export function aggregateRows(lines, headerLine) {
  const idx = parseHeader(headerLine);
  const acc = new Map();
  for (const line of lines) accumulateLine(acc, line, idx);
  return acc;
}

// --- streaming ---

async function aggregateStatFile(filePath, acc) {
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

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "layers", "kcb-credit.json");

  const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));

  // Walk every monthly delivery dir, aggregate per (CRTR_YM, dong) across age bands.
  const dirs = (await readdir(INPUT_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(INPUT_DIR, entry.name));

  const acc = new Map();
  for (const dir of dirs) {
    const filePath = path.join(dir, STAT_FILE);
    try {
      await aggregateStatFile(filePath, acc);
      console.log(`집계: ${path.basename(dir)}`);
    } catch (error) {
      console.warn(`건너뜀 ${path.basename(dir)}: ${error instanceof Error ? error.message : error}`);
    }
  }

  // Group finalized metrics by CRTR_YM → dong.
  const byMonth = new Map(); // crtrYm -> Map<admCd2, metrics>
  for (const entry of acc.values()) {
    const metrics = finalizeEntry(entry);
    const admCd2 = toAdmCd2(entry.admCd);
    if (!byMonth.has(entry.crtrYm)) byMonth.set(entry.crtrYm, new Map());
    byMonth.get(entry.crtrYm).set(admCd2, metrics);
  }

  // Keep 2025 months, ordered.
  const crtrYms = [...byMonth.keys()].filter((ym) => ym.startsWith("2025")).sort();
  const monthLabels = crtrYms.map((ym) => `${ym.slice(0, 4)}-${ym.slice(4, 6)}`);
  if (monthLabels.length === 0) throw new Error("2025년 KCB 데이터를 찾지 못했습니다.");

  const METRIC_KEYS = ["avg_income", "credit_score", "card_spend", "loan_ratio", "delinquency_ratio", "highend_ratio"];
  const cells = boundary.features.map((feature) => {
    const properties = feature.properties;
    const areaKm2 = turfArea(feature) / 1_000_000;
    const [lng, lat] = pointOnFeature(feature).geometry.coordinates;
    const series = {};
    for (const key of METRIC_KEYS) series[key] = crtrYms.map(() => null);
    crtrYms.forEach((ym, monthIndex) => {
      const metrics = byMonth.get(ym).get(properties.adm_cd2);
      if (metrics) for (const key of METRIC_KEYS) series[key][monthIndex] = metrics[key];
    });
    return { code: properties.adm_cd2, name: properties.adm_nm, point: { lat, lng }, areaKm2, series };
  });

  for (const cell of cells) {
    for (const [key, values] of Object.entries(cell.series)) {
      if (values.length !== monthLabels.length) throw new Error(`${cell.code} ${key} 길이 오류`);
    }
  }

  const cube = {
    layerId: "kcb-credit",
    adminLevel: "dong",
    referenceMonth: monthLabels[monthLabels.length - 1],
    months: monthLabels,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube));
  console.log(`KCB 신용 큐브 생성 완료 (${outputPath}): ${cells.length}개 동, ${monthLabels.length}개월 [${monthLabels.join(",")}]`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(`KCB 신용 큐브 생성 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
