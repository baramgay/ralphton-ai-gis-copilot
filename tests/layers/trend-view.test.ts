import { describe, expect, test } from "vitest";

import { buildTrendRanking } from "@/lib/layers/trend-view";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

const metric: MetricDef = {
  key: "v",
  label: "값",
  unit: "명",
  aggregation: "sum",
  formula: "f",
  limitation: "",
  triggers: ["값"],
};

function cube(values: Record<string, Array<number | null>>): LayerCube {
  return {
    layerId: "test",
    adminLevel: "dong",
    referenceMonth: "2025-03",
    months: ["2025-01", "2025-02", "2025-03"],
    cells: Object.entries(values).map(([code, series], i) => ({
      code,
      name: `동${i + 1}`,
      point: { lat: 35, lng: 128 },
      areaKm2: 1,
      series: { v: series },
    })),
  };
}

describe("buildTrendRanking", () => {
  const sample = cube({
    "4811100000": [100, 110, 130], // +30%
    "4811200000": [100, 100, 100], // 0%
    "4811300000": [100, 90, 70], // -30%
  });

  test("증가 질의는 많이 는 순으로 세운다", () => {
    const result = buildTrendRanking(sample, metric, [metric], "rising", "dong");
    expect(result.ranked.map((row) => row.code)).toEqual([
      "4811100000",
      "4811200000",
      "4811300000",
    ]);
    expect(result.ranked[0].trend.changeRate).toBeCloseTo(30, 6);
  });

  test("감소 질의는 많이 준 순으로 뒤집는다", () => {
    const result = buildTrendRanking(sample, metric, [metric], "falling", "dong");
    expect(result.ranked[0].code).toBe("4811300000");
    expect(result.ranked[0].trend.changeRate).toBeCloseTo(-30, 6);
  });

  test("질의 방향으로 두드러진 지역이 지도에서 100에 가깝다", () => {
    const rising = buildTrendRanking(sample, metric, [metric], "rising", "dong");
    expect(rising.scores.get("4811100000")).toBeCloseTo(100, 5);
    expect(rising.scores.get("4811300000")).toBeCloseTo(0, 5);

    const falling = buildTrendRanking(sample, metric, [metric], "falling", "dong");
    expect(falling.scores.get("4811300000")).toBeCloseTo(100, 5);
  });

  test("추세를 낼 수 없는 지역은 순위에서 빼고 그 수를 남긴다", () => {
    const sparse = cube({
      "4811100000": [100, 110, 130],
      "4811200000": [null, null, 50], // 관측 1개월 → 추세 불가
      "4811300000": [0, 5, 10], // 첫 값 0 → 변화율 불가
    });
    const result = buildTrendRanking(sparse, metric, [metric], "rising", "dong");
    expect(result.ranked.map((row) => row.code)).toEqual(["4811100000"]);
    expect(result.comparable).toBe(1);
  });

  test("시군구 단위는 집계 후 추세를 낸다", () => {
    const twoDongs = cube({
      "4811100000": [100, 100, 100],
      "4811200000": [100, 150, 200],
    });
    const result = buildTrendRanking(twoDongs, metric, [metric], "rising", "sgg");
    // 같은 시군구(48111/48112는 앞 5자리가 다르므로 각각) — 코드가 5자리로 줄어든다
    expect(result.ranked.every((row) => row.code.length === 5)).toBe(true);
  });

  test("빈 큐브에서도 순위를 지어내지 않는다", () => {
    const result = buildTrendRanking(cube({}), metric, [metric], "rising", "dong");
    expect(result.ranked).toHaveLength(0);
    expect(result.comparable).toBe(0);
  });
});
