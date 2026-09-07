import { describe, expect, test } from "vitest";

import { crossResultToView, multiResultToView } from "@/components/copilot/copilot-app";
import { crossLayerView, type CrossOperand } from "@/lib/layers/cross-analysis";
import { multiLayerView, type MultiOperand } from "@/lib/layers/multi-analysis";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

/*
 * 시군구 모드의 지도 점수 계약.
 *
 * 교차·다중의 `scores`는 지도 채색용이라 시군구 모드에서도 동 코드로 펼쳐져
 * 있다. 순위 행의 코드는 시군구라 그대로 조회하면 전부 빗나가고 `?? 0`이 된다 —
 * 시군구 지도가 회색 하나로 굳는다. 그래서 순위 뷰의 mapScore는 합성값에서 직접
 * 정규화한다. 행정동 모드에서는 같은 식·같은 집합이라 값이 바뀌지 않아야 한다.
 */

const metricA: MetricDef = { key: "a", label: "A지표", unit: "명", aggregation: "sum", formula: "fa", limitation: "", triggers: ["a"] };
const metricB: MetricDef = { key: "b", label: "B지표", unit: "명", aggregation: "sum", formula: "fb", limitation: "", triggers: ["b"] };

function sggCube(id: string, key: string, bySgg: Record<string, number[]>): LayerCube {
  const dongs = [
    { code: "4817000001", name: "경상남도 갑시 동1" },
    { code: "4817000002", name: "경상남도 갑시 동2" },
    { code: "4822000001", name: "경상남도 을시 동1" },
    { code: "4822000002", name: "경상남도 을시 동2" },
  ];
  return {
    layerId: id,
    adminLevel: "dong",
    referenceMonth: "2025-01",
    months: ["2025-01"],
    cells: dongs.map((dong) => {
      const prefix = dong.code.slice(0, 5);
      const values = bySgg[prefix];
      const index = dong.code.endsWith("0001") ? 0 : 1;
      return {
        code: dong.code,
        name: dong.name,
        point: { lat: 35, lng: 128 },
        areaKm2: 1,
        series: { [key]: [values[index]] },
      };
    }),
  };
}

const refA = { provider: "PA", metric: metricA, referenceMonth: "2025-01" };
const refB = { provider: "PB", metric: metricB, referenceMonth: "2025-01" };

describe("시군구 교차 지도 점수", () => {
  const cubeA = sggCube("layer-a", "a", { "48170": [10, 20], "48220": [30, 40] });
  // B는 반대로 기울인다. 같은 기울기면 gap(zA−zB)이 두 곳에서 같아져 점수 판정이 안 된다.
  const cubeB = sggCube("layer-b", "b", { "48170": [35, 45], "48220": [5, 15] });

  test("시군구 순위의 mapScore가 0으로 굳지 않는다", () => {
    const cross = crossLayerView(
      { cube: cubeA, metric: metricA, metrics: [metricA] } satisfies CrossOperand,
      { cube: cubeB, metric: metricB, metrics: [metricB] } satisfies CrossOperand,
      "gap",
      "sgg",
    );
    expect(cross.ranked.map((row) => row.code).sort()).toEqual(["48170", "48220"]);
    const view = crossResultToView(cross, refA, refB, "gap");
    const scores = view.ranked.map((row) => row.mapScore);
    expect(Math.max(...(scores as number[]))).toBeCloseTo(100, 5);
    expect(Math.min(...(scores as number[]))).toBeCloseTo(0, 5);
  });

  test("행정동 모드에서는 기존 scores 조회와 같은 값이다", () => {
    const cross = crossLayerView(
      { cube: cubeA, metric: metricA, metrics: [metricA] } satisfies CrossOperand,
      { cube: cubeB, metric: metricB, metrics: [metricB] } satisfies CrossOperand,
      "gap",
      "dong",
    );
    const view = crossResultToView(cross, refA, refB, "gap");
    for (const row of view.ranked) {
      expect(row.mapScore).toBeCloseTo(cross.scores.get(row.code) ?? Number.NaN, 9);
    }
  });
});

describe("시군구 다중조건 지도 점수", () => {
  const operand = (cube: LayerCube, metric: MetricDef, direction: "high" | "low"): MultiOperand => ({
    cube,
    metric,
    metrics: [metric],
    direction,
  });

  test("시군구 순위의 mapScore가 0으로 굳지 않는다", () => {
    const cubeA = sggCube("layer-a", "a", { "48170": [10, 20], "48220": [30, 40] });
    const cubeB = sggCube("layer-b", "b", { "48170": [5, 15], "48220": [35, 45] });
    const result = multiLayerView(
      [operand(cubeA, metricA, "high"), operand(cubeB, metricB, "high")],
      "sgg",
    );
    expect(result.ranked.map((row) => row.code).sort()).toEqual(["48170", "48220"]);
    const view = multiResultToView(
      result,
      [
        { ...refA, direction: "high" },
        { ...refB, direction: "high" },
      ],
      "sgg",
    );
    const scores = view.ranked.map((row) => row.mapScore);
    expect(Math.max(...(scores as number[]))).toBeCloseTo(100, 5);
    expect(Math.min(...(scores as number[]))).toBeCloseTo(0, 5);
  });
});
