import { describe, expect, it } from "vitest";

import {
  buildOneLineConclusion,
  interpretAnalysisResult,
} from "@/lib/analysis/interpret";
import type { AnalysisResult } from "@/lib/analysis/result";
import type { AnalysisSnapshot } from "@/lib/domain/schemas";

const months = [
  "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
];

const snapshot: AnalysisSnapshot = {
  mode: "demo",
  referenceMonth: "2026-06",
  months,
  regions: [
    {
      adm_cd2: "2611051000",
      adm_nm: "부산광역시 중구 중앙동",
      representativePoint: { lat: 35.1, lng: 129.04 },
      areaSquareKm: 1,
      months,
      population: Array(13).fill(1),
      households: Array(13).fill(1),
      populationDensity: Array(13).fill(1),
      youthPopulation: Array(13).fill(1),
      workingAgePopulation: Array(13).fill(1),
      elderlyPopulation: Array(13).fill(1),
      onePersonHouseholds: Array(13).fill(1),
      births: Array(13).fill(1),
      deaths: Array(13).fill(1),
      naturalChange: Array(13).fill(0),
    },
  ],
  facilities: [],
  sourceNotes: ["test"],
};

const result: AnalysisResult = {
  title: "의료 취약 지역",
  summary: "요약",
  rankedRegions: [
    {
      adm_cd2: "2611051000",
      adm_nm: "부산광역시 중구 중앙동",
      representativePoint: { lat: 35.1, lng: 129.04 },
      areaSquareKm: 1,
      rank: 1,
      score: 80,
      metrics: [
        {
          label: "취약지수",
          value: 80,
          unit: "점",
          formula: "가중 합",
          referenceMonth: "2026-06",
          limitation: "직선거리",
        },
      ],
    },
  ],
  selectedRegion: null,
  filteredFacilities: [],
  legend: [],
  formulaNotes: ["공급 부족 35%"],
};

describe("interpretAnalysisResult", () => {
  it("returns insights and suggestions without provider names", () => {
    const interpretation = interpretAnalysisResult(result, snapshot, {
      selectedRegionCode: "2611051000",
    });

    expect(interpretation.headline).toContain("의료 취약");
    expect(interpretation.insights.join(" ")).toContain("중앙동");
    expect(interpretation.suggestions.length).toBeGreaterThan(0);
    expect(interpretation.suggestions.join(" ")).toMatch(/평가자|부산|경남|비교/);
    expect(JSON.stringify(interpretation)).not.toMatch(/qwen|dashscope|openai/i);
  });

  it("builds a one-line policy conclusion", () => {
    const line = buildOneLineConclusion(result, { selectedRegionCode: "2611051000" });
    expect(line).toMatch(/중앙동|취약/);
    expect(line.length).toBeGreaterThan(8);
  });

  it("joins multiple top region names in the headline", () => {
    const mixed: AnalysisResult = {
      ...result,
      rankedRegions: [
        {
          ...result.rankedRegions[0],
          adm_cd2: "4812051000",
          adm_nm: "경상남도 창원시 의창구 중앙동",
          rank: 1,
        },
        {
          ...result.rankedRegions[0],
          adm_cd2: "4812151000",
          adm_nm: "경상남도 창원시 의창구 용지동",
          rank: 2,
          score: 70,
        },
      ],
    };
    const line = buildOneLineConclusion(mixed);
    expect(line).toMatch(/중앙동/);
    expect(line).toMatch(/용지동/);
  });
});
