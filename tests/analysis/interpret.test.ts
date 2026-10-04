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
      adm_cd2: "4812125000",
      adm_nm: "경상남도 창원시 의창구 동읍",
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
      adm_cd2: "4812125000",
      adm_nm: "경상남도 창원시 의창구 동읍",
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
  it.each(["의료 접근성 취약 지역", "고령층 의료 접근 취약 지역", "교차분석"])("marks synthetic population inputs in %s", (title) => {
    const medical = { ...result, title, rankedRegions: [{ ...result.rankedRegions[0], metrics: [
      { ...result.rankedRegions[0].metrics[0], label: "고령인구 비율 (공공)", unit: "%", formula: "65세 이상 인구 ÷ 총인구 × 100" },
      { ...result.rankedRegions[0].metrics[0], label: "카드매출 (NH)", formula: "카드 승인액 합계" },
    ] }] };
    const interpretation = interpretAnalysisResult(medical, snapshot, { layerId: title === "교차분석" ? "cross" : "medical" });
    expect(interpretation.insights.join(" ")).toContain("인구·세대·출생·사망은 합성값");
    expect(interpretation.caveats.join(" ")).toContain("인구·세대·출생·사망은 합성값");
  });

  it("keeps private population observations free of snapshot synthetic warnings in private cross analysis", () => {
    const privateCross = { ...result, title: "교차분석", rankedRegions: [{ ...result.rankedRegions[0], metrics: [
      { ...result.rankedRegions[0].metrics[0], label: "유입인구 (KCB)", formula: "유입인구 합계" },
      { ...result.rankedRegions[0].metrics[0], label: "총생활인구 (SKT)", formula: "총인구 추정" },
    ] }] };
    const interpretation = interpretAnalysisResult(privateCross, snapshot, { layerId: "cross" });
    expect(interpretation.insights.join(" ")).not.toContain("합성값");
  });

  it("marks the synthetic elderly demand input in a private × medical cube analysis", () => {
    const mixed = { ...result, title: "교차분석", rankedRegions: [{ ...result.rankedRegions[0], metrics: [
      { ...result.rankedRegions[0].metrics[0], label: "총생활인구 (SKT)", formula: "총인구 추정" },
      { ...result.rankedRegions[0].metrics[0], label: "의료 접근성 취약지수 (공공)", formula: "공급35%+고령수요25%+최근접25%+2km무시설15%" },
    ] }] };
    const interpretation = interpretAnalysisResult(mixed, snapshot, { layerId: "cross" });
    expect(interpretation.insights.join(" ")).toContain("인구·세대·출생·사망은 합성값");
  });

  it("uses inferred ascending direction consistently in conclusion and rank insight", () => {
    const ascending = { ...result, rankedRegions: [1, 2, 3].map(value => ({
      ...result.rankedRegions[0], metrics: [{ ...result.rankedRegions[0].metrics[0], value }],
    })) };
    const interpretation = interpretAnalysisResult(ascending, snapshot);
    expect(interpretation.insights[0]).toContain("가장 낮은");
    expect(interpretation.insights[1]).toContain("낮은 순 지역:");
  });

  const livingResult: AnalysisResult = {
    ...result,
    title: "생활인구 순위",
    rankedRegions: [{
      ...result.rankedRegions[0],
      score: 100,
      metrics: [{ ...result.rankedRegions[0].metrics[0], label: "총생활인구", value: 12000, unit: "명", referenceMonth: "2025-12" }],
    }],
  };

  it("uses the living population metric month and raw unit rather than snapshot month and map score", () => {
    const interpretation = interpretAnalysisResult(livingResult, snapshot);
    const insights = interpretation.insights.join(" ");
    expect(insights).toContain("기준월 2025-12");
    expect(insights).not.toContain("2026-06");
    expect(insights).toContain("총생활인구 12,000명");
    expect(insights).not.toContain("100점");
  });

  it("labels each metric month when analysis combines different months", () => {
    const mixed = {
      ...livingResult,
      rankedRegions: [{ ...livingResult.rankedRegions[0], metrics: [
        livingResult.rankedRegions[0].metrics[0],
        { ...livingResult.rankedRegions[0].metrics[0], label: "카드매출", unit: "백만원", referenceMonth: "2025-11" },
      ] }],
    };
    const interpretation = interpretAnalysisResult(mixed, snapshot);
    expect(interpretation.insights.join(" ")).toContain("총생활인구 2025-12 · 카드매출 2025-11");
    expect(interpretation.caveats.join(" ")).toContain("기준월이 서로 다른");
  });

  it("describes ascending ranks as low values", () => {
    const interpretation = interpretAnalysisResult(livingResult, snapshot, { ascending: true });
    expect(interpretation.insights.join(" ")).toContain("낮은 순 지역:");
    expect(interpretation.insights.join(" ")).not.toContain("상위 지역:");
  });

  it("warns about synthetic population while identifying private observations independently of snapshot mode", () => {
    const privateData = interpretAnalysisResult(livingResult, snapshot, {
      activeLayer: { referenceMonth: "2025-12", provider: "SKT", label: "생활인구" },
      layerId: "skt-living",
    });
    expect(privateData.insights.join(" ")).toContain("SKT · 생활인구");
    expect(privateData.caveats.join(" ")).not.toMatch(/시연용 합성|인구·세대·출생·사망은 합성/);
    const population = interpretAnalysisResult({ ...result, title: "총인구 순위" }, snapshot, { layerId: "population" });
    expect(population.caveats.join(" ")).toContain("인구·세대·출생·사망은 합성값");
  });

  it("returns insights and suggestions without provider names", () => {
    const interpretation = interpretAnalysisResult(result, snapshot, {
      selectedRegionCode: "4812125000",
    });

    expect(interpretation.headline).toContain("의료 취약");
    expect(interpretation.insights.join(" ")).toContain("동읍");
    expect(interpretation.suggestions.length).toBeGreaterThan(0);
    expect(interpretation.suggestions.join(" ")).toMatch(/평가자|경남|비교/);
    expect(JSON.stringify(interpretation)).not.toMatch(/qwen|dashscope|openai/i);
  });

  it("builds a one-line policy conclusion", () => {
    const line = buildOneLineConclusion(result, { selectedRegionCode: "4812125000" });
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
