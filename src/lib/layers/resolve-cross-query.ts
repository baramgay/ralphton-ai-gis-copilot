import type { CrossMode } from "@/lib/layers/cross-analysis";
import { detectAdminLevel } from "@/lib/layers/resolve-layer-query";
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
};

// "A 대비 B" → gap(zA−zB, A 높고 B 낮은 순). "A·B 모두" → both(zA+zB).
const GAP_CUES = ["대비해", "대비", "대해서", "비해", " 대 "];
const BOTH_CUES = ["모두 높", "둘 다", "동시에", "이면서", "면서 높", "겹치는"];

type Match = {
  ref: CrossOperandRef;
  metricKeyId: string; // `${layerId}/${metricKey}` for distinctness
  start: number;
  end: number;
};

function allMatches(text: string, layers: readonly LayerLike[]): Match[] {
  const matches: Match[] = [];
  for (const layer of layers) {
    for (const metric of layer.metrics) {
      let best: { trigger: string; start: number } | null = null;
      for (const trigger of metric.triggers) {
        const at = text.indexOf(trigger);
        if (at < 0) continue;
        if (best === null || trigger.length > best.trigger.length) best = { trigger, start: at };
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
          start: best.start,
          end: best.start + best.trigger.length,
        });
      }
    }
  }
  return matches;
}

/** Keep longest, non-overlapping matches so "생활인구" wins over the "인구" inside it. */
function pruneOverlaps(matches: Match[]): Match[] {
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
  const text = query.replace(/\s+/g, " ").trim();
  if (!text) return null;

  const gap = GAP_CUES.some((cue) => text.includes(cue));
  const both = BOTH_CUES.some((cue) => text.includes(cue));
  if (!gap && !both) return null;

  const kept = pruneOverlaps(allMatches(text, layers));
  // distinct metrics only
  const distinct = new Map<string, Match>();
  for (const match of kept) if (!distinct.has(match.metricKeyId)) distinct.set(match.metricKeyId, match);
  const ordered = [...distinct.values()].sort((a, b) => a.start - b.start);
  if (ordered.length < 2) return null;

  const [first, second] = ordered;
  // Gap wins when both cues present (explicit "대비" is the stronger signal).
  const mode: CrossMode = gap ? "gap" : "both";

  return {
    a: first.ref,
    b: second.ref,
    mode,
    adminLevel: detectAdminLevel(text, options.adminLevelFallback ?? "dong"),
  };
}
