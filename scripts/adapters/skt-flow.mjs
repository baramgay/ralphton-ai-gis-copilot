import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

/**
 * SKT 유입·유출인구(시군구) → **지역 간 이동 흐름**.
 *
 * ## 왜 따로 만드는가
 *
 * 이동인구 레이어(`skt-mobility`)는 「이 동에 몇 명이 들어오는가」를 지도에 칠한다.
 * 그런데 원자료는 **어디서 오는지**를 함께 준다(유입은 출발 거주지 시군구, 유출은
 * 도착지 시군구). 지금까지 그 열을 읽고 버려 왔다 — 새로 내려받을 자료 없이
 * 「창원에서 김해로」를 셀 수 있는데 화면에는 총량만 있었다.
 *
 * 흐름은 지역 **한 쌍**에 붙는 값이라 지도 한 칸에 칠할 수 없다. 그래서 큐브가 아니라
 * 따로 만들어 선택한 지역의 상위 상대 지역을 목록으로 보여 준다.
 *
 * ## 원천
 *
 * 유입 `4. 유입인구/gn_inflow_pop_sgg_YYYYMM.csv`
 *   BASE_DATE|SGG_CD(경남 목적지)|RSDN_SGG_CD(출발 거주지)|M00..F80
 * 유출 `5. 유출인구/gn_outflow_pop_sgg_YYYYMM.csv`
 *   BASE_DATE|RSDN_SGG_CD(경남 거주지)|SGG_CD(도착지)|M00..F80
 *
 * 파이프 구분, UTF-8, 헤더 있음. 성·연령 밴드 32개의 합이 인원(모델 추정값이라 소수).
 *
 * ## 셈법
 *
 * 지역쌍별 밴드 총합 ÷ 그 달의 구분일수 = **일평균 인원**. 행 수가 상대지역×일수라
 * 행 수로 나누면 안 된다(이동인구 어댑터와 같은 규약).
 *
 * **자기 자신 쌍은 뺀다.** 2025-12 실측으로 김해시의 자기쌍은 일평균 541,525명인데
 * 다음 상대(부산 북구)는 13,066명이다 — 관내 거주자를 같이 세면 순위가 아니라 그
 * 도시의 인구를 보게 된다.
 *
 * 창원시의 다섯 구는 원자료가 서로 다른 코드로 주므로 구를 넘는 이동이 흐름으로 잡힌다.
 * 지우지 않는다 — 실제로 다른 행정구 사이의 이동이고, 화면 한계 문구에 그대로 적는다.
 *
 * 실행: node scripts/adapters/skt-flow.mjs
 */

const DEFAULT_INPUT_DIR = "C:\\업무\\민간데이터\\SKT 데이터";
const INPUT_DIR = process.env.SKT_MOBILITY_DIR ?? DEFAULT_INPUT_DIR;
const DEFAULT_SGG_NAME_CSV =
  "C:\\업무\\민간데이터\\(매핑테이블)행정동코드_5자리(시군구 단위)_260624.csv";
const SGG_NAME_CSV = process.env.SKT_SGG_NAME_CSV ?? DEFAULT_SGG_NAME_CSV;

/** 화면에 낼 상대 지역 수. 목록이 길면 읽히지 않고, 짧으면 흐름이 안 보인다. */
export const TOP_N = 8;

/**
 * 코드 앞 두 자리 → 시도.
 *
 * 원자료에 실제로 나온 것만 적는다(2025-12 실측: 11·26·27·28·29·30·31·36·41·43·44·
 * 46·47·48·50·51·52). 강원·전북은 **특별자치도로 바뀐 코드**(51·52)로 오고 옛 코드
 * (42·45)는 오지 않는다 — 옛 코드를 적어 두면 안 오는 이름을 준비하는 셈이라 넣지 않는다.
 */
export const SIDO_BY_PREFIX = {
  11: "서울특별시",
  26: "부산광역시",
  27: "대구광역시",
  28: "인천광역시",
  29: "광주광역시",
  30: "대전광역시",
  31: "울산광역시",
  36: "세종특별자치시",
  41: "경기도",
  43: "충청북도",
  44: "충청남도",
  46: "전라남도",
  47: "경상북도",
  48: "경상남도",
  50: "제주특별자치도",
  51: "강원특별자치도",
  52: "전북특별자치도",
};

/** 경남 시군구인가. 경남 안 흐름은 시도를 안 붙여야 읽기 쉽다. */
export function isGyeongnam(code) {
  return typeof code === "string" && code.startsWith("48");
}

/**
 * 코드 → 사람이 읽는 이름.
 *
 * 매핑표는 「중구」처럼 시도 없이 준다. 「중구」만 적으면 서울·부산·대구·인천·대전·울산
 * 중 어디인지 알 수 없다 — 보고서에 그대로 실리는 이름이라 시도를 붙인다.
 * 경남은 이 도구의 분석 대상이라 시도를 떼고 「김해시」로 적는다.
 * 세종은 하위 시군구가 없어 매핑표에 없다 — 시도 이름이 곧 지역 이름이다.
 */
export function regionName(code, nameByCode) {
  const sido = SIDO_BY_PREFIX[Number(String(code).slice(0, 2))];
  const local = nameByCode.get(code);
  if (!sido) return local ?? null;
  if (isGyeongnam(code)) return local ?? null;
  if (!local) return sido === "세종특별자치시" ? sido : null;
  return `${sido} ${local}`;
}

export function computeFlowIndices(columns) {
  const dateIdx = columns.indexOf("BASE_DATE");
  /*
   * 기준(경남) 지역과 상대 지역이 파일마다 자리를 바꾼다. 유입은 목적지가 경남(SGG_CD),
   * 유출은 거주지가 경남(RSDN_SGG_CD)이다. 자리를 굳혀 두면 한쪽 파일에서 방향이 뒤집힌
   * 채로 조용히 집계된다.
   */
  const inflow = columns[1] === "SGG_CD";
  const baseIdx = 1;
  const partnerIdx = 2;
  if (dateIdx < 0) throw new Error("CSV 헤더에 BASE_DATE 컬럼이 없습니다.");
  if (columns[1] !== "SGG_CD" && columns[1] !== "RSDN_SGG_CD") {
    throw new Error(`두 번째 컬럼이 SGG_CD/RSDN_SGG_CD가 아닙니다: ${columns[1]}`);
  }
  const m00Idx = columns.indexOf("M00");
  return { dateIdx, baseIdx, partnerIdx, numericStart: m00Idx >= 0 ? m00Idx : 3, inflow };
}

/** 쓸 수 없는 행이면 null. 호출자가 센다(조용히 버리지 않는다). */
export function parseFlowLine(line, indices) {
  if (!line) return null;
  const fields = line.split("|");
  const base = fields[indices.baseIdx];
  const partner = fields[indices.partnerIdx];
  const date = fields[indices.dateIdx];
  if (!base || !partner || !date) return null;
  /* 원자료에 빈 따옴표 코드가 섞여 온다(2025-12 실측 1건). 지역이 아니다. */
  if (!/^\d{5}$/.test(base) || !/^\d{5}$/.test(partner)) return null;
  if (!isGyeongnam(base)) return null;
  let sum = 0;
  for (let i = indices.numericStart; i < fields.length; i += 1) {
    const value = Number(fields[i]);
    if (Number.isFinite(value)) sum += value;
  }
  return { base, partner, date, sum, self: base === partner };
}

/**
 * acc: { pairs: Map<`base|partner`, number>, dates: Set<string>, self: number, dropped: number }
 * 자기쌍은 값에서 빼되 날짜는 남긴다 — 일수를 줄이면 일평균이 부풀려진다.
 */
export function accumulateFlow(acc, parsed) {
  if (!parsed) {
    acc.dropped += 1;
    return acc;
  }
  acc.dates.add(parsed.date);
  if (parsed.self) {
    acc.self += parsed.sum;
    return acc;
  }
  const key = `${parsed.base}|${parsed.partner}`;
  acc.pairs.set(key, (acc.pairs.get(key) ?? 0) + parsed.sum);
  return acc;
}

export function emptyFlowAcc() {
  return { pairs: new Map(), dates: new Set(), self: 0, dropped: 0 };
}

/** 지역별 상위 상대 지역과 관외 총합. 값은 일평균이다. */
export function finalizeFlow(acc, nameByCode, topN = TOP_N) {
  const days = acc.dates.size;
  const byBase = new Map();
  for (const [key, sum] of acc.pairs) {
    const [base, partner] = key.split("|");
    const bucket = byBase.get(base) ?? { total: 0, partners: [] };
    const value = days > 0 ? sum / days : null;
    if (value !== null) {
      bucket.total += value;
      bucket.partners.push({ code: partner, name: regionName(partner, nameByCode), value });
    }
    byBase.set(base, bucket);
  }
  const result = new Map();
  for (const [base, bucket] of byBase) {
    bucket.partners.sort((a, b) => b.value - a.value);
    result.set(base, {
      total: Math.round(bucket.total * 10) / 10,
      top: bucket.partners.slice(0, topN).map((entry) => ({
        code: entry.code,
        name: entry.name,
        value: Math.round(entry.value * 10) / 10,
      })),
    });
  }
  return result;
}

// --- 파일 처리 ---

async function readNameTable(csvPath) {
  const text = await readFile(csvPath, "utf8");
  const table = new Map();
  const lines = text.split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const [code, name] = line.split(",");
    if (code && name) table.set(code.trim(), name.trim());
  }
  return table;
}

async function aggregateFile(filePath) {
  const rl = readline.createInterface({
    input: createReadStream(filePath, "utf8"),
    crlfDelay: Infinity,
  });
  const acc = emptyFlowAcc();
  let indices = null;
  for await (const line of rl) {
    if (indices === null) {
      indices = computeFlowIndices(line.split("|"));
      continue;
    }
    accumulateFlow(acc, parseFlowLine(line, indices));
  }
  return acc;
}

async function main() {
  const projectRoot = fileURLToPath(new URL("../../", import.meta.url));
  const boundaryPath = path.join(projectRoot, "public", "data", "administrative-sgg-20260701.geojson");
  const outputPath = path.join(projectRoot, "public", "data", "flows", "skt-flow.json");

  const nameByCode = await readNameTable(SGG_NAME_CSV);
  const months = [];
  /** code → { name, inflow: {totals[], top[][]}, outflow: {...} } */
  const regions = new Map();
  let dropped = 0;

  for (let month = 1; month <= 12; month += 1) {
    const yyyymm = `2025${String(month).padStart(2, "0")}`;
    months.push(`2025-${String(month).padStart(2, "0")}`);

    const inflow = await aggregateFile(
      path.join(INPUT_DIR, "4. 유입인구", `gn_inflow_pop_sgg_${yyyymm}.csv`),
    );
    const outflow = await aggregateFile(
      path.join(INPUT_DIR, "5. 유출인구", `gn_outflow_pop_sgg_${yyyymm}.csv`),
    );
    dropped += inflow.dropped + outflow.dropped;

    const inflowByBase = finalizeFlow(inflow, nameByCode);
    const outflowByBase = finalizeFlow(outflow, nameByCode);

    for (const [code, value] of inflowByBase) {
      const entry =
        regions.get(code) ??
        {
          code,
          name: regionName(code, nameByCode),
          inflow: { totals: new Array(12).fill(null), top: new Array(12).fill(null) },
          outflow: { totals: new Array(12).fill(null), top: new Array(12).fill(null) },
        };
      entry.inflow.totals[month - 1] = value.total;
      entry.inflow.top[month - 1] = value.top;
      regions.set(code, entry);
    }
    for (const [code, value] of outflowByBase) {
      const entry = regions.get(code);
      if (!entry) continue;
      entry.outflow.totals[month - 1] = value.total;
      entry.outflow.top[month - 1] = value.top;
    }
    console.log(
      `${yyyymm} 흐름 집계 완료 (유입 기준지역 ${inflowByBase.size}, 유출 기준지역 ${outflowByBase.size}, 일수 ${inflow.dates.size})`,
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
    if (missing.length) console.warn(`흐름 자료에 없는 경계 시군구 ${missing.length}개: ${missing.join(", ")}`);
    if (extra.length) console.warn(`경계에 없는 흐름 시군구 ${extra.length}개: ${extra.join(", ")}`);
  }

  const output = {
    layerId: "skt-flow",
    provider: "SKT",
    months,
    referenceMonth: "2025-12",
    topN: TOP_N,
    droppedRows: dropped,
    regions: [...regions.values()].sort((a, b) => a.code.localeCompare(b.code)),
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(output));
  console.log(
    `SKT 이동 흐름 생성 완료 (${outputPath}): 시군구 ${output.regions.length}곳 · ${months.length}개월 · 버린 행 ${dropped}건`,
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
