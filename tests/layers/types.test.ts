import { describe, expect, it } from "vitest";
import { LayerCubeSchema, LayerDescriptorSchema, type LayerCube } from "@/lib/layers/types";

const cube: LayerCube = {
  layerId: "population",
  adminLevel: "dong",
  referenceMonth: "2026-06",
  months: ["2026-06"],
  cells: [
    {
      code: "4812051000",
      name: "경상남도 창원시 의창구 동읍",
      point: { lat: 35.3, lng: 128.6 },
      areaKm2: 12.3,
      series: { pop_total: [1234] },
    },
  ],
};

describe("layer types", () => {
  it("parses a valid cube", () => {
    expect(LayerCubeSchema.parse(cube)).toEqual(cube);
  });

  it("rejects a cube whose series length differs from months length", () => {
    const bad = { ...cube, cells: [{ ...cube.cells[0], series: { pop_total: [1, 2] } }] };
    expect(() => LayerCubeSchema.parse(bad)).toThrow();
  });

  it("parses a descriptor with metrics", () => {
    const d = LayerDescriptorSchema.parse({
      id: "population",
      label: "인구",
      provider: "공공",
      kind: "choropleth",
      coverage: "gyeongnam",
      adminLevels: ["dong", "sgg"],
      months: ["2026-06"],
      sourceNotes: ["주민등록"],
      metrics: [
        {
          key: "pop_total",
          label: "총인구",
          unit: "명",
          aggregation: "sum",
          formula: "월별 주민등록 인구",
          limitation: "외국인 제외",
          triggers: ["인구", "총인구"],
        },
      ],
    });
    expect(d.metrics[0].aggregation).toBe("sum");
  });
});
