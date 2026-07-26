import type { AdminLevel, LayerDescriptor, MetricDef } from "@/lib/layers/types";

/** A layer descriptor with or without its resolved `months` (catalog entries omit months). */
type LayerLike = Omit<LayerDescriptor, "months"> | LayerDescriptor;

export type LayerQueryMatch = {
  layerId: string;
  /** 낮은 쪽을 물었으면 "asc". 기본은 큰 값부터. */
  direction: "desc" | "asc";
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
const LOW_CUES = ["적은", "낮은", "작은", "하위", "부족한", "적게", "낮게"];
const HIGH_CUES = ["많은", "높은", "큰", "상위", "많이", "높게"];

export function detectDirection(query: string): "desc" | "asc" {
  const low = LOW_CUES.map((cue) => query.indexOf(cue)).filter((at) => at >= 0);
  const high = HIGH_CUES.map((cue) => query.indexOf(cue)).filter((at) => at >= 0);
  if (low.length === 0) return "desc";
  if (high.length === 0) return "asc";
  // 둘 다 있으면 뒤에 오는 쪽이 정렬 방향을 정한다("소득 낮고 소비 많은" → 많은 순).
  return Math.max(...low) > Math.max(...high) ? "asc" : "desc";
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
