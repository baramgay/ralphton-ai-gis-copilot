import { describe, expect, test } from "vitest";

import { trendCrossView } from "@/lib/layers/trend-cross";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

const metric = (key: string): MetricDef => ({
  key, label: key, unit: "명", aggregation: "sum", formula: "f", limitation: "", triggers: [key],
});

function cube(layerId: string, key: string, values: Record<string, number[]>): LayerCube {
  return {
    layerId,
    adminLevel: "dong",
    referenceMonth: "2025-03",
    months: ["2025-01", "2025-02", "2025-03"],
    cells: Object.entries(values).map(([code, series], i) => ({
      code,
      name: `경상남도 시 동${i + 1}`,
      point: { lat: 35, lng: 128 },
      areaKm2: 1,
      series: { [key]: series },
    })),
  };
}

describe("trendCrossView", () => {
  // 동1: 인구 늘고 소비 줄어듦(찾는 모양) · 동2: 둘 다 늘어남 · 동3: 인구 줄고 소비 늘어남
  const pop = cube("skt", "v", {
    "4811100000": [100, 110, 130],
    "4811200000": [100, 110, 130],
    "4811300000": [100, 90, 70],
  });
  const spend = cube("nh", "w", {
    "4811100000": [100, 90, 70],
    "4811200000": [100, 110, 130],
    "4811300000": [100, 110, 130],
  });
  const a = { cube: pop, metric: metric("v"), metrics: [metric("v")], direction: "rising" as const };
  const b = { cube: spend, metric: metric("w"), metrics: [metric("w")], direction: "falling" as const };

  test("두 요구를 모두 만족하는 곳이 1위다", () => {
    const result = trendCrossView(a, b, "dong");
    expect(result.ranked[0].code).toBe("4811100000");
    expect(result.ranked[0].rateA).toBeCloseTo(30, 5);
    expect(result.ranked[0].rateB).toBeCloseTo(-30, 5);
  });

  test("실제로 두 방향을 다 만족하는 지역 수를 센다", () => {
    // 인구 늘고 소비 준 곳은 동1뿐이다.
    expect(trendCrossView(a, b, "dong").matching).toBe(1);
  });

  test("한쪽만 만족하면 뒤로 밀린다", () => {
    const result = trendCrossView(a, b, "dong");
    expect(result.ranked[result.ranked.length - 1].code).toBe("4811300000");
  });

  test("지도 점수는 1위가 100에 가깝다", () => {
    const result = trendCrossView(a, b, "dong");
    expect(result.scores.get("4811100000")).toBeCloseTo(100, 5);
  });

  test("지역을 좁히면 그 안만 남는다", () => {
    const result = trendCrossView(a, b, "dong", undefined, ["동2"]);
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0].code).toBe("4811200000");
  });

  test("추세를 낼 수 없으면 순위에 넣지 않는다", () => {
    const sparse = cube("nh", "w", { "4811100000": [0, 0, 0] });
    const result = trendCrossView(a, { ...b, cube: sparse }, "dong");
    expect(result.comparable).toBe(0);
  });
});
