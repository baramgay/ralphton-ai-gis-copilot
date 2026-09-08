import { describe, expect, test } from "vitest";

import { buildTrendRanking } from "@/lib/layers/trend-view";
import { trendCrossView } from "@/lib/layers/trend-cross";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

/*
 * 추세·추세교차 화면의 `result.scores.get(row.code) ?? 0`이 닿는지 잰다.
 *
 * 두 함수 모두 scores를 ranked와 같은 행 배열에서 만든다(trend-view는 `rows`,
 * trend-cross는 `pairs`→`ranked`). 그래서 ranked에 있는 코드는 scores에 반드시
 * 있고, `?? 0`은 실행되지 않는다 — 값이 없는 지역은 ranked에 들어오기 전에
 * 빠진다(`excluded`). 이 검사는 그 포함 관계를 잠근다. 깨지면(어느 쪽이든
 * 키가 어긋나면) 붉어진다.
 */

const metric = (key: string): MetricDef => ({
  key,
  label: key,
  unit: "%",
  aggregation: "sum",
  formula: "f",
  limitation: "",
  triggers: [key],
});

function cube(layerId: string, key: string, values: Record<string, (number | null)[]>): LayerCube {
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

describe("추세 점수 키 포함 관계", () => {
  // 동3은 첫 달 0이라 산출 불가 → ranked에서 빠지고 excluded로 센다.
  const sparse = cube("skt", "v", {
    "4811100000": [100, 110, 130],
    "4811200000": [100, 105, 110],
    "4811300000": [0, 90, 70],
  });

  test("buildTrendRanking: ranked 코드는 scores에 전부 있다", () => {
    const result = buildTrendRanking(sparse, metric("v"), [metric("v")], "rising", "dong");
    expect(result.excluded).toBe(1);
    expect(result.ranked.length).toBeGreaterThan(0);
    for (const row of result.ranked) {
      expect(result.scores.has(row.code)).toBe(true);
    }
  });

  test("trendCrossView: ranked 코드는 scores에 전부 있다", () => {
    const spend = cube("nh", "w", {
      "4811100000": [100, 90, 70],
      "4811200000": [100, 105, 110],
      "4811300000": [0, 0, 0],
    });
    const result = trendCrossView(
      { cube: sparse, metric: metric("v"), metrics: [metric("v")], direction: "rising" },
      { cube: spend, metric: metric("w"), metrics: [metric("w")], direction: "falling" },
      "dong",
    );
    expect(result.ranked.length).toBeGreaterThan(0);
    for (const row of result.ranked) {
      expect(result.scores.has(row.code)).toBe(true);
    }
  });

  test("가드 민감도: 키가 하나라도 빠지면 이 단언은 붉어진다", () => {
    // 위 두 단언이 공허하지 않음을 보인다. 실제 scores를 건드리지 않는다.
    const result = buildTrendRanking(sparse, metric("v"), [metric("v")], "rising", "dong");
    const tampered = new Map(result.scores);
    tampered.delete(result.ranked[0].code);
    expect(result.ranked.some((row) => !tampered.has(row.code))).toBe(true);
  });
});
