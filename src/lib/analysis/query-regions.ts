import { DISTRICT_ALIASES, DISTRICT_GROUP_ALIASES, GYEONGNAM_DISTRICT_LABELS } from "./query-catalog-meta";
import { findPlaceByCode } from "@/lib/geo/place-index";

/**
 * 질의에 적힌 시군구를 찾는다.
 *
 * "창원 생활인구 많은 동"이라고 물었는데 경남 전체 1위인 양산시 물금읍을 답하고 있었다
 * (prod 실측). 사용자가 지역을 지정하면 그 안에서 줄을 세워야 한다.
 *
 * 긴 이름부터 본다 — "창원시 성산구"가 "창원"보다 먼저 잡혀야 구 단위 질의가 산다.
 * 큐브 셀 이름이 "창원시성산구 …"처럼 붙어 있어 공백을 뺀 형태로도 맞춰 본다.
 */
const REGION_TOKENS = (() => {
  const tokens: Array<{ match: string; filters: readonly string[] }> = [];
  for (const label of GYEONGNAM_DISTRICT_LABELS) {
    const compact = label.replace(/\s+/g, "");
    tokens.push({ match: compact, filters: [label] });
    // "김해" → 김해시, "거창" → 거창군. 군을 빼먹어 경남 10개 군 전체가 축약형으로
    // 안 걸렸다 — "거창 카드매출 높은 곳"이 경남 전체 순위를 답했다(prod 실측).
    const short = compact.replace(/[시군]$/, "");
    if (short !== compact) tokens.push({ match: short, filters: [label] });
    // "창원" → 창원시 전체(5개 구). 어느 구인지 안 적었으면 시 전체로 본다.
    const cityHead = compact.match(/^(.+?시)(?=.*구$)/)?.[1];
    if (cityHead) {
      tokens.push({ match: cityHead, filters: [cityHead] });
      tokens.push({ match: cityHead.replace(/시$/, ""), filters: [cityHead] });
    }
  }
  for (const [match, filter] of Object.entries(DISTRICT_ALIASES)) tokens.push({ match, filters: [filter] });
  for (const [match, filters] of Object.entries(DISTRICT_GROUP_ALIASES)) {
    tokens.push({ match, filters });
    // Parent qualifiers belong to this place, rather than adding all five Changwon districts.
    tokens.push({ match: `창원${match}`, filters });
    tokens.push({ match: `창원시${match}`, filters });
  }
  const seen = new Set<string>();
  return tokens
    .filter((token) => (seen.has(token.match) ? false : (seen.add(token.match), true)))
    .sort((a, b) => b.match.length - a.match.length);
})();

export function detectRegionFilter(query: string, dongNames: readonly string[] = []): string | null {
  return detectRegionFilters(query, dongNames)[0] ?? null;
}

/**
 * 질의에 적힌 지역을 **모두** 찾는다.
 *
 * "창원과 김해의 생활인구"에서 하나만 잡으면 나머지를 조용히 버린다(prod에서 김해가
 * 사라졌다). 읍면동이 시군구보다 좁으므로 먼저 보고, 겹치는 것은 긴 쪽만 남긴다.
 */
export function detectRegionFilters(query: string, dongNames: readonly string[] = []): string[] {
  const compact = query.replace(/\s+/g, "");
  const found: Array<{ at: number; length: number; filters: readonly string[]; kind: "dong" | "sgg" }> = [];

  for (const name of dongNames) {
    const key = name.replace(/\s+/g, "");
    if (key.length < 2) continue;
    for (let at = compact.indexOf(key); at >= 0; at = compact.indexOf(key, at + key.length)) {
      found.push({ at, length: key.length, filters: [key], kind: "dong" });
    }
  }
  for (const { match, filters } of REGION_TOKENS) {
    if (match.length < 2) continue;
    for (let at = compact.indexOf(match); at >= 0; at = compact.indexOf(match, at + match.length)) {
      found.push({ at, length: match.length, filters, kind: "sgg" });
    }
  }

  // 같은 자리를 여러 이름이 물면 긴 쪽만 남긴다("물금읍"이 "양산시"를, "창원시성산구"가
  // "창원시"를 이긴다).
  found.sort((left, right) => right.length - left.length);
  const kept: typeof found = [];
  for (const item of found) {
    const overlaps = kept.some(
      (other) => item.at < other.at + other.length && other.at < item.at + item.length,
    );
    if (!overlaps) kept.push(item);
  }
  /*
   * "양산시 물금읍"처럼 시군구 바로 뒤에 읍면동이 붙으면 한 곳을 가리키는 말이다.
   * 둘 다 남기면 어느 하나라도 맞으면 통과라 양산 전체로 넓어진다 — 물어본 것보다 넓다.
   * 동명이인이 다른 시군구에 있을 수 있으므로 시군구와 읍면동을 결합한 한 범위를 남긴다.
   * 붙어 있거나 ‘의’로 이어진 경우만 결합한다. 떨어진 지역은 각각 유지한다.
   */
  const consumed = new Set<(typeof found)[number]>();
  const qualified = kept.map((item) => {
    if (item.kind !== "dong") return item;
    const parent = kept.find((other) => other.kind === "sgg" && other.at + other.length <= item.at &&
      /^의?$/.test(compact.slice(other.at + other.length, item.at)));
    if (!parent) return item;
    consumed.add(parent);
    return { ...item, filters: parent.filters.map((filter) => `${filter} ${item.filters[0]}`) };
  });
  const narrowed = qualified.filter((item) => !consumed.has(item));

  const seen = new Set<string>();
  return narrowed
    .sort((left, right) => left.at - right.at)
    .flatMap((item) => item.filters)
    .filter((filter) => (seen.has(filter) ? false : (seen.add(filter), true)));
}

/** Scope references inherit the last analysis, while an explicit place starts a new scope. */
export function contextualizeRegionQuery(
  query: string,
  previousRegions: readonly string[],
  dongNames: readonly string[] = [],
): string {
  if (!/그\s*중|이 결과|그 지역|여기서|여기만|방금|이어서|추가로/.test(query) ||
      previousRegions.length === 0 || detectRegionFilters(query, dongNames).length > 0) return query;
  const names = previousRegions.map((region) => findPlaceByCode(region)?.adm_nm ?? region);
  return `${names.join(" ")} ${query}`;
}

