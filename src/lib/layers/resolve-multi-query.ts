import { neutralizeNegatedDirection } from "@/lib/analysis/query-catalog-meta";
import {
  allMatches,
  pruneOverlaps,
  HIGH_CUES,
  LOW_CUES,
  type CrossOperandRef,
  type Match,
} from "@/lib/layers/resolve-cross-query";
import { detectAdminLevel, detectRegionFilters } from "@/lib/layers/resolve-layer-query";
import type { AdminLevel, LayerDescriptor } from "@/lib/layers/types";

type LayerLike = Omit<LayerDescriptor, "months"> | LayerDescriptor;

export type MultiOperandRef = CrossOperandRef & {
  /** 이 지표를 높은 쪽으로 물었는가 낮은 쪽으로 물었는가. */
  direction: "high" | "low";
};

export type MultiQueryMatch = {
  /** 질의에 나온 순서. 3개 이상이다. */
  operands: MultiOperandRef[];
  adminLevel: AdminLevel;
  regionFilters: string[];
};

/**
 * 지표 **셋 이상**을 한 번에 겹쳐 보는 질의를 해석한다.
 *
 * "생활인구 카드매출 평균소득"이나 "생활인구 많고 소득 높고 연체 낮은 곳"처럼 조건을
 * 여러 개 걸어 후보지를 좁히는 것은 정책 실무에서 흔한 물음인데, 교차 경로가 두 개까지만
 * 다뤄서 조용히 단일 지표로 떨어지고 있었다(prod 실측). 물어본 것보다 적게 답하면서
 * 그 사실을 말하지 않는 것이라 특히 나쁘다.
 *
 * 두 개짜리는 기존 교차(resolveCrossQuery)가 그대로 맡는다 — gap(대비)이라는 개념이
 * 두 개일 때만 성립하기 때문이다. 셋 이상은 "각 지표를 물어본 방향으로 맞춰 모두 만족하는
 * 곳"이 유일하게 자연스러운 해석이라 합산만 있으면 된다.
 */
export function resolveMultiQuery(
  query: string,
  layers: readonly LayerLike[],
  options: { adminLevelFallback?: AdminLevel } = {},
): MultiQueryMatch | null {
  const text = neutralizeNegatedDirection(query.replace(/\s+/g, " ").trim());
  if (!text) return null;

  const kept = pruneOverlaps(allMatches(text, layers));
  const distinct = new Map<string, Match>();
  for (const match of kept) {
    if (!distinct.has(match.metricKeyId)) distinct.set(match.metricKeyId, match);
  }
  const ordered = [...distinct.values()].sort((a, b) => a.start - b.start);
  // 둘 이하는 기존 경로(단일·교차)의 몫이다.
  if (ordered.length < 3) return null;

  /*
   * 지표마다 방향을 따로 읽는다. 그 지표 뒤에서 다음 지표가 시작하기 전까지의 말이
   * 그 지표를 꾸민다 — "생활인구 많고 소득 높고 연체 낮은 곳"에서 "낮은"은 연체에만 붙는다.
   * 단서가 없으면 높은 쪽으로 본다("생활인구 카드매출 평균소득"처럼 나열만 한 경우).
   */
  const directionOf = (match: Match, nextStart: number): "high" | "low" => {
    const tail = text.slice(match.end, nextStart);
    const high = HIGH_CUES.map((cue) => tail.indexOf(cue)).filter((at) => at >= 0);
    const low = LOW_CUES.map((cue) => tail.indexOf(cue)).filter((at) => at >= 0);
    if (low.length === 0) return "high";
    if (high.length === 0) return "low";
    // 둘 다 있으면 더 가까이 붙은 쪽이 그 지표를 꾸민다.
    return Math.min(...high) < Math.min(...low) ? "high" : "low";
  };

  const operands: MultiOperandRef[] = ordered.map((match, index) => ({
    ...match.ref,
    direction: directionOf(match, ordered[index + 1]?.start ?? text.length),
  }));

  return {
    operands,
    /*
     * 하나라도 시군구까지만 있는 지표가 끼면 읍면동으로 겹쳐 볼 수 없다. 그 값은 소속
     * 읍면동에 똑같이 복제돼 있어, 읍면동 순위는 나머지 지표만으로 정해진 것과 같아진다.
     */
    adminLevel: ordered.some((match) => match.sggOnly)
      ? "sgg"
      : detectAdminLevel(text, options.adminLevelFallback ?? "dong"),
    regionFilters: detectRegionFilters(text),
  };
}
