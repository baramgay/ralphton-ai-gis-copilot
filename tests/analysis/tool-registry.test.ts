import { describe, expect, test } from "vitest";

import { ALLOWED_TOOLS, type AnalysisIntent } from "@/lib/analysis/intent-schema";
import { executeAnalysisIntent, toolRegistry } from "@/lib/analysis/tool-registry";
import type { DemoSnapshot, Facility, RegionSeries } from "@/lib/domain/schemas";

const months = [
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
];

function region(
  adm_cd2: string,
  adm_nm: string,
  options: {
    startPopulation?: number;
    endPopulation?: number;
    elderlyPopulation?: number;
    onePersonHouseholds?: number | null;
    lat?: number;
    lng?: number;
  } = {},
): RegionSeries {
  const startPopulation = options.startPopulation ?? 100;
  const endPopulation = options.endPopulation ?? startPopulation;
  const elderlyPopulation = options.elderlyPopulation ?? 20;
  const population = Array.from({ length: 13 }, (_, index) =>
    index === 0 ? startPopulation : index === 12 ? endPopulation : startPopulation,
  );
  const households = Array(13).fill(50) as number[];
  const onePersonHouseholds = options.onePersonHouseholds === undefined ? 10 : options.onePersonHouseholds;

  return {
    adm_cd2,
    adm_nm,
    representativePoint: { lat: options.lat ?? 35, lng: options.lng ?? 129 },
    areaSquareKm: 2,
    months,
    population,
    households,
    populationDensity: population.map((value) => value / 2),
    youthPopulation: population.map(() => 10),
    workingAgePopulation: population.map((value) => value - elderlyPopulation - 10),
    elderlyPopulation: population.map(() => elderlyPopulation),
    onePersonHouseholds: population.map(() => onePersonHouseholds),
    births: population.map(() => 1),
    deaths: population.map(() => 2),
    naturalChange: population.map(() => -1),
  };
}

function facility(
  id: string,
  type: Facility["type"],
  adm_cd2: string,
  adm_nm: string,
  lat: number,
  lng: number,
): Facility {
  return {
    id,
    name: `${adm_nm} ${type}`,
    type,
    adm_cd2,
    adm_nm,
    lat,
    lng,
    specialties: null,
    hours: {
      monday: "09:00-18:00",
      saturday: "09:00-13:00",
      sunday: null,
    },
    address: null,
    phone: null,
  };
}

const regionA = region("4810000001", "경상남도 가동", { lat: 35, lng: 129 });
const regionB = region("4810000002", "경상남도 나동", { lat: 35.1, lng: 129.1 });
const growthRegion = region("4810000003", "경상남도 다동", {
  startPopulation: 100,
  endPopulation: 120,
  onePersonHouseholds: null,
  lat: 35.2,
  lng: 129.2,
});
const declineRegion = region("4810000004", "경상남도 라동", {
  startPopulation: 100,
  endPopulation: 80,
  lat: 35.3,
  lng: 129.3,
});

const medicalA = facility("medical-a", "의원", regionA.adm_cd2, regionA.adm_nm, 35, 129);
const medicalB = facility("medical-b", "의원", regionB.adm_cd2, regionB.adm_nm, 35.1, 129.1);
const pharmacyA = facility("pharmacy-a", "약국", regionA.adm_cd2, regionA.adm_nm, 35, 129);

function snapshot(overrides: Partial<DemoSnapshot> = {}): DemoSnapshot {
  return {
    mode: "demo",
    referenceMonth: "2026-06",
    months,
    regions: [regionA, regionB, growthRegion, declineRegion],
    facilities: [medicalA, medicalB, pharmacyA],
    sourceNotes: ["synthetic test fixture"],
    ...overrides,
  };
}

describe("toolRegistry", () => {
  test("contains exactly the allowed tools", () => {
    expect(Object.keys(toolRegistry).sort()).toEqual([...ALLOWED_TOOLS].sort());
  });

  test("ranks administrative dongs by death count", () => {
    const highDeath = region("4810000091", "경상남도 고사망동", {
      startPopulation: 1000,
      endPopulation: 1000,
    });
    highDeath.deaths = Array(13).fill(30) as number[];
    const lowDeath = region("4810000092", "경상남도 저사망동", {
      startPopulation: 1000,
      endPopulation: 1000,
    });
    lowDeath.deaths = Array(13).fill(3) as number[];

    const result = executeAnalysisIntent(
      { tool: "rankDeathCount", filters: { limit: 10 } },
      snapshot({ regions: [lowDeath, highDeath] }),
    );

    expect(result.rankedRegions[0]?.adm_cd2).toBe("4810000091");
    expect(result.rankedRegions[0]?.score).toBe(30);
    expect(result.title).toContain("사망");
  });


  test("every tool produces the complete analysis-result contract", () => {
    const intents: AnalysisIntent[] = ALLOWED_TOOLS.map((tool) => ({
      tool,
      filters:
        tool === "compareRegions"
          ? { compare: [regionA.adm_cd2, regionB.adm_cd2] }
          : tool === "nearestFacilityDistance" || tool === "getRegionDetails"
            ? { regions: [regionA.adm_cd2] }
            : tool === "countFacilitiesWithinRadius"
              ? { radiusKm: 2 }
              : {},
    })) as AnalysisIntent[];

    for (const intent of intents) {
      const result = executeAnalysisIntent(intent, snapshot());

      expect(Object.keys(result).sort()).toEqual(
        [
          "title",
          "summary",
          "rankedRegions",
          "selectedRegion",
          "filteredFacilities",
          "legend",
          "formulaNotes",
        ].sort(),
      );
    }
  });

  test("breaks equal ranking scores by adm_cd2", () => {
    const result = executeAnalysisIntent(
      { tool: "rankHospitalScarcity", filters: {} },
      snapshot({ regions: [regionB, regionA], facilities: [medicalB, medicalA] }),
    );

    expect(result.rankedRegions.map(({ adm_cd2 }) => adm_cd2)).toEqual([
      regionA.adm_cd2,
      regionB.adm_cd2,
    ]);
  });

  test("uses all non-pharmacy types as the default medical set", () => {
    const defaultResult = executeAnalysisIntent(
      { tool: "filterFacilitiesByTypeAndHours", filters: {} },
      snapshot(),
    );
    const pharmacyResult = executeAnalysisIntent(
      { tool: "filterFacilitiesByTypeAndHours", filters: { facilityTypes: ["약국"] } },
      snapshot(),
    );

    expect(defaultResult.filteredFacilities.map(({ id }) => id)).toEqual(["medical-a", "medical-b"]);
    expect(pharmacyResult.filteredFacilities.map(({ id }) => id)).toEqual(["pharmacy-a"]);
  });

  test("preserves null for nearest distance when the facility set is empty", () => {
    const result = executeAnalysisIntent(
      { tool: "nearestFacilityDistance", filters: { regions: [regionA.adm_cd2] } },
      snapshot({ facilities: [] }),
    );
    const distanceMetric = result.selectedRegion?.metrics.find(({ unit }) => unit === "km");

    expect(distanceMetric?.value).toBeNull();
  });

  test("computes 12-month population growth and decline from snapshot values", () => {
    const growth = executeAnalysisIntent({ tool: "rankPopulationGrowthPressure", filters: {} }, snapshot());
    const decline = executeAnalysisIntent({ tool: "rankPopulationDeclineRisk", filters: {} }, snapshot());

    expect(growth.rankedRegions[0]).toMatchObject({ adm_cd2: growthRegion.adm_cd2, score: 20 });
    expect(decline.rankedRegions[0]).toMatchObject({ adm_cd2: declineRegion.adm_cd2, score: 20 });
  });

  test("excludes missing one-person-household values instead of substituting zero", () => {
    const result = executeAnalysisIntent({ tool: "rankSingleHouseholdRisk", filters: {} }, snapshot());

    expect(result.rankedRegions.some(({ adm_cd2 }) => adm_cd2 === growthRegion.adm_cd2)).toBe(false);
  });

  test("aggregates dong metrics into a 시군구 rollup when a name token matches multiple dongs", () => {
    const d1 = region("4825051000", "경상남도 김해시 삼계동", {
      startPopulation: 1000,
      endPopulation: 1000,
      elderlyPopulation: 100,
      onePersonHouseholds: 30,
    });
    const d2 = region("4825052000", "경상남도 김해시 내외동", {
      startPopulation: 2000,
      endPopulation: 2000,
      elderlyPopulation: 400,
      onePersonHouseholds: 50,
    });

    const result = executeAnalysisIntent(
      { tool: "getRegionDetails", filters: { regions: ["김해시"] } },
      snapshot({ regions: [d1, d2] }),
    );

    expect(result.title).toContain("김해시");
    expect(result.title).toContain("2개");
    const total = result.selectedRegion?.metrics.find((m) => m.label === "총인구");
    expect(total?.value).toBe(3000); // 1000 + 2000 summed, not a single dong
    const households = result.selectedRegion?.metrics.find((m) => m.label === "세대 수");
    expect(households?.value).toBe(100); // 50 + 50
    // 고령비율은 합계 기준: (100+400)/(1000+2000) = 16.67%, 단순 평균(각 10%/20%)이 아님
    const elderly = result.selectedRegion?.metrics.find((m) => m.label === "고령인구 비율");
    expect(elderly?.value).toBeCloseTo((500 / 3000) * 100, 1);
  });

  test("keeps single-dong detail when the token is an explicit 행정동 코드", () => {
    const result = executeAnalysisIntent(
      { tool: "getRegionDetails", filters: { regions: [regionA.adm_cd2] } },
      snapshot(),
    );

    expect(result.selectedRegion?.adm_cd2).toBe(regionA.adm_cd2);
    expect(result.title).not.toContain("합산");
  });

  test("includes complete formula metadata on every emitted metric", () => {
    const result = executeAnalysisIntent(
      { tool: "getRegionDetails", filters: { regions: [regionA.adm_cd2] } },
      snapshot(),
    );

    expect(result.selectedRegion).not.toBeNull();
    for (const metric of result.selectedRegion?.metrics ?? []) {
      expect(Object.keys(metric).sort()).toEqual(
        ["label", "value", "unit", "formula", "referenceMonth", "limitation"].sort(),
      );
      expect(metric.limitation.length).toBeGreaterThan(0);
    }
  });
});
