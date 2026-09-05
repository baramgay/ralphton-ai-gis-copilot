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

  it("truncates sgg cell name to the first two tokens", () => {
    const longNames: LayerCube = {
      ...dongCube,
      cells: [
        { code: "4812051000", name: "경상남도 창원시 의창구 동읍", point: { lat: 35.3, lng: 128.6 }, areaKm2: 10, series: { pop: [100], ratio: [20] } },
        { code: "4812052000", name: "경상남도 창원시 성산구 반송동", point: { lat: 35.4, lng: 128.6 }, areaKm2: 30, series: { pop: [300], ratio: [40] } },
      ],
    };
    const sgg = aggregateToSgg(longNames, metrics);
    expect(sgg.cells.find((c) => c.code === "48120")!.name).toBe("경상남도 창원시");
  });

  it("averages member points for the sgg cell", () => {
    const sgg = aggregateToSgg(dongCube, metrics);
    const changwon = sgg.cells.find((c) => c.code === "48120")!;
    // mean of (35.3,128.6) and (35.4,128.6)
    expect(changwon.point.lat).toBeCloseTo(35.35, 5);
    expect(changwon.point.lng).toBeCloseTo(128.6, 5);
  });
});

/*
 * 2026-09-04 외부 검증에서 잡힌 결함. sum 경로가 `?? 0`으로 결손을 0으로 더해, 소속 동
 * 하나가 비면 그 시군구 합계가 **실제보다 작은 값**으로 인쇄됐다. 실데이터에 이미 있다:
 * kcb-migration.move_in 1곳, nh-demographics.card_sales 2곳, nh-hourly 3곳.
 */
describe("sum 집계는 결손을 0으로 메우지 않는다", () => {
  const sumMetric: MetricDef = {
    key: "s",
    label: "합계 지표",
    unit: "명",
    aggregation: "sum",
    formula: "소속 읍면동 합",
    limitation: "",
    triggers: ["합계"],
  };

  const cubeOf = (values: (number | null)[]): LayerCube => ({
    layerId: "test",
    adminLevel: "dong",
    referenceMonth: "2025-12",
    months: ["2025-12"],
    cells: values.map((value, index) => ({
      code: `4817${String(index).padStart(6, "0")}`,
      name: `경상남도 진주시 ${index}동`,
      point: { lat: 35, lng: 128 },
      areaKm2: 1,
      series: { s: [value] },
    })),
  });

  it("한 동이 비면 시군구 합계는 null이다", () => {
    const out = aggregateToSgg(cubeOf([100, null, 50]), [sumMetric]);
    expect(out.cells).toHaveLength(1);
    // 150은 "있는 것만 더한" 값이다. 그 값이 나오면 결손이 낮은 지역으로 인쇄된다.
    expect(out.cells[0].series.s[0]).toBeNull();
  });

  it("전부 있으면 그대로 더한다", () => {
    const out = aggregateToSgg(cubeOf([100, 30, 50]), [sumMetric]);
    expect(out.cells[0].series.s[0]).toBe(180);
  });
});
