import { detectAdminLevel } from "@/lib/layers/resolve-layer-query";
import type { AdminLevel, LayerDescriptor } from "@/lib/layers/types";

type LayerLike = Omit<LayerDescriptor, "months"> | LayerDescriptor;

export type TrendQueryMatch = {
  layerId: string;
  layerLabel: string;
  provider: LayerDescriptor["provider"];
  metricKey: string;
  metricLabel: string;
  unit: string;
  /** rising = 증가폭이 큰 순, falling = 감소폭이 큰 순. */
  direction: "rising" | "falling";
  adminLevel: AdminLevel;
  /** 질의에 적힌 기간(개월). 없으면 null이고 화면의 기간 설정을 그대로 쓴다. */
  months: number | null;
};

/**
 * "최근 3개월"처럼 적힌 기간을 읽는다.
 *
 * 안 읽으면 화면의 기간 설정(기본 전체)이 그대로 쓰여, "최근 3개월 카드매출 늘어나는 동"에
 * 12개월 변화율을 답하게 된다(prod 실측). 물어본 기간과 답한 기간이 다르면 그 자체로
 * 틀린 답이다.
 */
const MONTHS_PATTERN = /(?:최근\s*)?(\d{1,2})\s*개?월/;

export function detectTrendMonths(query: string): number | null {
  const match = query.match(MONTHS_PATTERN);
  if (!match) return null;
  const months = Number(match[1]);
  return Number.isFinite(months) && months >= 2 && months <= 36 ? months : null;
}

// "늘어나는 / 증가하는" 계열과 "줄어드는 / 감소하는" 계열.
const RISING_CUES = ["증가", "늘어", "늘고", "늘어나", "상승", "오르", "성장", "커지", "많아지"];
const FALLING_CUES = ["감소", "줄어", "줄고", "줄어드", "하락", "떨어지", "축소", "작아지", "적어지"];

/** 값의 많고 적음이 아니라 변화를 묻는 표현인지. */
function detectDirection(text: string): "rising" | "falling" | null {
  // 감소를 먼저 본다 — "증가율이 감소"처럼 둘 다 있으면 뒤쪽 서술이 방향이다.
  const fallingAt = Math.max(...FALLING_CUES.map((cue) => text.lastIndexOf(cue)));
  const risingAt = Math.max(...RISING_CUES.map((cue) => text.lastIndexOf(cue)));
  if (fallingAt < 0 && risingAt < 0) return null;
  return fallingAt > risingAt ? "falling" : "rising";
}

function bestTriggerMatch(text: string, triggers: readonly string[]): string | null {
  let best: string | null = null;
  for (const trigger of triggers) {
    if (!text.includes(trigger)) continue;
    if (best === null || trigger.length > best.length) best = trigger;
  }
  return best;
}

/**
 * 추세 질의를 푼다 — "카드매출 늘어나는 동", "생활인구 줄어드는 곳".
 *
 * 기존 단일 시점 라우팅은 "카드매출 많은 동"처럼 값의 크기만 답할 수 있었다. 여기서는
 * 방향을 묻는 표현을 잡아 그 지표의 추세 순으로 정렬하게 한다.
 *
 * 주의: 공공 인구 레이어에는 이미 "인구 증가/감소" 전용 도구(rankPopulationGrowthPressure /
 * rankPopulationDeclineRisk)가 있으므로 호출부는 민간 레이어만 넘긴다. 그래야 "인구 늘어나는
 * 지역"이 기존 공공 경로를 그대로 타고, 민간 지표만 이 경로로 온다.
 */
export function resolveTrendQuery(
  query: string,
  layers: readonly LayerLike[],
  options: { adminLevelFallback?: AdminLevel } = {},
): TrendQueryMatch | null {
  const text = query.replace(/\s+/g, " ").trim();
  if (!text) return null;

  const direction = detectDirection(text);
  if (direction === null) return null;

  let best: (TrendQueryMatch & { triggerLength: number }) | null = null;
  for (const layer of layers) {
    for (const metric of layer.metrics) {
      const trigger = bestTriggerMatch(text, metric.triggers);
      if (trigger === null) continue;
      if (best === null || trigger.length > best.triggerLength) {
        best = {
          layerId: layer.id,
          layerLabel: layer.label,
          provider: layer.provider,
          metricKey: metric.key,
          metricLabel: metric.label,
          unit: metric.unit,
          direction,
          // 시군구까지만 있는 지표는 추세도 시군구로 본다(resolve-layer-query와 같은 이유).
          adminLevel:
            metric.scope === "sgg"
              ? "sgg"
              : detectAdminLevel(text, options.adminLevelFallback ?? "dong"),
          months: detectTrendMonths(text),
          triggerLength: trigger.length,
        };
      }
    }
  }

  if (best === null) return null;
  const { triggerLength: _triggerLength, ...match } = best;
  return match;
}
