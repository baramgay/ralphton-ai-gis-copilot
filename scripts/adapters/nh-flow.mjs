import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { readSggNameTable, resolveOriginCode, sggNameCsvPath } from "./_nh-origin.mjs";
import { SIDO_BY_PREFIX } from "./skt-flow.mjs";

/**
 * NH 유입지별 카드매출 → **돈의 흐름**(어디서 와서 쓰는가).
 *
 * 사람 흐름(skt-flow.mjs)과 똑같은 모양의 발견이다. 파일 이름부터 「유입지별」인데
 * 어댑터 4개가 유입지 두 컬럼을 한 번도 읽지 않고 전부 동별로 합쳐 버렸다.
 * 새로 내려받을 자료 없이 「부산 북구 사람들이 김해에서 쓴 돈」을 셀 수 있는데
 * 화면에는 상권 총액만 있었다.
 *
 * ## 원천
 *
 * `경상남도_1_유입지별카드매출_YYYYMM.csv` (헤더 없음, 콤마 구분, UTF-8 BOM)
 *   0 행정동코드(가맹점, 10자리) | 1 기준일자(YYYYMMDD) | 5 이용자_시도 | 6 이용자_시군구 |
 *   10 전체카드이용금액(원, 전수화)
 *
 * ## 셈법 (사람 흐름과 같은 규약)
 *
 * - 기준(가맹점) 시군구별 × 상대(거주) 시군구별 월 합 ÷ 그 달의 구분일수 = **일평균 금액**.
 * - **자기 자신 쌍은 값에서 뺀다.** 2025-12 실측으로 경남 전체의 80.6%가 같은 시군구
 *   거주자다 — 같이 세면 순위가 아니라 그 도시의 소비 규모를 보게 된다.
 *   날짜는 남긴다. 관내를 빼고 날짜까지 빼면 분모가 줄어 일평균이 부풀려진다.
 * - 금액은 만원 단위가 아니라 **백만원**(소수 1자리)으로 저장한다. 카드매출 지표와
 *   같은 단위라 값을 맞댈 수 있다.
 * - NH는 코드가 아니라 이름으로 준다(`경남`,`김해시`). 매핑표 이름과 그대로 일치한다
 *   (`창원시 의창구` 띄어쓰기까지). 「중구」처럼 여섯 곳인 이름은 시도로 좁힌다.
 *   하나로 안 좁혀지면 버리고 센다. 세종은 하위 시군구가 없어 매핑표에 없다.
 *
 * ## 모양
 *
 * `public/data/flows/nh-flow.json`은 skt-flow.json을 따라간다. 한 가지 다르다:
 * 유출 파일이 없어 **들어오는 쪽만** 있다. 없는 쪽을 null 배열로 채우면 「그 달 자료
 * 없음」으로 읽히므로, outflow 키 자체를 두지 않는다.
 *
 * 실행: node scripts/adapters/nh-flow.mjs
 */

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\NH 데이터";
const INPUT_DIR = process.env.NH_DIR ?? DEFAULT_INPUT_DIR;

/** 화면에 낼 상대 지역 수. 사람 흐름과 같다. */
export const TOP_N = 8;

/** 경남 시군구인가. 경남 안 흐름은 시도를 안 붙여야 읽기 쉽다(아래 이름 규칙). */
export function isGyeongnam(code) {
  return typeof code === "string" && code.startsWith("48");
}

/**
 * 코드 → 사람이 읽는 이름. 매핑표 이름이 곧 화면 이름이다.
 * 경남 밖은 시도를 붙인다(「중구」는 여섯 곳이라 보고서에 그대로 실리면 안 된다).
 * 매핑표에 없는 코드는 null — 빈칸으로 두지 않는다.
 */
export function moneyRegionName(code, nameByCode) {
  const local = nameByCode.get(code);
  if (!local) return null;
  if (isGyeongnam(code)) return local;
  const sido = SIDO_BY_PREFIX[Number(String(code).slice(0, 2))] ?? null;
  if (!sido) return local;
  if (sido === "세종특별자치시") return sido;
  return `${sido} ${local}`;
}

/**
 * 쓸 수 없는 행이면 null. 호출자가 센다(조용히 버리지 않는다).
 * 날짜는 YYYYMMDD 8자리, 파일 월(yyyymm)과 맞아야 한다 — 다른 달 행이 섞여
 * 들어오면 일평균의 분모가 어긋난다.
 */
export function parseMoneyLine(line, yyyymm, nameByCode) {
  if (!line) return null;
  // BOM은 첫 줄 첫 칸에만 붙는다. 여기서 떼지 않으면 첫 행의 동 코드가 깨진다.
  const fields = line.replace(/^﻿/, "").split(",");
  const dong = (fields[0] ?? "").trim();
  const date = (fields[1] ?? "").trim();
  if (!/^\d{10}$/.test(dong) || !dong.startsWith("48")) return null;
  if (!/^\d{8}$/.test(date) || !date.startsWith(yyyymm)) return null;
  const partner = resolveOriginCode(fields[5], fields[6], nameByCode);
  if (!partner) return null;
  const amount = Number(fields[10]);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const base = dong.slice(0, 5);
  return { base, partner, date, amount, self: base === partner };
}

/**
 * acc: { pairs: Map<`base|partner`, number>, intra: Map<`base`, number>,
 *        dates: Set<string>, self: number, dropped: number }
 * 자기쌍은 값에서 빼되 날짜와 관내 합계는 남긴다. 관내 합계가 없으면
 * 「관외 비중」의 분모가 없어진다.
 */
export function accumulateMoney(acc, parsed) {
  if (!parsed) {
    acc.dropped += 1;
    return acc;
  }
  acc.dates.add(parsed.date);
  if (parsed.self) {
    acc.self += parsed.amount;
    acc.intra.set(parsed.base, (acc.intra.get(parsed.base) ?? 0) + parsed.amount);
    return acc;
  }
  const key = `${parsed.base}|${parsed.partner}`;
  acc.pairs.set(key, (acc.pairs.get(key) ?? 0) + parsed.amount);
  return acc;
}

export function emptyMoneyAcc() {
  return { pairs: new Map(), intra: new Map(), dates: new Set(), self: 0, dropped: 0 };
}

const MILLION = 1_000_000;

/** 지역별 상위 상대 지역·관외 총합·관내 총합. 값은 일평균 백만원(소수 1자리). */
export function finalizeMoney(acc, nameByCode, topN = TOP_N) {
  const days = acc.dates.size;
  const byBase = new Map();
  const toMillion = (won) => Math.round(((days > 0 ? won / days : 0) / MILLION) * 10) / 10;
  for (const [key, sum] of acc.pairs) {
    const [base, partner] = key.split("|");
    const bucket = byBase.get(base) ?? { total: 0, partners: [] };
    const value = toMillion(sum);
    bucket.total = Math.round((bucket.total + value) * 10) / 10;
    bucket.partners.push({ code: partner, name: moneyRegionName(partner, nameByCode), value });
    byBase.set(base, bucket);
  }
  const result = new Map();
  for (const [base, bucket] of byBase) {
    bucket.partners.sort((a, b) => b.value - a.value);
    result.set(base, {
      total: bucket.total,
      top: bucket.partners.slice(0, topN).map((entry) => ({
        code: entry.code,
        name: entry.name,
        value: entry.value,
      })),
    });
  }
  const intra = new Map();
  for (const [base, sum] of acc.intra) intra.set(base, toMillion(sum));
  return { byBase: result, intra, days };
}

// --- 파일 처리 ---

async function aggregateFile(filePath, yyyymm, nameByCode) {
  const rl = readline.createInterface({
    input: createReadStream(filePath, "utf8"),
    crlfDelay: Infinity,
  });
  const acc = emptyMoneyAcc();
  for await (const line of rl) accumulateMoney(acc, parseMoneyLine(line, yyyymm, nameByCode));
  return acc;
}

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-sgg-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "flows", "nh-flow.json");

  const nameByCode = await readSggNameTable(sggNameCsvPath());
  const months = [];
  /** code → { name, inflow: {totals[], top[][], intra[] } } */
  const regions = new Map();
  let dropped = 0;
  let selfTotal = 0;

  for (let month = 1; month <= 12; month += 1) {
    const yyyymm = `2025${String(month).padStart(2, "0")}`;
    months.push(`2025-${String(month).padStart(2, "0")}`);

    const acc = await aggregateFile(
      path.join(INPUT_DIR, `경상남도_1_유입지별카드매출_${yyyymm}.csv`),
      yyyymm,
      nameByCode,
    );
    dropped += acc.dropped;
    selfTotal += acc.self;

    const { byBase, intra, days } = finalizeMoney(acc, nameByCode);

    for (const [code, value] of byBase) {
      const entry =
        regions.get(code) ??
        {
          code,
          name: moneyRegionName(code, nameByCode),
          inflow: {
            totals: new Array(12).fill(null),
            top: new Array(12).fill(null),
            intra: new Array(12).fill(null),
          },
        };
      entry.inflow.totals[month - 1] = value.total;
      entry.inflow.top[month - 1] = value.top;
      regions.set(code, entry);
    }
    for (const [code, value] of intra) {
      const entry = regions.get(code);
      if (entry) entry.inflow.intra[month - 1] = value;
      else {
        // 관외 상대가 한 곳도 없어 top에 안 든 지역. 관내 합계만 남긴다.
        regions.set(code, {
          code,
          name: moneyRegionName(code, nameByCode),
          inflow: {
            totals: new Array(12).fill(null),
            top: new Array(12).fill(null),
            intra: new Array(12).fill(null),
          },
        });
        regions.get(code).inflow.intra[month - 1] = value;
      }
    }
    console.log(
      `${yyyymm} 돈 흐름 집계 완료 (기준지역 ${byBase.size}, 일수 ${days}, 버린 행 ${acc.dropped}건)`,
    );
  }

  /* 경계 파일이 아는 시군구와 대조한다. 한쪽에만 있는 코드는 조용히 넘기지 않는다. */
  let boundaryCodes = null;
  try {
    const boundary = JSON.parse(await readFile(boundaryPath, "utf8"));
    boundaryCodes = new Set(boundary.features.map((f) => String(f.properties.adm_cd2 ?? f.properties.code).slice(0, 5)));
  } catch {
    console.warn("시군구 경계 파일을 찾지 못해 코드 대조를 건너뛴다.");
  }
  if (boundaryCodes) {
    const missing = [...boundaryCodes].filter((code) => !regions.has(code));
    const extra = [...regions.keys()].filter((code) => !boundaryCodes.has(code));
    if (missing.length) console.warn(`돈 흐름 자료에 없는 경계 시군구 ${missing.length}개: ${missing.join(", ")}`);
    if (extra.length) console.warn(`경계에 없는 돈 흐름 시군구 ${extra.length}개: ${extra.join(", ")}`);
  }

  const output = {
    layerId: "nh-flow",
    provider: "NH",
    months,
    referenceMonth: "2025-12",
    topN: TOP_N,
    droppedRows: dropped,
    selfTotalMillion: Math.round((selfTotal / 12 / MILLION) * 10) / 10,
    regions: [...regions.values()].sort((a, b) => a.code.localeCompare(b.code)),
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output));
  console.log(
    `NH 돈 흐름 생성 완료 (${outputPath}): 시군구 ${output.regions.length}곳 · ${months.length}개월 · 버린 행 ${dropped}건`,
  );
}

const isMainModule =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
