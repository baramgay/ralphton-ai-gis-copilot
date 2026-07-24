import { describe, expect, it } from "vitest";

import {
  indexResidentRows,
  mergeLatestPopulation,
} from "@/lib/data/population-live";
import type { AnalysisSnapshot } from "@/lib/domain/schemas";

const base: AnalysisSnapshot = {
  mode: "demo",
  referenceMonth: "2026-06",
  months: [
    "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
  ],
  regions: [
    {
      adm_cd2: "4812125000",
      adm_nm: "경상남도 창원시 의창구 동읍",
      representativePoint: { lat: 35.1, lng: 129.04 },
      areaSquareKm: 2,
      months: [
        "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
        "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      ],
      population: Array(13).fill(1000),
      households: Array(13).fill(400),
      populationDensity: Array(13).fill(500),
      youthPopulation: Array(13).fill(100),
      workingAgePopulation: Array(13).fill(700),
      elderlyPopulation: Array(13).fill(200),
      onePersonHouseholds: Array(13).fill(50),
      births: Array(13).fill(1),
      deaths: Array(13).fill(1),
      naturalChange: Array(13).fill(0),
    },
  ],
  facilities: [],
  sourceNotes: [],
};

describe("population-live", () => {
  it("indexes and merges latest population month", () => {
    const indexed = indexResidentRows([
      {
        admmCd: "4812125000",
        totNmpr: 2500,
        hhCnt: 900,
        stdgMtrYm: "202606",
      },
    ]);
    expect(indexed.get("4812125000")?.population).toBe(2500);

    const merged = mergeLatestPopulation(base, indexed);
    expect(merged.updatedCount).toBe(1);
    expect(merged.regions[0].population[12]).toBe(2500);
    expect(merged.regions[0].households[12]).toBe(900);
    expect(merged.regions[0].population[0]).toBe(1000);
  });
});
