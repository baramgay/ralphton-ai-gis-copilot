import { describe, expect, test } from "vitest";

import { crossLayerView, type CrossOperand } from "@/lib/layers/cross-analysis";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

const metricA: MetricDef = { key: "a", label: "A", unit: "", aggregation: "sum", formula: "f", limitation: "", triggers: ["a"] };
const metricB: MetricDef = { key: "b", label: "B", unit: "", aggregation: "sum", formula: "f", limitation: "", triggers: ["b"] };

function cube(id: string, values: Record<string, number[]>): LayerCube {
  const codes = ["4811100000", "4811200000", "4811300000"];
  return {
    layerId: id,
    adminLevel: "dong",
    referenceMonth: "2025-01",
    months: ["2025-01"],
    cells: codes.map((code, i) => ({
      code,
      name: `경상남도 동${i + 1}`,
      point: { lat: 35, lng: 128 },
      areaKm2: 1,
      series: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, [v[i]]])),
    })),
  };
}

const cubeA = cube("layer-a", { a: [10, 20, 30] });
const cubeB = cube("layer-b", { b: [30, 20, 10] });

const opA: CrossOperand = { cube: cubeA, metric: metricA, metrics: [metricA] };
const opB: CrossOperand = { cube: cubeB, metric: metricB, metrics: [metricB] };

describe("crossLayerView", () => {
  test("gap mode ranks high-A / low-B dongs first (zA − zB)", () => {
    const { ranked } = crossLayerView(opA, opB, "gap", "dong");
    // dong3 has A=30 (highest), B=10 (lowest) → biggest positive gap.
    expect(ranked[0].code).toBe("4811300000");
    expect(ranked[ranked.length - 1].code).toBe("4811100000");
    expect(ranked[0].composite).toBeGreaterThan(ranked[1].composite);
  });

  test("both mode ranks dongs where A and B are jointly high", () => {
    // Make B track A so dong3 is high on both.
    const bothB = cube("layer-b2", { b: [10, 20, 30] });
    const { ranked } = crossLayerView(opA, { cube: bothB, metric: metricB, metrics: [metricB] }, "both", "dong");
    expect(ranked[0].code).toBe("4811300000");
  });

  test("only includes dongs present in both metrics and exposes both values", () => {
    const { ranked, scores } = crossLayerView(opA, opB, "gap", "dong");
    expect(ranked).toHaveLength(3);
    expect(ranked[0].valueA).toBe(30);
    expect(ranked[0].valueB).toBe(10);
    // composite normalized to 0~100 for the map
    expect(Math.max(...scores.values())).toBeCloseTo(100, 5);
    expect(Math.min(...scores.values())).toBeCloseTo(0, 5);
  });
});
