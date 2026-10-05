import { describe, expect, test } from "vitest";
import { aggregateToSgg } from "@/lib/layers/aggregate";
import { POPULATION_LAYER, NH_DEMOGRAPHICS_LAYER, NH_HOURLY_LAYER } from "@/lib/layers/catalog";
import { computeTrend, describeTrend } from "@/lib/layers/trend";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

function cube(layerId: string, rows: Array<{ area: number; series: Record<string, (number | null)[]> }>): LayerCube {
  return { layerId, adminLevel: "dong", referenceMonth: "2025-12", months: ["2025-12"],
    cells: rows.map((row, index) => ({ code: `48170${String(index).padStart(5, "0")}`,
      name: `경상남도 진주시 ${index}동`, point: { lat: 35, lng: 128 }, areaKm2: row.area, series: row.series })) };
}

describe("independent denominator arithmetic", () => {
  test("district density is 200 residents divided by 11 square kilometres", () => {
    const input = cube("population", [
      { area: 1, series: { pop_total: [100], density: [100] } },
      { area: 10, series: { pop_total: [100], density: [10] } },
    ]);
    expect(aggregateToSgg(input, POPULATION_LAYER.metrics).cells[0].series.density[0]).toBeCloseTo(200 / 11, 10);
  });

  test("personal youth share is 140 out of 1000, regardless of opposite corporate sales", () => {
    const input = cube("nh-demographics", [
      { area: 1, series: { card_sales: [1000], personal_sales: [100], youth_sales: [50], youth_share: [50] } },
      { area: 1, series: { card_sales: [1000], personal_sales: [900], youth_sales: [90], youth_share: [10] } },
    ]);
    expect(aggregateToSgg(input, NH_DEMOGRAPHICS_LAYER.metrics).cells[0].series.youth_share[0]).toBeCloseTo(14, 12);
  });

  test("night share uses all hours including the evening gap", () => {
    const input = cube("nh-hourly", [
      { area: 1, series: { day_sales: [10], night_sales: [20], night_sales_exact: [20], total_sales: [100], night_share: [20] } },
      { area: 1, series: { day_sales: [90], night_sales: [10], night_sales_exact: [10], total_sales: [100], night_share: [10] } },
    ]);
    expect(aggregateToSgg(input, NH_HOURLY_LAYER.metrics).cells[0].series.night_share[0]).toBe(15);
  });

  test("missing actual NH denominators does not silently substitute total or daytime sales", () => {
    const demographics = cube("nh-demographics", [{ area: 1, series: { card_sales: [1000], youth_share: [50] } }]);
    expect(aggregateToSgg(demographics, NH_DEMOGRAPHICS_LAYER.metrics).cells[0].series.youth_share[0]).toBeNull();
    const hourly = cube("nh-hourly", [{ area: 1, series: { day_sales: [10], night_sales: [20], night_share: [20] } }]);
    expect(aggregateToSgg(hourly, NH_HOURLY_LAYER.metrics).cells[0].series.night_share[0]).toBeNull();
  });

  test.each([null, Number.NaN, Number.POSITIVE_INFINITY])("a missing or nonfinite weighted observation %s cannot become a partial district value", (value) => {
    const metric: MetricDef = { key: "ratio", label: "비율", unit: "%", aggregation: "weightedAvg", weightKey: "base", formula: "ratio", limitation: "", triggers: [] };
    const input = cube("test", [{ area: 1, series: { ratio: [10], base: [100] } }, { area: 1, series: { ratio: [value], base: [100] } }]);
    expect(aggregateToSgg(input, [metric]).cells[0].series.ratio[0]).toBeNull();
  });

  test("zero-denominator members with no ratio have no contribution to a valid district ratio", () => {
    const metric: MetricDef = { key: "ratio", label: "비율", unit: "%", aggregation: "weightedAvg", weightKey: "base", formula: "ratio", limitation: "", triggers: [] };
    const input = cube("test", [{ area: 1, series: { ratio: [10], base: [100] } }, { area: 1, series: { ratio: [null], base: [0] } }]);
    expect(aggregateToSgg(input, [metric]).cells[0].series.ratio[0]).toBe(10);
  });
});

describe("calendar trend arithmetic", () => {
  test("quarterly +30 over nine calendar months has slope 10/3 per month and four observations", () => {
    const trend = computeTrend([100, 110, 120, 130], ["2024-12", "2025-03", "2025-06", "2025-09"]);
    expect(trend.slope).toBeCloseTo(10 / 3, 10);
    expect(trend.firstMonth).toBe("2024-12");
    expect(trend.lastMonth).toBe("2025-09");
    expect(trend.elapsedMonths).toBe(9);
    expect(describeTrend(trend, "유입인구", "명")).toContain("2024-12 → 2025-09 · 관측 4회");
  });

  test("missing newest values retain actual endpoint month and preserve calendar gaps", () => {
    const trend = computeTrend([100, null, 120, null], ["2025-09", "2025-10", "2025-11", "2025-12"]);
    expect(trend.lastMonth).toBe("2025-11");
    expect(trend.elapsedMonths).toBe(2);
    expect(trend.slope).toBe(10);
    expect(trend.changeRate).toBe(20);
  });
});
