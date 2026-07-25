import { describe, expect, test } from "vitest";

import { buildRegionProfile, percentileOf } from "@/lib/layers/region-profile";
import type { LayerCube, LayerDescriptor, MetricDef } from "@/lib/layers/types";

const metricA: MetricDef = { key: "a", label: "지표A", unit: "명", aggregation: "sum", formula: "f", limitation: "", triggers: ["a"] };
const metricB: MetricDef = { key: "b", label: "지표B", unit: "%", aggregation: "sum", formula: "f", limitation: "", triggers: ["b"] };

const layer = (id: string, label: string, provider: LayerDescriptor["provider"], metrics: MetricDef[]) =>
  ({ id, label, provider, kind: "choropleth", coverage: "gyeongnam", adminLevels: ["dong"], metrics, sourceNotes: [] }) as Omit<LayerDescriptor, "months">;

function cube(layerId: string, values: Record<string, Array<number | null>>): LayerCube {
  const codes = ["4811100000", "4811200000", "4811300000"];
  return {
    layerId,
    adminLevel: "dong",
    referenceMonth: "2025-12",
    months: ["2025-11", "2025-12"],
    cells: codes.map((code, i) => ({
      code,
      name: `동${i + 1}`,
      point: { lat: 35, lng: 128 },
      areaKm2: 1,
      // 첫 달은 의미 없는 값, 둘째 달(기준월)이 실제 비교 대상
      series: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, [0, v[i]]])),
    })),
  };
}

describe("percentileOf", () => {
  test("최상위는 100, 최하위는 0", () => {
    expect(percentileOf(30, [10, 20, 30])).toBeCloseTo(100, 6);
    expect(percentileOf(10, [10, 20, 30])).toBeCloseTo(0, 6);
    expect(percentileOf(20, [10, 20, 30])).toBeCloseTo(50, 6);
  });

  test("비교 대상이 하나뿐이면 순위 맥락이 없으므로 null", () => {
    expect(percentileOf(5, [5])).toBeNull();
  });
});

describe("buildRegionProfile", () => {
  const layers = [
    layer("skt", "생활인구", "SKT", [metricA]),
    layer("nh", "카드소비", "NH", [metricB]),
  ];
  const cubes = {
    skt: cube("skt", { a: [10, 20, 30] }),
    nh: cube("nh", { b: [5, 15, 25] }),
  };

  test("여러 레이어의 지표를 한 지역 기준으로 모은다", () => {
    const profile = buildRegionProfile("4811300000", "경상남도 동3", layers, cubes);
    expect(profile.entries).toHaveLength(2);
    expect(profile.entries.map((entry) => entry.layerId)).toEqual(["skt", "nh"]);
    expect(profile.entries[0]).toMatchObject({
      metricLabel: "지표A",
      provider: "SKT",
      value: 30,
      unit: "명",
      referenceMonth: "2025-12",
    });
  });

  test("절대값과 함께 경남 전체 대비 백분위를 싣는다", () => {
    const top = buildRegionProfile("4811300000", "동3", layers, cubes);
    expect(top.entries[0].percentile).toBeCloseTo(100, 6);
    const bottom = buildRegionProfile("4811100000", "동1", layers, cubes);
    expect(bottom.entries[0].percentile).toBeCloseTo(0, 6);
  });

  test("기준월 값을 쓴다(첫 달이 아니라)", () => {
    const profile = buildRegionProfile("4811200000", "동2", layers, cubes);
    expect(profile.entries[0].value).toBe(20); // months[1] = 기준월
  });

  test("아직 로드되지 않은 큐브는 건너뛴다", () => {
    const profile = buildRegionProfile("4811100000", "동1", layers, { skt: cubes.skt, nh: null });
    expect(profile.entries).toHaveLength(1);
    expect(profile.entries[0].layerId).toBe("skt");
  });

  test("그 지역이 없는 큐브도 건너뛴다", () => {
    const profile = buildRegionProfile("9999999999", "없는동", layers, cubes);
    expect(profile.entries).toHaveLength(0);
  });

  test("단일 시점이 아니라 전 기간 추세를 함께 낸다", () => {
    // 동2는 첫 달 0 → 기준월 20으로 늘었다. 값만 보면 방향을 알 수 없다.
    const profile = buildRegionProfile("4811200000", "동2", layers, cubes);
    expect(profile.entries[0].trend.points).toBe(2);
    expect(profile.entries[0].trend.direction).toBe("rising");
  });

  test("관측이 모자란 지표는 추세를 지어내지 않는다", () => {
    const sparse = { skt: cube("skt", { a: [10, 20, 30] }) };
    // 한 달만 값이 있으면 방향을 말할 수 없다.
    sparse.skt.cells[0].series.a = [null, 20];
    const profile = buildRegionProfile("4811100000", "동1", [layers[0]], sparse);
    expect(profile.entries[0].trend.points).toBe(1);
    expect(profile.entries[0].trend.changeRate).toBeNull();
    expect(profile.entries[0].trend.direction).toBe("flat");
  });

  test("값이 결측이면 백분위를 지어내지 않는다", () => {
    const withNull = { skt: cube("skt", { a: [null, 20, 30] }) };
    const profile = buildRegionProfile("4811100000", "동1", [layers[0]], withNull);
    expect(profile.entries[0].value).toBeNull();
    expect(profile.entries[0].percentile).toBeNull();
  });
});
