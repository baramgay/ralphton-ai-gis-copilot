import { describe, expect, test } from "vitest";

import {
  buildScale,
  CHOROPLETH_COLORS,
  colorForValue,
  NO_DATA_COLOR,
  quantileBreaks,
} from "@/lib/gis/choropleth-scale";

describe("quantileBreaks", () => {
  test("색 개수보다 하나 적은 경계를 만든다", () => {
    const breaks = quantileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(breaks).toHaveLength(CHOROPLETH_COLORS.length - 1);
  });

  test("고른 분포에서는 경계도 고르게 놓인다", () => {
    const breaks = quantileBreaks([0, 25, 50, 75, 100]);
    expect(breaks[0]).toBeCloseTo(20, 5);
    expect(breaks[breaks.length - 1]).toBeCloseTo(80, 5);
  });

  test("비어 있으면 경계를 지어내지 않는다", () => {
    expect(quantileBreaks([])).toEqual([]);
  });
});

describe("colorForValue", () => {
  const breaks = quantileBreaks([0, 25, 50, 75, 100]);

  test("값이 없으면 '없음' 색을 쓴다 — 낮음과 구분되어야 한다", () => {
    expect(colorForValue(null, breaks)).toBe(NO_DATA_COLOR);
    expect(colorForValue(undefined, breaks)).toBe(NO_DATA_COLOR);
    expect(colorForValue(Number.NaN, breaks)).toBe(NO_DATA_COLOR);
    expect(NO_DATA_COLOR).not.toBe(CHOROPLETH_COLORS[0]);
  });

  test("최솟값은 가장 옅은 색, 최댓값은 가장 진한 색", () => {
    expect(colorForValue(0, breaks)).toBe(CHOROPLETH_COLORS[0]);
    expect(colorForValue(100, breaks)).toBe(CHOROPLETH_COLORS[CHOROPLETH_COLORS.length - 1]);
  });

  test("편중 분포에서도 지역이 여러 색으로 갈린다", () => {
    // 상위 한 곳이 압도적인 실제 분포(카드매출 등). 균등 구간이면 거의 전부 최하위 색이 된다.
    const skewed = [1, 2, 3, 4, 5, 6, 7, 8, 9, 500];
    const skewedBreaks = quantileBreaks(skewed);
    const used = new Set(skewed.map((value) => colorForValue(value, skewedBreaks)));
    expect(used.size).toBeGreaterThanOrEqual(4);
  });

  test("경계가 없으면 균등 구간으로 물러난다", () => {
    expect(colorForValue(0, [])).toBe(CHOROPLETH_COLORS[0]);
    expect(colorForValue(100, [])).toBe(CHOROPLETH_COLORS[CHOROPLETH_COLORS.length - 1]);
    expect(colorForValue(50, [])).toBe(CHOROPLETH_COLORS[2]);
  });

  test("같은 값이 많아 경계가 겹쳐도 색 범위를 벗어나지 않는다", () => {
    const flat = Array(20).fill(7);
    const flatBreaks = quantileBreaks(flat);
    const color = colorForValue(7, flatBreaks);
    expect(CHOROPLETH_COLORS).toContain(color);
  });
});

describe("buildScale", () => {
  test("점수 맵으로 경계를 한 번만 계산해 색을 돌려준다", () => {
    const scores = new Map([
      ["a", 0],
      ["b", 50],
      ["c", 100],
    ]);
    const scale = buildScale(scores);
    expect(scale.breaks).toHaveLength(CHOROPLETH_COLORS.length - 1);
    expect(scale.colorOf("a")).toBe(CHOROPLETH_COLORS[0]);
    expect(scale.colorOf("c")).toBe(CHOROPLETH_COLORS[CHOROPLETH_COLORS.length - 1]);
    // 지도에 없는 지역은 '없음' 색
    expect(scale.colorOf("없는코드")).toBe(NO_DATA_COLOR);
  });
});
