import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";

/**
 * KCB 전입·전출 통계 → 거주지 이동(migration) 큐브.
 *
 * 원천(파이프, 헤더 有, 분기 단위 CRTR_YQ):
 *   전입 KCB_STAT_04.txt — CUR_ADM_CD(8) = 전입해 온 목적지 행정동. 경남(48) 행이 경남 전입.
 *   전출 KCB_STAT_05.txt — PRV_CTN_CD(5) = 떠나기 전 거주 시군구. 경남(48) 행이 경남 전출.
 *
 * 방향은 명세 + 실제 코드 분포로 확인했다(전입 파일은 CUR가 부울경에 집중, 전출 파일은
 * PRV가 부울경에 집중).
 *
 * 중요한 비대칭: 전입은 목적지가 행정동(8자리)이라 동 단위 집계가 되지만, 전출은 출발지가
 * 시군구(5자리)까지만 있어 동 단위로 내릴 수 없다. 시군구 전출을 소속 동에 임의 배분하면
 * 값이 왜곡되므로 하지 않는다. 대신 전출·순이동은 시군구 값을 그 시군구의 모든 동에 동일하게
 * 부여하고(= 시군구 단위 지표), limitation에 그 사실을 명시한다.
 *
 * SKT 유입/유출(일시 체류)과 달리 KCB는 실제 거주지 이전이다.
 */

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\KCB 데이터";
const INPUT_DIR = process.env.KCB_DIR ?? DEFAULT_INPUT_DIR;

// --- pure helpers ---

export function parseHeader(headerLine, needed) {
  const cols = headerLine.split("|");
  const idx = {};
  for (const name of needed) {
    const at = cols.indexOf(name);
    if (at < 0) throw new Error(`KCB 헤더에 ${name} 컬럼이 없습니다.`);
    idx[name] = at;
  }
  return idx;
}

export const INFLOW_COLUMNS = ["CRTR_YQ", "CUR_ADM_CD", "CUR_CTN_CD", "PRV_CTN_CD", "MP00001"];
export const OUTFLOW_COLUMNS = ["CRTR_YQ", "PRV_CTN_CD", "CUR_CTN_CD", "MP00001"];

/** 이전 거주 시군구 정보가 없는 레코드 코드. */
const UNKNOWN_SGG = "99999";

/**
 * 두 시점의 거주 시군구가 실제로 다른 이동인지 판정한다.
 *
 * 원자료는 "2년 전 거주지 vs 기준시점 거주지" 비교표라서 이사하지 않은 사람과 같은
 * 시군구 안에서만 옮긴 사람까지 모두 들어 있다(경남 도착분 기준 88.8%). 이들을 빼지
 * 않으면 전입이 인구 규모만큼 부풀려지므로, 출발 시군구와 도착 시군구가 다른 행만 센다.
 * 이전 거주지 정보가 없는(99999) 행도 이동 여부를 확정할 수 없어 제외한다.
 */
export function isExternalMove(prvSgg, curSgg) {
  if (!prvSgg || !curSgg) return false;
  if (prvSgg === UNKNOWN_SGG) return false;
  return prvSgg !== curSgg;
}

export function toAdmCd2(admCd8) {
  return `${admCd8}00`;
}

export function isGyeongnam(code) {
  return typeof code === "string" && code.slice(0, 2) === "48";
}

/** 전입: 경남 목적지 행정동(8자리)별 외지 전입 인구 합. acc: Map<`${yq}|${admCd8}`, number> */
export function accumulateInflow(acc, line, idx) {
  if (!line) return acc;
  const f = line.split("|");
  const admCd = f[idx.CUR_ADM_CD];
  if (!isGyeongnam(admCd) || admCd.length !== 8) return acc;
  if (!isExternalMove(f[idx.PRV_CTN_CD], f[idx.CUR_CTN_CD])) return acc;
  const people = Number(f[idx.MP00001]);
  if (!Number.isFinite(people)) return acc;
  const key = `${f[idx.CRTR_YQ]}|${admCd}`;
  acc.set(key, (acc.get(key) ?? 0) + people);
  return acc;
}

/** 전출: 경남 출발 시군구(5자리)별 외지 전출 인구 합. acc: Map<`${yq}|${sggCd5}`, number> */
export function accumulateOutflow(acc, line, idx) {
  if (!line) return acc;
  const f = line.split("|");
  const sgg = f[idx.PRV_CTN_CD];
  if (!isGyeongnam(sgg) || sgg.length !== 5) return acc;
  if (!isExternalMove(sgg, f[idx.CUR_CTN_CD])) return acc;
  const people = Number(f[idx.MP00001]);
  if (!Number.isFinite(people)) return acc;
  const key = `${f[idx.CRTR_YQ]}|${sgg}`;
  acc.set(key, (acc.get(key) ?? 0) + people);
  return acc;
}

/**
 * "20254" → "2025-12". LayerCubeSchema의 referenceMonth/months는 YYYY-MM 형식만
 * 허용하므로 분기를 그 분기의 종료월로 표기한다(1Q→03, 2Q→06, 3Q→09, 4Q→12).
 */
export function quarterLabel(yq) {
  const quarter = Number(yq.slice(4));
  const endMonth = String(quarter * 3).padStart(2, "0");
  return `${yq.slice(0, 4)}-${endMonth}`;
}

// --- streaming ---

async function streamFile(filePath, columns, accumulate, acc) {
  const rl = readline.createInterface({ input: createReadStream(filePath, "utf8"), crlfDelay: Infinity });
  let idx = null;
  let isHeader = true;
  for await (const line of rl) {
    if (isHeader) {
      idx = parseHeader(line, columns);
      isHeader = false;
      continue;
    }
    accumulate(acc, line, idx);
  }
  return acc;
}

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-dong-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "layers", "kcb-migration.json");
  const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));

  const dirs = (await readdir(INPUT_DIR, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(INPUT_DIR, entry.name));

  const inflow = new Map(); // `${yq}|${admCd8}` -> people
  const outflow = new Map(); // `${yq}|${sgg5}`  -> people

  for (const dir of dirs) {
    try {
      await streamFile(path.join(dir, "KCB_STAT_04.txt"), INFLOW_COLUMNS, accumulateInflow, inflow);
      await streamFile(path.join(dir, "KCB_STAT_05.txt"), OUTFLOW_COLUMNS, accumulateOutflow, outflow);
      console.log(`집계: ${path.basename(dir)}`);
    } catch (error) {
      console.warn(`건너뜀 ${path.basename(dir)}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const quarters = [...new Set([...inflow.keys(), ...outflow.keys()].map((key) => key.split("|")[0]))].sort();
  if (quarters.length === 0) throw new Error("KCB 전입·전출 데이터를 찾지 못했습니다.");
  const monthLabels = quarters.map(quarterLabel);

  const cells = boundary.features.map((feature) => {
    const properties = feature.properties;
    const areaKm2 = turfArea(feature) / 1_000_000;
    const [lng, lat] = pointOnFeature(feature).geometry.coordinates;
    const admCd8 = properties.adm_cd2.slice(0, 8);
    const sgg5 = properties.adm_cd2.slice(0, 5);

    const moveIn = quarters.map((yq) => inflow.get(`${yq}|${admCd8}`) ?? null);
    const moveOutSgg = quarters.map((yq) => outflow.get(`${yq}|${sgg5}`) ?? null);
    // 순이동은 동 단위 전입과 시군구 단위 전출을 섞으면 의미가 깨지므로 산출하지 않는다.
    return {
      code: properties.adm_cd2,
      name: properties.adm_nm,
      point: { lat, lng },
      areaKm2,
      series: { move_in: moveIn, move_out_sgg: moveOutSgg },
    };
  });

  for (const cell of cells) {
    for (const [key, values] of Object.entries(cell.series)) {
      if (values.length !== monthLabels.length) throw new Error(`${cell.code} ${key} 길이 오류`);
    }
  }

  const cube = {
    layerId: "kcb-migration",
    adminLevel: "dong",
    referenceMonth: monthLabels[monthLabels.length - 1],
    months: monthLabels,
    cells,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(cube));
  console.log(`KCB 이동 큐브 생성 완료 (${outputPath}): ${cells.length}개 동, ${monthLabels.length}분기 [${monthLabels.join(",")}]`);
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(`KCB 이동 큐브 생성 실패: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  });
}
