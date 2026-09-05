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
  /**
   * 상위 10곳 중 기저(첫 관측값)가 전체 하위 25%인 지역 수.
   *
   * 변화율은 분모가 작을수록 크게 튄다. 실제로 카드매출 추세 상위 10곳이 **전부** 기저
   * 하위 25%였고 1위는 중앙값의 3.8%짜리 면 지역이었다(+755.9%). 그것만 보고 "여기 상권이
   * 가장 빨리 큰다"고 읽으면 정책 판단을 그르친다. 쏠려 있다는 사실을 화면이 밝혀야 한다.
   */
  smallBaseInTop: number;
  /**
   * 위 판단에 쓴 하위 25% 경계값(기저 단위). 경계값 **미만**만 센다 —
   * 기저가 고른 자료에서는 경계값에 값이 몰려, 이하로 세면 전부 소규모로 잡힌다.
   */
  smallBaseThreshold: number | null;
  /** 지도 채색용 0~100 정규화 점수(변화율 기준). */
  scores: Map<string, number>;
  /** 추세를 낼 수 있었던 지역 수(관측 2개월 이상). */
  comparable: number;
  /**
   * 변화율을 못 내 순위에서 **빠진** 지역 수.
   *
   * 첫 관측이 0이면 변화율은 나눗셈이 안 돼 산출 불가다(0 → 50은 몇 %인가). 그 지역들을
   * 빼는 것 자체는 옳지만, 개수를 말하지 않으면 화면은 「경남 전부를 본 순위」처럼 보인다.
   * 실측(2026-09-04): `nh-storetype.pub_share`는 305개 읍면동 중 165곳이 첫 달 0이라
   * 절반 이상이 조용히 빠진 채 순위가 인쇄되고 있었다.
   */
  excluded: number;
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
  let excluded = 0;
  for (const cell of source.cells) {
    const trend = computeTrend(sliceRecentMonths(cell.series[metric.key] ?? [], source.months, trendMonths));
    // 산출 불가를 0%로 두면 「0 → 50으로 는 곳」이 보합 한가운데에 놓인다. 빼되, 센다.
    if (trend.changeRate === null) {
      excluded += 1;
      continue;
    }
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

  // 기저 쏠림 진단: 기준은 데이터가 정한다(첫 관측값의 하위 25%).
  const bases = rows
    .map((row) => row.trend.first)
    .filter((value): value is number => value != null)
    .sort((left, right) => left - right);
  const smallBaseThreshold = bases.length >= 8 ? bases[Math.floor(bases.length * 0.25)] : null;
  const smallBaseInTop =
    smallBaseThreshold == null
      ? 0
      : rows
          .slice(0, 10)
          .filter((row) => row.trend.first != null && row.trend.first < smallBaseThreshold).length;

  return { ranked: rows, scores, comparable: rows.length, excluded, smallBaseInTop, smallBaseThreshold };
}
