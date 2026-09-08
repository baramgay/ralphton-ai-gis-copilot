import { readFile } from "node:fs/promises";

/**
 * NH 유입지 파일의 출발지 표기(이름)를 5자리 시군구 코드로 푼다.
 *
 * SKT는 코드를 주고(skt-flow.mjs의 SIDO_BY_PREFIX), NH는 이름을 준다
 * (`경남`,`김해시`). 이름만으로는 「중구」가 여섯 곳이라, 시도와 함께 푼다.
 * 매핑표(`(매핑테이블)행정동코드_5자리(시군구 단위)_260624.csv`)는 코드→이름이라
 * 역방향 색인을 여기서 만든다. 세종은 하위 시군구가 없어 매핑표에 없다 —
 * 붙일 코드가 없으므로 버리고 센다(조용히 두지 않는다).
 */

const DEFAULT_SGG_NAME_CSV =
  "C:\\업무\\민간데이터\\(매핑테이블)행정동코드_5자리(시군구 단위)_260624.csv";

export function sggNameCsvPath() {
  return process.env.NH_SGG_NAME_CSV ?? DEFAULT_SGG_NAME_CSV;
}

/** NH 시도 짧은 이름 → 코드 앞 두 자리. 원자료에 실제로 나온 것만 적는다. */
export const SIDO_SHORT_PREFIX = {
  서울: ["11"],
  부산: ["26"],
  대구: ["27"],
  인천: ["28"],
  광주: ["29"],
  대전: ["30"],
  울산: ["31"],
  세종: [],
  경기: ["41"],
  충북: ["43"],
  충남: ["44"],
  전남: ["46"],
  경북: ["47"],
  경남: ["48"],
  제주: ["50"],
  강원: ["51"],
  전북: ["52"],
};

export async function readSggNameTable(csvPath) {
  const text = await readFile(csvPath, "utf8");
  const table = new Map();
  const lines = text.split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const [code, name] = line.split(",");
    if (code && name) table.set(code.trim(), name.trim());
  }
  return table;
}

/**
 * (시도, 시군구) → 5자리 코드. 하나로 안 좁혀지면 null.
 *
 * 같은 이름이 같은 시도 짧은 이름 안에 두 번 나오면(현재 자료에는 없다)
 * 찍는 게 아니라 버린다 — 엉뚱한 도시의 돈을 붙이는 것보다 낫다.
 */
export function resolveOriginCode(sidoShort, sggName, nameByCode) {
  const sido = (sidoShort ?? "").trim();
  const name = (sggName ?? "").trim();
  if (!sido || !name) return null;
  const prefixes = SIDO_SHORT_PREFIX[sido];
  if (!prefixes || prefixes.length === 0) return null;
  const hits = [];
  for (const [code, codeName] of nameByCode) {
    if (codeName !== name) continue;
    if (prefixes.some((prefix) => code.startsWith(prefix))) hits.push(code);
  }
  return hits.length === 1 ? hits[0] : null;
}
