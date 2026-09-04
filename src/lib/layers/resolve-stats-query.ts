import { neutralizeNegatedDirection } from "@/lib/analysis/query-catalog-meta";
import type { CorrelationUnit } from "@/lib/analysis/statistics";
import { allMatches, pruneOverlaps, type CrossOperandRef } from "@/lib/layers/resolve-cross-query";
import { detectAdminLevel, detectRegionFilters } from "@/lib/layers/resolve-layer-query";
import type { AdminLevel, LayerDescriptor } from "@/lib/layers/types";

type LayerLike = Omit<LayerDescriptor, "months"> | LayerDescriptor;

export type CorrelationQueryMatch = {
  kind: "correlation";
  a: CrossOperandRef;
  b: CrossOperandRef;
  adminLevel: AdminLevel;
  /**
   * 계수를 낼 단위.
   *
   * 한쪽이라도 시군구까지만 있는 지표면 **시군구로 내려간다.** 읍면동 305칸으로 내면
   * 같은 값이 14번 복제된 표본이라 n이 부풀고, 그 n으로 "유의하다"고 말하면 거짓이다.
   */
  unit: CorrelationUnit;
  regionFilters: string[];
};

export type OutlierQueryMatch = {
  kind: "outlier";
  ref: CrossOperandRef;
  adminLevel: AdminLevel;
  unit: CorrelationUnit;
  regionFilters: string[];
};

export type StatsQueryMatch = CorrelationQueryMatch | OutlierQueryMatch;

/**
 * 두 지표의 **관계**를 묻는 말.
 *
 * 교차분석(`resolveCrossQuery`)과 재료가 같아서(지표 둘) 먼저 갈라야 한다. 물음이 다르다 —
 * 교차는 "둘 다 높은 곳이 어디냐", 상관은 "둘이 같이 움직이냐"다.
 */
const CORRELATION_CUES = [
  "상관",
  "상관관계",
  "관계가",
  "관계는",
  "연관",
  "관련이",
  "관련성",
  "같이 움직",
  "함께 움직",
  "따라가",
  "비례",
];

/** 한 지표에서 **튀는 곳**을 묻는 말. */
const OUTLIER_CUES = ["이상치", "특이한", "특이하게", "튀는", "유별난", "동떨어진", "예외적", "눈에 띄게 다른"];

/**
 * 상관을 물었는데 "원인"·"때문"이 같이 있으면 그 말을 기억해 둔다.
 *
 * 상관은 인과가 아니다. 사용자가 인과로 물었다는 사실을 알면 답에서 그것을 짚어 줄 수
 * 있다 — 계수만 돌려주면 "그래서 원인이 맞다"로 읽힌다.
 */
const CAUSAL_CUES = ["원인", "때문", "영향을", "탓", "인과"];

export function asksCausation(query: string): boolean {
  return CAUSAL_CUES.some((cue) => query.includes(cue));
}

/** `Match.sggOnly`가 이미 「시군구까지만 있는 지표」를 들고 있다. 그것을 그대로 쓴다. */
function unitOf(matches: readonly { sggOnly: boolean }[]): CorrelationUnit {
  return matches.some((match) => match.sggOnly) ? "sgg" : "dong";
}

export function resolveStatsQuery(
  query: string,
  layers: readonly LayerLike[],
  options: { adminLevelFallback?: AdminLevel; dongNames?: readonly string[] } = {},
): StatsQueryMatch | null {
  const text = neutralizeNegatedDirection(query.replace(/\s+/g, " ").trim());
  if (!text) return null;

  const wantsCorrelation = CORRELATION_CUES.some((cue) => text.includes(cue));
  const wantsOutlier = OUTLIER_CUES.some((cue) => text.includes(cue));
  if (!wantsCorrelation && !wantsOutlier) return null;

  const kept = pruneOverlaps(allMatches(text, layers));
  const distinct = new Map<string, (typeof kept)[number]>();
  for (const match of kept) if (!distinct.has(match.metricKeyId)) distinct.set(match.metricKeyId, match);
  const ordered = [...distinct.values()].sort((a, b) => a.start - b.start);
  if (ordered.length === 0) return null;

  const regionFilters = detectRegionFilters(text, options.dongNames ?? []);
  const adminLevel = detectAdminLevel(text) ?? options.adminLevelFallback ?? "dong";

  /*
   * 상관을 물었는데 지표가 하나뿐이면 답할 수 없다. 그때 이상치로 슬쩍 바꿔 답하면
   * 묻지 않은 것을 답하는 셈이라, 이상치 말이 함께 있을 때만 그쪽으로 간다.
   */
  if (wantsCorrelation && ordered.length >= 2) {
    const [a, b] = ordered;
    return {
      kind: "correlation",
      a: a.ref,
      b: b.ref,
      adminLevel,
      unit: unitOf([a, b]),
      regionFilters,
    };
  }

  if (wantsOutlier) {
    const [only] = ordered;
    return {
      kind: "outlier",
      ref: only.ref,
      adminLevel,
      unit: unitOf([only]),
      regionFilters,
    };
  }

  return null;
}
