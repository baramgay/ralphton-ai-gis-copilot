import { describe, expect, it } from "vitest";
import { aggregateToSgg } from "@/lib/layers/aggregate";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

const metrics: MetricDef[] = [
  { key: "pop", label: "인구", unit: "명", aggregation: "sum", formula: "f", limitation: "", triggers: [] },
  { key: "ratio", label: "고령비", unit: "%", aggregation: "weightedAvg", weightKey: "pop", formula: "f", limitation: "", triggers: [] },
];

const dongCube: LayerCube = {
  layerId: "population",
  adminLevel: "dong",
  referenceMonth: "2026-06",
  months: ["2026-06"],
  cells: [
    { code: "4812051000", name: "창원 동읍", point: { lat: 35.3, lng: 128.6 }, areaKm2: 10, series: { pop: [100], ratio: [20] } },
    { code: "4812052000", name: "창원 북면", point: { lat: 35.4, lng: 128.6 }, areaKm2: 30, series: { pop: [300], ratio: [40] } },
    { code: "4817051000", name: "진주 A동", point: { lat: 35.1, lng: 128.1 }, areaKm2: 5, series: { pop: [50], ratio: [10] } },
  ],
};

describe("aggregateToSgg", () => {
  it("groups dong cells by 5-digit sgg code", () => {
    const sgg = aggregateToSgg(dongCube, metrics);
    expect(sgg.adminLevel).toBe("sgg");
    expect(sgg.cells.map((c) => c.code).sort()).toEqual(["48120", "48170"]);
  });

  it("sums sum-metrics and area", () => {
    const sgg = aggregateToSgg(dongCube, metrics);
    const changwon = sgg.cells.find((c) => c.code === "48120")!;
    expect(changwon.series.pop).toEqual([400]);
    expect(changwon.areaKm2).toBe(40);
  });

  it("computes weighted average for weightedAvg-metrics", () => {
    const sgg = aggregateToSgg(dongCube, metrics);
    const changwon = sgg.cells.find((c) => c.code === "48120")!;
    // (20*100 + 40*300) / (100+300) = 14000/400 = 35
    expect(changwon.series.ratio).toEqual([35]);
  });

  it("returns null for weighted average when total weight is zero", () => {
    const zero: LayerCube = {
      ...dongCube,
      cells: [
        { code: "4812051000", name: "a", point: { lat: 0, lng: 0 }, areaKm2: 1, series: { pop: [0], ratio: [20] } },
      ],
    };
    const sgg = aggregateToSgg(zero, metrics);
    expect(sgg.cells[0].series.ratio).toEqual([null]);
  });
});
