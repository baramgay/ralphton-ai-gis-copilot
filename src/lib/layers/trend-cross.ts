import { buildTrendRanking } from "@/lib/layers/trend-view";
import type { AdminLevel, LayerCube, MetricDef } from "@/lib/layers/types";

export type TrendCrossRow = {
  code: string;
  name: string;
  /** 두 지표의 변화율(%). */
  rateA: number;
  rateB: number;
  zA: number;
  zB: number;
  /** 물어본 두 방향을 모두 만족할수록 큰 값. */
  composite: number;
};

export type TrendCrossResult = {
  ranked: TrendCrossRow[];
  scores: Map<string, number>;
  /** 두 지표 모두 추세를 낼 수 있었던 지역 수. */
  comparable: number;
  /** 물어본 두 방향을 실제로 모두 만족하는 지역 수. */
  matching: number;
};

export type TrendCrossOperandInput = {
  cube: LayerCube;
  metric: MetricDef;
  metrics: MetricDef[];
  direction: "rising" | "falling";
};

function standardize(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 1 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(variance) || 1 };
}

/**
 * 두 지표의 **변화율**을 z-표준화해 겹쳐 본다.
 *
 * 값의 크기를 겹쳐 보는 교차분석(crossLayerView)과 달리, 여기서는 "얼마나 늘었나/줄었나"를
 * 겹친다. "생활인구는 느는데 소비는 주는 곳"처럼 두 흐름이 엇갈리는 자리를 찾는 질의가
 * 이 경로다.
 *
 * 각 지표는 물어본 방향으로 부호를 맞춘다(감소를 물었으면 많이 줄수록 큰 값). 그래야
 * 합이 클수록 두 요구를 모두 만족하는 곳이 된다.
 */
export function trendCrossView(
  a: TrendCrossOperandInput,
  b: TrendCrossOperandInput,
  adminLevel: AdminLevel,
  trendMonths?: number,
  regionFilter: string | null = null,
): TrendCrossResult {
  const rankA = buildTrendRanking(a.cube, a.metric, a.metrics, a.direction, adminLevel, trendMonths);
  const rankB = buildTrendRanking(b.cube, b.metric, b.metrics, b.direction, adminLevel, trendMonths);

  const byCodeB = new Map(rankB.ranked.map((row) => [row.code, row]));
  const compactFilter = regionFilter?.replace(/\s+/g, "") ?? null;
  const pairs = rankA.ranked
    .filter((row) => byCodeB.has(row.code))
    .filter(
      (row) => compactFilter === null || row.name.replace(/\s+/g, "").includes(compactFilter),
    )
    .map((row) => ({ row, other: byCodeB.get(row.code)! }));

  // 물어본 방향으로 부호를 맞춘다. 감소를 물었으면 많이 줄수록(음수가 클수록) 큰 값이다.
  const signOf = (direction: "rising" | "falling") => (direction === "rising" ? 1 : -1);
  const valuesA = pairs.map(({ row }) => (row.trend.changeRate ?? 0) * signOf(a.direction));
  const valuesB = pairs.map(({ other }) => (other.trend.changeRate ?? 0) * signOf(b.direction));
  const statA = standardize(valuesA);
  const statB = standardize(valuesB);

  const ranked: TrendCrossRow[] = pairs
    .map(({ row, other }, index) => {
      const zA = (valuesA[index] - statA.mean) / statA.std;
      const zB = (valuesB[index] - statB.mean) / statB.std;
      return {
        code: row.code,
        name: row.name,
        rateA: row.trend.changeRate ?? 0,
        rateB: other.trend.changeRate ?? 0,
        zA,
        zB,
        composite: zA + zB,
      };
    })
    .sort((left, right) => right.composite - left.composite);

  const composites = ranked.map((row) => row.composite);
  const min = composites.length ? Math.min(...composites) : 0;
  const max = composites.length ? Math.max(...composites) : 1;
  const span = Math.max(1e-9, max - min);
  const scores = new Map<string, number>();
  for (const row of ranked) {
    scores.set(row.code, composites.length <= 1 ? 50 : ((row.composite - min) / span) * 100);
  }

  // 두 요구를 실제로 모두 만족하는 곳이 몇 곳인지 세어 둔다. 0이면 그렇게 밝혀야 한다.
  const matching = ranked.filter(
    (row) => row.rateA * signOf(a.direction) > 0 && row.rateB * signOf(b.direction) > 0,
  ).length;

  return { ranked, scores, comparable: ranked.length, matching };
}
