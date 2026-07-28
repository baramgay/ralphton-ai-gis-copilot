import { neutralizeNegatedDirection } from "@/lib/analysis/query-catalog-meta";
import type { CrossMode } from "@/lib/layers/cross-analysis";
import { detectAdminLevel, detectRegionFilters } from "@/lib/layers/resolve-layer-query";
import type { AdminLevel, LayerDescriptor } from "@/lib/layers/types";

type LayerLike = Omit<LayerDescriptor, "months"> | LayerDescriptor;

export type CrossOperandRef = {
  layerId: string;
  layerLabel: string;
  provider: LayerDescriptor["provider"];
  metricKey: string;
  metricLabel: string;
};

export type CrossQueryMatch = {
  a: CrossOperandRef;
  b: CrossOperandRef;
  mode: CrossMode;
  adminLevel: AdminLevel;
  /** 질의에 적힌 지역들. 단일 지표 경로와 같은 규칙으로 좁힌다. */
  regionFilters: string[];
};

// "A 대비 B" → gap(zA−zB, A 높고 B 낮은 순). "A·B 모두" → both(zA+zB).
// "A보다 B가 많은"도 두 지표를 견주는 말이다. 없으면 "전입보다 전출이 많은 곳"이
// 전입 순위로 답한다(prod 실측) — 정반대 개념이다.
const GAP_CUES = ["대비해", "대비", "대해서", "비해", "보다", " 대 "];
// "많으면서 …도 높은"처럼 어미가 붙으면 기존 목록에 안 걸려 단일 지표로 떨어졌다.
const BOTH_CUES = ["모두 높", "모두 많", "둘 다", "동시에", "이면서", "면서", "으면서", "도 높", "도 많", "겹치는"];
// Contrastive polarity: one metric high, the other low → gap even without a "대비" cue.
// "과한"은 그 지표가 많다는 뜻이다. 없으면 "소득 대비 소비가 과한 지역"이
// 소비가 부족한 순으로 나온다(prod 실측).
export const HIGH_CUES = ["많", "높", "큰", "크게", "상위", "취약", "부족", "과한", "과다", "넘치", "활발"];
export const LOW_CUES = ["낮", "적", "작", "하위"];
// Conjunction that lets two same-direction metrics read as "both high".
const CONJUNCTION = /고\s|와\s|과\s|랑\s|이랑|그리고|같이|함께/;

export type Match = {
  ref: CrossOperandRef;
  metricKeyId: string; // `${layerId}/${metricKey}` for distinctness
  /** 시군구까지만 있는 지표인가. 한쪽이라도 그렇다면 교차도 시군구로 봐야 한다. */
  sggOnly: boolean;
  start: number;
  end: number;
};

/*
 * 트리거를 찾되, 두 낱말짜리는 사이에 조사가 끼어도 찾는다.
 *
 * "의료도 부족하고 소비도 적은 곳"에서 의료 조건이 통째로 빠졌다(prod 실측). 지표가
 * 하나만 잡히면 교차가 성립하지 않아 단일 지표로 폴백하고, 사용자는 자기가 낸 조건
 * 하나가 사라진 줄 모른다. 위치를 그대로 쓰므로(겹침 제거에 필요) text는 압축하지 않는다.
 */
const CROSS_PARTICLE_GAP = "[은는이가도을를의에서와과만로\\s]{0,3}";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTrigger(text: string, trigger: string): { start: number; end: number } | null {
  const at = text.indexOf(trigger);
  if (at >= 0) return { start: at, end: at + trigger.length };
  const parts = trigger.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const found = new RegExp(parts.map(escapeRegExp).join(CROSS_PARTICLE_GAP)).exec(text);
  return found ? { start: found.index, end: found.index + found[0].length } : null;
}

export function allMatches(text: string, layers: readonly LayerLike[]): Match[] {
  const matches: Match[] = [];
  for (const layer of layers) {
    for (const metric of layer.metrics) {
      let best: { trigger: string; start: number; end: number } | null = null;
      for (const trigger of metric.triggers) {
        const found = findTrigger(text, trigger);
        if (found === null) continue;
        if (best === null || trigger.length > best.trigger.length) {
          best = { trigger, start: found.start, end: found.end };
        }
      }
      if (best) {
        matches.push({
          ref: {
            layerId: layer.id,
            layerLabel: layer.label,
            provider: layer.provider,
            metricKey: metric.key,
            metricLabel: metric.label,
          },
          metricKeyId: `${layer.id}/${metric.key}`,
          sggOnly: metric.scope === "sgg",
          start: best.start,
          end: best.end,
        });
      }
    }
  }
  return matches;
}

/** Keep longest, non-overlapping matches so "생활인구" wins over the "인구" inside it. */
export function pruneOverlaps(matches: Match[]): Match[] {
  const byLength = [...matches].sort((a, b) => b.end - b.start - (a.end - a.start));
  const kept: Match[] = [];
  for (const candidate of byLength) {
    const overlaps = kept.some((k) => candidate.start < k.end && k.start < candidate.end);
    if (!overlaps) kept.push(candidate);
  }
  return kept;
}

/**
 * Resolve a cross-layer analysis query ("생활인구 대비 카드매출", "소득과 소비 모두 높은 동").
 * Returns null unless the query has a cross connective AND resolves to two DISTINCT
 * cube metrics. Operand order (A, B) follows appearance order in the query.
 */
export function resolveCrossQuery(
  query: string,
  layers: readonly LayerLike[],
  options: { adminLevelFallback?: AdminLevel } = {},
): CrossQueryMatch | null {
  const text = neutralizeNegatedDirection(query.replace(/\s+/g, " ").trim());
  if (!text) return null;

  // Require two DISTINCT cube metrics before inferring cross intent — this guard is
  // what lets polarity-only phrasings ("생활인구 많고 소득 낮은") fire without a "대비"
  // cue while single-metric queries stay on the normal single-layer path.
  const kept = pruneOverlaps(allMatches(text, layers));
  const distinct = new Map<string, Match>();
  for (const match of kept) if (!distinct.has(match.metricKeyId)) distinct.set(match.metricKeyId, match);
  const ordered = [...distinct.values()].sort((a, b) => a.start - b.start);
  if (ordered.length < 2) return null;

  const hasHigh = HIGH_CUES.some((cue) => text.includes(cue));
  const hasLow = LOW_CUES.some((cue) => text.includes(cue));
  const gapCue = GAP_CUES.some((cue) => text.includes(cue));
  const bothCue = BOTH_CUES.some((cue) => text.includes(cue));

  // gap: explicit "대비", or one-high-one-low contrast. both: explicit "모두", or two
  // same-direction (high) metrics joined by a conjunction.
  const isGap = gapCue || (hasHigh && hasLow);
  const isBoth = bothCue || (hasHigh && !hasLow && CONJUNCTION.test(text));
  if (!isGap && !isBoth) return null;

  // Explicit "대비" / contrast wins over "both" when both signals appear.
  const mode: CrossMode = isGap ? "gap" : "both";

  /*
   * gap은 zA − zB라 "어느 쪽이 높은 쪽인가"가 결과를 뒤집는다. 등장 순서로 정하면
   * "소득 낮고 의료 취약한 지역"이 소득 높고 취약 낮은 순으로 나온다 — 정반대다.
   * 각 지표 바로 뒤에 붙은 말로 그 지표의 방향을 읽어, 높은 쪽을 A로 세운다.
   */
  const polarityOf = (match: Match, nextStart: number): "high" | "low" | null => {
    const tail = text.slice(match.end, nextStart);
    const high = HIGH_CUES.map((cue) => tail.indexOf(cue)).filter((at) => at >= 0);
    const low = LOW_CUES.map((cue) => tail.indexOf(cue)).filter((at) => at >= 0);
    if (high.length === 0 && low.length === 0) return null;
    if (low.length === 0) return "high";
    if (high.length === 0) return "low";
    // 둘 다 있으면 더 가까이 붙은 쪽이 그 지표를 꾸민다.
    return Math.min(...high) < Math.min(...low) ? "high" : "low";
  };

  let [first, second] = ordered;
  if (mode === "gap") {
    const firstPolarity = polarityOf(first, second.start);
    const secondPolarity = polarityOf(second, text.length);
    /*
     * 높은 쪽이 A(더하는 쪽), 낮은 쪽이 B(빼는 쪽)다.
     * 한쪽에만 단서가 붙는 경우가 많다 — "소득 대비 소비가 과한 지역"은 소비에만 "과한"이
     * 붙고 소득 쪽은 "대비"뿐이라, 낮음만 보면 순서가 그대로 남아 정반대로 답한다.
     */
    if (firstPolarity === "low" && secondPolarity !== "low") {
      [first, second] = [second, first];
    } else if (secondPolarity === "high" && firstPolarity !== "high") {
      [first, second] = [second, first];
    }
  }

  return {
    a: first.ref,
    b: second.ref,
    mode,
    // 한쪽이 시군구까지만 있는 지표면 읍면동으로 겹쳐 볼 수 없다. 그 값은 소속 읍면동에
    // 똑같이 복제돼 있어, 읍면동 교차는 상대 지표만으로 순위가 정해진 것과 같아진다.
    adminLevel:
      first.sggOnly || second.sggOnly
        ? "sgg"
        : detectAdminLevel(text, options.adminLevelFallback ?? "dong"),
    // "창원에서 소득 낮고 의료 취약한 곳"이 경남 전체를 답하고 있었다.
    regionFilters: detectRegionFilters(text),
  };
}
