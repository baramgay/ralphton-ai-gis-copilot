import { GYEONGNAM_DISTRICT_LABELS } from "@/lib/analysis/query-catalog-meta";
import type { AdminLevel, LayerDescriptor, MetricDef } from "@/lib/layers/types";

/** A layer descriptor with or without its resolved `months` (catalog entries omit months). */
type LayerLike = Omit<LayerDescriptor, "months"> | LayerDescriptor;

export type LayerQueryMatch = {
  layerId: string;
  /** 낮은 쪽을 물었으면 "asc". 기본은 큰 값부터. */
  direction: "desc" | "asc";
  /** 질의에 적힌 지역들. 순위를 그 안으로 좁힌다. 없으면 빈 배열. */
  regionFilters: string[];
  layerLabel: string;
  provider: LayerDescriptor["provider"];
  metricKey: string;
  metricLabel: string;
  adminLevel: AdminLevel;
  /** 셀 모양. 격자면 답의 단위를 "행정동"이라 말하면 안 된다. */
  geometry: "admin" | "grid";
  matchedTrigger: string;
};

/**
 * 격자를 요구하는 표현.
 *
 * "격자"는 지표 이름이 아니라 **단위**다. 그런데 트리거에 "격자 소득"처럼 이름의 일부로만
 * 적혀 있어서, 두 낱말이 붙어 있지 않으면 통째로 놓쳤다 — "격자로 봤을 때 소득 낮은 블록"이
 * 조용히 행정동 평균소득으로 떨어졌다(prod 실측, 6개 표현 중 5개 실패). 단위 신호는 따로 본다.
 */
const GRID_CUES = ["격자", "블록", "그리드", "500m", "500 m"] as const;

export function detectGridScope(query: string): boolean {
  const compact = query.replace(/\s+/g, "");
  return GRID_CUES.some((cue) => compact.includes(cue.replace(/\s+/g, "")));
}

/** 시군구 단위를 명시적으로 요구하는 표현. 없으면 행정동(dong) 기본. */
const SGG_CUES = [
  "시군구",
  "시·군·구",
  "시군별",
  "구별",
  "군별",
  "시별",
  "지자체별",
  "행정구역별",
] as const;

/**
 * 읍면동을 명시적으로 요구하는 표현. 이것이 없으면 직전 질의의 단위가 그대로 이어져,
 * "시군구별 소득" 다음에 "카드매출 늘어나는 동"을 물어도 시군구로 답했다(prod 실측).
 * "동"만으로는 "동읍"·"동면" 같은 지명에 걸리므로 뒤에 조사·어미가 오는 꼴만 본다.
 */
const DONG_CUES = [
  "읍면동",
  "행정동",
  "동별",
  "동네",
  "동 ",
  "동?",
] as const;

/**
 * 낮은 쪽을 묻는 표현.
 *
 * 정책 질의의 상당수가 "적은·낮은·취약한 곳"인데 이걸 안 보면 정반대 순위를 답한다
 * ("생활인구 적은 곳"에 양산시 물금읍 97,787명을 1위로 내놓고 있었다 — prod 실측).
 * "높은"이 함께 있으면 그쪽을 따른다("소득 대비 낮은"처럼 비교 표현일 수 있다).
 */
// "없는"도 가장 적은 쪽을 묻는 말이다. 없으면 "카드매출이 없는 동"에 가장 많은 곳을
// 답한다(prod 실측) — 정반대다.
const LOW_CUES = ["적은", "낮은", "작은", "하위", "부족한", "없는", "가난", "못 사는", "적게", "낮게"];
const HIGH_CUES = ["많은", "높은", "큰", "상위", "잘 사는", "잘사는", "부유", "많이", "높게"];

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
  const tokens: Array<{ match: string; filter: string }> = [];
  for (const label of GYEONGNAM_DISTRICT_LABELS) {
    const compact = label.replace(/\s+/g, "");
    tokens.push({ match: compact, filter: label });
    // "김해" → 김해시
    const short = compact.replace(/시$/, "");
    if (short !== compact) tokens.push({ match: short, filter: label });
    // "창원" → 창원시 전체(5개 구). 어느 구인지 안 적었으면 시 전체로 본다.
    const cityHead = compact.match(/^(.+?시)(?=.*구$)/)?.[1];
    if (cityHead) {
      tokens.push({ match: cityHead, filter: cityHead });
      tokens.push({ match: cityHead.replace(/시$/, ""), filter: cityHead });
    }
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
  const found: Array<{ at: number; length: number; filter: string; kind: "dong" | "sgg" }> = [];

  for (const name of dongNames) {
    const key = name.replace(/\s+/g, "");
    if (key.length < 2) continue;
    const at = compact.indexOf(key);
    if (at >= 0) found.push({ at, length: key.length, filter: key, kind: "dong" });
  }
  for (const { match, filter } of REGION_TOKENS) {
    if (match.length < 2) continue;
    const at = compact.indexOf(match);
    if (at >= 0) found.push({ at, length: match.length, filter, kind: "sgg" });
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
   * 붙어 있는 경우만 좁은 쪽을 남긴다("창원과 김해"처럼 떨어져 있으면 둘 다 살린다).
   */
  const narrowed = kept.filter(
    (item) =>
      item.kind === "dong" ||
      !kept.some((other) => other.kind === "dong" && Math.abs(other.at - (item.at + item.length)) <= 1),
  );

  const seen = new Set<string>();
  return narrowed
    .sort((left, right) => left.at - right.at)
    .map((item) => item.filter)
    .filter((filter) => (seen.has(filter) ? false : (seen.add(filter), true)));
}

export function detectDirection(query: string): "desc" | "asc" {
  const low = LOW_CUES.map((cue) => query.indexOf(cue)).filter((at) => at >= 0);
  const high = HIGH_CUES.map((cue) => query.indexOf(cue)).filter((at) => at >= 0);
  if (low.length === 0) return "desc";
  if (high.length === 0) return "asc";
  // 둘 다 있으면 뒤에 오는 쪽이 정렬 방향을 정한다("소득 낮고 소비 많은" → 많은 순).
  return Math.max(...low) > Math.max(...high) ? "asc" : "desc";
}

/**
 * "상위 5곳만"처럼 **몇 개를 보고 싶은지**를 읽는다. 없으면 null.
 *
 * 숫자를 아무거나 집으면 안 된다. 질의에는 개수가 아닌 숫자가 훨씬 많다 — "20대 여성",
 * "2km 안", "500m 격자", "최근 6개월", "3분위". 그래서 **개수를 세는 단위가 숫자 바로
 * 뒤에 붙어 있을 때만** 개수로 본다.
 */
const COUNT_UNITS = ["곳", "군데", "동네", "개"];
/** 숫자 앞에 붙으면 개수가 아닌 것이 확실한 말. */
const NOT_COUNT_BEFORE = ["최근", "지난", "최소", "반경"];
/**
 * "개" 뒤에 이어지면 단위가 아직 안 끝난 것 — 개수가 아니다.
 * 조사(만·는·를…)와 갈라야 한다. "10개만"의 만은 조사, "6개월"의 월은 단위다.
 */
const NOT_COUNT_AFTER_GAE = ["월", "소", "국", "년", "사"];

export function detectResultCount(query: string): number | null {
  const text = query.replace(/\s+/g, " ");
  const pattern = new RegExp(`(\\d{1,3})\\s*(${COUNT_UNITS.join("|")})`, "g");
  for (const match of text.matchAll(pattern)) {
    const at = match.index ?? 0;
    const before = text.slice(Math.max(0, at - 6), at);
    if (NOT_COUNT_BEFORE.some((word) => before.includes(word))) continue;
    if (match[2] === "개") {
      const next = text.charAt(at + match[0].length);
      if (NOT_COUNT_AFTER_GAE.includes(next)) continue;
    }
    const value = Number(match[1]);
    // 0곳은 뜻이 없고, 세 자리를 넘으면 개수 지정이라기보다 값이다.
    if (!Number.isFinite(value) || value < 1 || value > 300) continue;
    return value;
  }
  return null;
}

export function detectAdminLevel(query: string, fallback: AdminLevel = "dong"): AdminLevel {
  if (SGG_CUES.some((cue) => query.includes(cue))) return "sgg";
  // 문장 끝의 "…동"도 명시로 본다("카드매출 늘어나는 동").
  if (DONG_CUES.some((cue) => query.includes(cue)) || /동$/.test(query.trim())) return "dong";
  return fallback;
}

/** 레이어가 지원하는 단위로 되돌린다. 지원 목록이 없으면 요청한 그대로 둔다. */
function supportedLevel(layer: LayerLike, wanted: AdminLevel): AdminLevel {
  const levels = layer.adminLevels;
  if (!levels || levels.length === 0 || levels.includes(wanted)) return wanted;
  return levels[0];
}

/**
 * 트리거를 찾을 때 띄어쓰기는 무시한다.
 *
 * "생활 인구 많은 동"이 공공 총인구로 새고 있었다 — "생활인구" 트리거가 공백 때문에
 * 안 맞고 더 짧은 "인구"가 잡혔다(prod 실측). 사용자가 어디를 띄어 쓸지는 알 수 없으니
 * 양쪽을 붙여서 맞춘다. 길이 비교는 원래 트리거로 해야 "생활인구"가 "인구"를 이긴다.
 *
 * 격자 레이어에서는 단위를 뜻하는 앞머리("격자 소득" → "소득")를 떼고도 맞춰 본다.
 * 질의가 이미 "격자"라고 말했으므로 남은 말이 지표 이름이다. 길이 비교는 원래 트리거로
 * 하므로 격자 지표끼리의 우열("격자 평균소득" > "격자 소득")은 그대로다.
 *
 * 두 낱말짜리 트리거는 사이에 **조사**가 끼어도 맞춘다. "의료 부족"이 "의료도 부족하고"에
 * 안 맞아 교차분석에서 의료 조건이 통째로 빠졌다(prod 실측). 사람은 "의료도"·"병원이"라고
 * 쓰지 "의료 부족"이라고 쓰지 않는다. 끼워 넣을 수 있는 것은 조사 두 글자까지로 못박아
 * 둔다 — 아무 말이나 건너뛰게 하면 무관한 지표를 뺏어 온다.
 */
const GRID_NAME_PREFIX = /^(격자|블록|동네 안)\s*/;
const PARTICLE_GAP = "[은는이가도을를의에서와과만로]{0,2}";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function triggerMatches(compactText: string, trigger: string): boolean {
  if (compactText.includes(trigger.replace(/\s+/g, ""))) return true;
  const parts = trigger.trim().split(/\s+/);
  if (parts.length < 2) return false;
  return new RegExp(parts.map(escapeRegExp).join(PARTICLE_GAP)).test(compactText);
}

function bestTriggerMatch(text: string, metric: MetricDef, stripGridPrefix = false): string | null {
  const compactText = text.replace(/\s+/g, "");
  let best: string | null = null;
  for (const trigger of metric.triggers) {
    const forms = [trigger];
    if (stripGridPrefix) {
      const bare = trigger.replace(GRID_NAME_PREFIX, "");
      if (bare && bare !== trigger) forms.push(bare);
    }
    if (!forms.some((form) => triggerMatches(compactText, form))) continue;
    if (best === null || trigger.length > best.length) best = trigger;
  }
  return best;
}

/**
 * Resolve a natural-language query to a private/cube layer + metric using each
 * MetricDef's declared `triggers`. The longest matching trigger across all passed
 * layers wins, so a specific private cue ("생활인구") beats a generic public one
 * ("인구") even though "생활인구" contains "인구".
 *
 * Callers pass only the layers that should be reachable by NL layer-switching —
 * typically the private providers (SKT/NH/KCB) — so this never hijacks queries that
 * the public tool-registry already serves (e.g. "인구 많은 동" → rankPopulationSize).
 */
export function resolveLayerQuery(
  query: string,
  layers: readonly LayerLike[],
  options: { adminLevelFallback?: AdminLevel; dongNames?: readonly string[] } = {},
): LayerQueryMatch | null {
  const text = query.replace(/\s+/g, " ").trim();
  if (!text) return null;

  let best: (LayerQueryMatch & { triggerLength: number; gridRank: number }) | null = null;
  // 단위를 격자로 요구했으면 격자 레이어가 이름 길이와 무관하게 이긴다. "격자 소득"의
  // "소득"(2자)이 행정동 "평균소득"(4자)에 지면 요구한 단위가 조용히 무시된다.
  const wantsGrid = detectGridScope(text);

  for (const layer of layers) {
    const isGrid = layer.geometry === "grid";
    for (const metric of layer.metrics) {
      const trigger = bestTriggerMatch(text, metric, wantsGrid && isGrid);
      if (trigger === null) continue;
      const gridRank = wantsGrid && isGrid ? 1 : 0;
      if (
        best === null ||
        gridRank > best.gridRank ||
        (gridRank === best.gridRank && trigger.length > best.triggerLength)
      ) {
        best = {
          layerId: layer.id,
          layerLabel: layer.label,
          provider: layer.provider,
          metricKey: metric.key,
          metricLabel: metric.label,
          // 시군구까지만 있는 지표는 읍면동으로 물어도 시군구로 답해야 한다.
          // 그러지 않으면 같은 값을 나눠 가진 읍면동들에 임의의 순위가 매겨진다.
          // 반대로 레이어가 지원하지 않는 단위는 요구해도 줄 수 없다 — 격자는 코드가
          // "gx_gy"라 앞 5자리를 잘라도 시군구가 되지 않는다.
          adminLevel: supportedLevel(
            layer,
            metric.scope === "sgg"
              ? "sgg"
              : detectAdminLevel(text, options.adminLevelFallback ?? "dong"),
          ),
          direction: detectDirection(text),
          regionFilters: detectRegionFilters(text, options.dongNames ?? []),
          geometry: isGrid ? "grid" : "admin",
          matchedTrigger: trigger,
          triggerLength: trigger.length,
          gridRank,
        };
      }
    }
  }

  if (best === null) return null;
  const { triggerLength: _triggerLength, gridRank: _gridRank, ...match } = best;
  return match;
}
