import { neutralizeNegatedDirection } from "@/lib/analysis/query-catalog-meta";
import { detectAdminLevel, detectRegionFilters } from "@/lib/layers/resolve-layer-query";
import { detectTrendMonths } from "@/lib/layers/resolve-trend-query";
import type { AdminLevel, LayerDescriptor, MetricDef } from "@/lib/layers/types";

type LayerLike = Omit<LayerDescriptor, "months"> | LayerDescriptor;

export type TrendCrossOperand = {
  layerId: string;
  layerLabel: string;
  provider: LayerDescriptor["provider"];
  metricKey: string;
  metricLabel: string;
  unit: string;
  /** 이 지표에 대해 물은 방향. */
  direction: "rising" | "falling";
};

export type TrendCrossMatch = {
  a: TrendCrossOperand;
  b: TrendCrossOperand;
  adminLevel: AdminLevel;
  regionFilters: string[];
  months: number | null;
};

/**
 * 두 지표의 **변화**를 겹쳐 보는 질의를 해석한다.
 *
 * "생활인구는 느는데 소비는 주는 곳"은 값의 크기가 아니라 두 흐름이 엇갈리는 곳을 묻는다.
 * 이 경로가 없어 생활인구 단순 순위로 답하고 있었다(prod 실측) — 물어본 것과 다른 답이다.
 *
 * 단일 추세(resolveTrendQuery)와 다른 점은 **지표가 둘이고 방향이 각각 다르다**는 것이다.
 * 방향이 같으면("둘 다 느는 곳") 그것도 의미가 있으므로 함께 다룬다.
 */
const RISING_CUES = ["증가", "늘어", "늘고", "느는", "늘", "상승", "오르", "성장", "커지", "많아지"];
const FALLING_CUES = ["감소", "줄어", "줄고", "주는", "줄", "하락", "떨어지", "축소", "작아지", "적어지"];

type Hit = {
  operand: Omit<TrendCrossOperand, "direction">;
  start: number;
  end: number;
};

function allHits(text: string, layers: readonly LayerLike[]): Hit[] {
  const hits: Hit[] = [];
  const compact = text.replace(/\s+/g, "");
  for (const layer of layers) {
    for (const metric of layer.metrics) {
      let best: { trigger: string; at: number } | null = null;
      for (const trigger of metric.triggers) {
        const at = compact.indexOf(trigger.replace(/\s+/g, ""));
        if (at < 0) continue;
        if (best === null || trigger.length > best.trigger.length) best = { trigger, at };
      }
      if (!best) continue;
      hits.push({
        operand: {
          layerId: layer.id,
          layerLabel: layer.label,
          provider: layer.provider,
          metricKey: metric.key,
          metricLabel: metric.label,
          unit: metric.unit,
        },
        start: best.at,
        end: best.at + best.trigger.replace(/\s+/g, "").length,
      });
    }
  }
  // 겹치는 매칭은 긴 쪽만 남긴다("생활인구"가 "인구"를 이긴다).
  return hits
    .sort((left, right) => right.end - right.start - (left.end - left.start))
    .filter((hit, index, all) => !all.slice(0, index).some((kept) => hit.start < kept.end && kept.start < hit.end))
    .sort((left, right) => left.start - right.start);
}

/** 지표 바로 뒤에 붙은 말에서 그 지표의 방향을 읽는다. */
/*
 * "줄다"의 관형사형 축약. "작년보다 소비 늘고 인구 준 동"에서 인구 조건이 통째로 빠졌다
 * (prod 실측) — 방향을 못 읽으면 교차가 통째로 null이 되어 단일 지표로 폴백한다.
 *
 * 낱말 목록에 "준"을 그냥 넣으면 "수준"·"기준"에 걸려 정반대로 읽는다. 앞이 한글이 아닌
 * 자리의 "준"만 본다.
 */
const FALLING_SHORT = /(?:^|[^가-힣])준(?=[\s가-힣])/;

function directionAfter(text: string, from: number, to: number): "rising" | "falling" | null {
  const tail = text.slice(from, to);
  const rising = RISING_CUES.map((cue) => tail.indexOf(cue)).filter((at) => at >= 0);
  const falling = FALLING_CUES.map((cue) => tail.indexOf(cue)).filter((at) => at >= 0);
  const shortFall = FALLING_SHORT.exec(tail);
  if (shortFall) falling.push(shortFall.index);
  if (rising.length === 0 && falling.length === 0) return null;
  if (falling.length === 0) return "rising";
  if (rising.length === 0) return "falling";
  return Math.min(...rising) < Math.min(...falling) ? "rising" : "falling";
}

export function resolveTrendCrossQuery(
  query: string,
  layers: readonly LayerLike[],
  options: { adminLevelFallback?: AdminLevel; dongNames?: readonly string[] } = {},
): TrendCrossMatch | null {
  const text = neutralizeNegatedDirection(query.replace(/\s+/g, " ").trim());
  if (!text) return null;
  const compact = text.replace(/\s+/g, "");

  const hits = allHits(text, layers);
  const distinct = new Map<string, Hit>();
  for (const hit of hits) {
    const key = `${hit.operand.layerId}/${hit.operand.metricKey}`;
    if (!distinct.has(key)) distinct.set(key, hit);
  }
  const ordered = [...distinct.values()].sort((left, right) => left.start - right.start);
  if (ordered.length < 2) return null;

  const [first, second] = ordered;
  const firstDirection = directionAfter(compact, first.end, second.start);
  const secondDirection = directionAfter(compact, second.end, compact.length);
  // 두 지표 모두 방향이 붙어 있어야 추세 교차다. 하나뿐이면 일반 교차·단일 경로가 맞다.
  if (!firstDirection || !secondDirection) return null;

  return {
    a: { ...first.operand, direction: firstDirection },
    b: { ...second.operand, direction: secondDirection },
    adminLevel: detectAdminLevel(text, options.adminLevelFallback ?? "dong"),
    regionFilters: detectRegionFilters(text, options.dongNames ?? []),
    months: detectTrendMonths(text),
  };
}

export type { MetricDef };
