/**
 * 코로플레스 채색 스케일.
 *
 * 두 지도(데모·카카오)가 색 배열을 따로 들고 있어 어긋날 수 있었고, 구간을 0~100 균등으로
 * 잘라 쓰고 있었다. 균등 구간은 값이 고르게 퍼진 분포에서만 잘 보인다. 카드매출처럼 상위
 * 몇 곳이 압도적인 분포에서는 대부분의 지역이 최하위 색 하나로 뭉쳐 차이가 사라진다.
 *
 * 그래서 분위수로 자른다 — 각 색 구간에 비슷한 수의 지역이 들어가 순위 차이가 드러난다.
 * 다만 분위수는 "얼마나 큰가"가 아니라 "몇 등인가"를 보여주므로, 범례에 그 사실을 밝혀야
 * 절대값 비교로 오해하지 않는다.
 */
export const CHOROPLETH_COLORS = ["#eff6ff", "#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8"] as const;
/** 값이 없는 지역. 0에 가까운 색과 구분되어야 "없음"과 "낮음"이 헷갈리지 않는다. */
export const NO_DATA_COLOR = "#e8eef5";

/**
 * 분위수 경계. 값이 오름차순으로 몇 번째 구간에 드는지 판정하는 데 쓴다.
 * 경계는 색 개수보다 하나 적다(5색 → 4경계).
 */
export function quantileBreaks(values: readonly number[], classes = CHOROPLETH_COLORS.length): number[] {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return [];

  const breaks: number[] = [];
  for (let i = 1; i < classes; i += 1) {
    const position = (sorted.length - 1) * (i / classes);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const weight = position - lower;
    breaks.push(sorted[lower] * (1 - weight) + sorted[upper] * weight);
  }
  return breaks;
}

/**
 * 값 → 색. breaks가 비어 있으면(비교 대상이 없으면) 균등 구간으로 물러난다.
 * 같은 값이 많아 경계가 겹치는 경우에도 색 인덱스가 범위를 벗어나지 않는다.
 */
export function colorForValue(
  value: number | undefined | null,
  breaks: readonly number[],
): string {
  if (value == null || !Number.isFinite(value)) return NO_DATA_COLOR;

  if (breaks.length === 0) {
    const index = Math.min(
      CHOROPLETH_COLORS.length - 1,
      Math.max(0, Math.floor(value / (100 / CHOROPLETH_COLORS.length))),
    );
    return CHOROPLETH_COLORS[index];
  }

  let index = 0;
  while (index < breaks.length && value > breaks[index]) index += 1;
  return CHOROPLETH_COLORS[Math.min(index, CHOROPLETH_COLORS.length - 1)];
}

/** 지도에 그릴 값 전체로 경계를 한 번만 계산해 쓰기 위한 헬퍼. */
export function buildScale(scores: ReadonlyMap<string, number>) {
  const breaks = quantileBreaks([...scores.values()]);
  return {
    breaks,
    colorOf: (code: string) => colorForValue(scores.get(code), breaks),
  };
}
