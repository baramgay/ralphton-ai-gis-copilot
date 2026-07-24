import { describe, expect, it } from "vitest";
import { populationCubeFromSnapshot } from "@/lib/layers/from-snapshot";
import { LayerCubeSchema } from "@/lib/layers/types";
import type { AnalysisSnapshot } from "@/lib/domain/schemas";

const months = Array.from({ length: 13 }, (_, i) => `2025-${String((i % 12) + 1).padStart(2, "0")}`);
const snapshot = {
  mode: "demo",
  referenceMonth: months[12],
  months,
  sourceNotes: ["주민등록"],
  regions: [
    {
      adm_cd2: "4812051000",
      adm_nm: "경상남도 창원시 의창구 동읍",
      representativePoint: { lat: 35.3, lng: 128.6 },
      areaSquareKm: 12,
      months,
      population: months.map(() => 1000),
      households: months.map(() => 400),
      populationDensity: months.map(() => 80),
      youthPopulation: months.map(() => 100),
      workingAgePopulation: months.map(() => 600),
      elderlyPopulation: months.map(() => 300),
      onePersonHouseholds: months.map(() => 120),
      births: months.map(() => 2),
      deaths: months.map(() => 3),
      naturalChange: months.map(() => -1),
    },
  ],
  facilities: [],
} as unknown as AnalysisSnapshot;

describe("populationCubeFromSnapshot", () => {
  it("produces a valid dong cube with pop_total series", () => {
    const cube = populationCubeFromSnapshot(snapshot);
    expect(() => LayerCubeSchema.parse(cube)).not.toThrow();
    expect(cube.layerId).toBe("population");
    expect(cube.cells[0].series.pop_total).toHaveLength(13);
    expect(cube.cells[0].series.pop_total[0]).toBe(1000);
  });

  it("computes elderly_ratio as percentage", () => {
    const cube = populationCubeFromSnapshot(snapshot);
    expect(cube.cells[0].series.elderly_ratio[0]).toBeCloseTo(30, 5);
  });
});
