import { computeTrend, sliceRecentMonths, type TrendResult } from "@/lib/layers/trend";
import type { AdminLevel, LayerCube, MetricDef } from "@/lib/layers/types";
import { aggregateToSgg } from "@/lib/layers/aggregate";

export type TrendRow = {
  code: string;
  name: string;
  trend: TrendResult;
};

export type TrendRankResult = {
  ranked: TrendRow[];
  /** 지도 채색용 0~100 정규화 점수(변화율 기준). */
  scores: Map<string, number>;
  /** 추세를 낼 수 있었던 지역 수(관측 2개월 이상). */
  comparable: number;
};

/**
 * 지역별 추세를 계산해 변화율 순으로 정렬한다.
 *
 * 값의 크기 순위(기존 경로)와 달리 여기서는 "얼마나 늘었나/줄었나"로 줄을 세운다.
 * 관측이 모자라 추세를 낼 수 없는 지역은 순위에서 빼고, 그 사실을 comparable로 남긴다.
 */
export function buildTrendRanking(
  cube: LayerCube,
  metric: MetricDef,
  metrics: MetricDef[],
  direction: "rising" | "falling",
  adminLevel: AdminLevel,
  /** 추세를 볼 기간(개월). 없으면 전 기간. 프로파일 패널과 같은 기준을 쓴다. */
  trendMonths?: number,
): TrendRankResult {
  const source = adminLevel === "sgg" ? aggregateToSgg(cube, metrics) : cube;

  const rows: TrendRow[] = [];
  for (const cell of source.cells) {
    const trend = computeTrend(sliceRecentMonths(cell.series[metric.key] ?? [], source.months, trendMonths));
    if (trend.changeRate === null) continue;
    rows.push({ code: cell.code, name: cell.name, trend });
  }

  rows.sort((left, right) => {
    const a = left.trend.changeRate ?? 0;
    const b = right.trend.changeRate ?? 0;
    // 증가 질의는 많이 는 순, 감소 질의는 많이 준 순.
    return direction === "rising" ? b - a : a - b;
  });

  // 지도 점수: 질의 방향으로 두드러진 지역이 100에 가깝도록 정규화한다.
  const values = rows.map((row) => (row.trend.changeRate ?? 0) * (direction === "rising" ? 1 : -1));
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  const span = Math.max(1e-9, max - min);
  const scores = new Map<string, number>();
  rows.forEach((row, index) => {
    scores.set(row.code, values.length <= 1 ? 50 : ((values[index] - min) / span) * 100);
  });

  return { ranked: rows, scores, comparable: rows.length };
}
