import { describe, expect, test } from "vitest";

import { correlationView, outlierView } from "@/lib/layers/stats-view";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

const metric = (key: string, label: string, unit = "%"): MetricDef => ({
  key,
  label,
  unit,
  aggregation: "weightedAvg",
  formula: `${label} 산식`,
  limitation: "",
  triggers: [label],
});

/** 시군구 하나에 읍면동 여럿을 달아 준다. 시군구 지표의 복제 표본을 재현하려면 필요하다. */
function cube(layerId: string, key: string, bySgg: Record<string, number>, dongsPerSgg = 5): LayerCube {
  const cells = [];
  for (const [sgg, value] of Object.entries(bySgg)) {
    for (let i = 0; i < dongsPerSgg; i += 1) {
      cells.push({
        code: `${sgg}${String(i).padStart(5, "0")}`,
        name: `경상남도 ${sgg}시 ${i}동`,
        point: { lat: 35 + i / 100, lng: 128 + i / 100 },
        areaKm2: 1,
        series: { [key]: [value] },
      });
    }
  }
  return { layerId, adminLevel: "dong", referenceMonth: "2025-12", months: ["2025-12"], cells };
}

const A = { "48170": 10, "48220": 20, "48240": 30, "48250": 40, "48270": 50, "48310": 60 };
const B = { "48170": 11, "48220": 19, "48240": 32, "48250": 38, "48270": 51, "48310": 59 };

const refA = (() => {
  const m = metric("a", "지표A");
  return { cube: cube("layer-a", "a", A), metric: m, metrics: [m] };
})();
const refB = (() => {
  const m = metric("b", "지표B");
  return { cube: cube("layer-b", "b", B), metric: m, metrics: [m] };
})();

const match = (unit: "dong" | "sgg") =>
  ({
    kind: "correlation" as const,
    a: { layerId: "layer-a", layerLabel: "A", provider: "KOSIS" as const, metricKey: "a", metricLabel: "지표A" },
    b: { layerId: "layer-b", layerLabel: "B", provider: "KOSIS" as const, metricKey: "b", metricLabel: "지표B" },
    adminLevel: unit,
    unit,
    regionFilters: [],
  });

describe("correlationView", () => {
  test("시군구 단위로 내면 표본은 시군구 수다", () => {
    const view = correlationView(match("sgg"), refA, refB);
    expect(view.notes.join(" ")).toContain("표본 6개 시군구");
  });

  test("읍면동 단위로 내면 같은 값이 복제되어 표본이 부푼다 — 그래서 단위를 밝힌다", () => {
    /*
     * 이 검사는 "부풀어도 된다"가 아니라 **부푼다는 사실이 화면에 적힌다**를 못 박는다.
     * 시군구 지표는 리졸버가 sgg로 내려보내지만, 단위를 실어 나르지 않으면 30이라는
     * 표본 수만 남아 6개 시군을 30개 관측으로 읽게 된다.
     */
    const view = correlationView(match("dong"), refA, refB);
    expect(view.notes.join(" ")).toContain("표본 30개 읍면동");
  });

  test("시군구로 냈으면 왜 그랬는지 적는다", () => {
    const view = correlationView(match("sgg"), refA, refB);
    expect(view.notes.join(" ")).toContain("읍면동으로 계산하면 같은 값이 반복 집계되어");
  });

  test("상관은 인과가 아니라는 것을 답이 스스로 말한다", () => {
    const view = correlationView(match("sgg"), refA, refB);
    expect(view.notes.join(" ")).toContain("상관은 인과가 아닙니다");
  });

  test("원인을 물었으면 그 물음을 짚어 준다", () => {
    const view = correlationView(match("sgg"), refA, refB, { asksCausation: true });
    expect(view.notes.join(" ")).toContain("인과를 말하지 않습니다");
    expect(view.notes.join(" ")).toContain("제3의 요인");
  });

  test("계수 둘을 모두 싣는다", () => {
    const view = correlationView(match("sgg"), refA, refB);
    expect(view.notes.join(" ")).toMatch(/피어슨 r = /);
    expect(view.notes.join(" ")).toMatch(/스피어만 ρ = /);
  });

  test("한쪽이 모든 지역에서 같으면 관계를 말할 수 없다고 한다", () => {
    const flat = (() => {
      const m = metric("b", "지표B");
      return {
        cube: cube("layer-b", "b", { "48170": 7, "48220": 7, "48240": 7, "48250": 7, "48270": 7, "48310": 7 }),
        metric: m,
        metrics: [m],
      };
    })();
    const view = correlationView(match("sgg"), refA, flat);
    expect(view.summary).toContain("관계를 말할 수 없습니다");
  });
});

describe("outlierView", () => {
  const outlierMatch = {
    kind: "outlier" as const,
    ref: { layerId: "layer-a", layerLabel: "A", provider: "KOSIS" as const, metricKey: "a", metricLabel: "지표A" },
    adminLevel: "sgg" as const,
    unit: "sgg" as const,
    regionFilters: [],
  };

  test("크게 튄 시군구를 집는다", () => {
    const ref = (() => {
      const m = metric("a", "지표A");
      return {
        cube: cube("layer-a", "a", {
          "48170": 10, "48220": 11, "48240": 9, "48250": 12, "48270": 10, "48310": 11,
          "48330": 9, "48720": 13, "48730": 300,
        }),
        metric: m,
        metrics: [m],
      };
    })();
    const view = outlierView(outlierMatch, ref);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].detail).toContain("위");
  });

  test("튀는 곳이 없으면 「자료가 없는 것이 아니다」를 밝힌다", () => {
    const ref = (() => {
      const m = metric("a", "지표A");
      return {
        cube: cube("layer-a", "a", { "48170": 10, "48220": 11, "48240": 9, "48250": 12, "48270": 10, "48310": 11 }),
        metric: m,
        metrics: [m],
      };
    })();
    const view = outlierView(outlierMatch, ref);
    expect(view.rows).toEqual([]);
    expect(view.summary).toContain("자료가 없는 것이 아닙니다");
  });

  test("평균이 아니라 중앙값 기준임을 밝힌다", () => {
    const ref = (() => {
      const m = metric("a", "지표A");
      return { cube: cube("layer-a", "a", A), metric: m, metrics: [m] };
    })();
    expect(outlierView(outlierMatch, ref).notes.join(" ")).toContain("중앙값절대편차(MAD)");
  });
});
