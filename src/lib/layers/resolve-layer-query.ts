import type { AdminLevel, LayerDescriptor, MetricDef } from "@/lib/layers/types";

/** A layer descriptor with or without its resolved `months` (catalog entries omit months). */
type LayerLike = Omit<LayerDescriptor, "months"> | LayerDescriptor;

export type LayerQueryMatch = {
  layerId: string;
  layerLabel: string;
  provider: LayerDescriptor["provider"];
  metricKey: string;
  metricLabel: string;
  adminLevel: AdminLevel;
  matchedTrigger: string;
};

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

export function detectAdminLevel(query: string, fallback: AdminLevel = "dong"): AdminLevel {
  return SGG_CUES.some((cue) => query.includes(cue)) ? "sgg" : fallback;
}

function bestTriggerMatch(text: string, metric: MetricDef): string | null {
  let best: string | null = null;
  for (const trigger of metric.triggers) {
    if (!text.includes(trigger)) continue;
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
  options: { adminLevelFallback?: AdminLevel } = {},
): LayerQueryMatch | null {
  const text = query.replace(/\s+/g, " ").trim();
  if (!text) return null;

  let best: (LayerQueryMatch & { triggerLength: number }) | null = null;

  for (const layer of layers) {
    for (const metric of layer.metrics) {
      const trigger = bestTriggerMatch(text, metric);
      if (trigger === null) continue;
      if (best === null || trigger.length > best.triggerLength) {
        best = {
          layerId: layer.id,
          layerLabel: layer.label,
          provider: layer.provider,
          metricKey: metric.key,
          metricLabel: metric.label,
          adminLevel: detectAdminLevel(text, options.adminLevelFallback ?? "dong"),
          matchedTrigger: trigger,
          triggerLength: trigger.length,
        };
      }
    }
  }

  if (best === null) return null;
  const { triggerLength: _triggerLength, ...match } = best;
  return match;
}
