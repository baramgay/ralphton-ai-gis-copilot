import { describe, expect, test } from "vitest";

import { buildOneLineConclusion } from "@/lib/analysis/interpret";
import type { AnalysisResult, AnalyzedRegion } from "@/lib/analysis/result";

function region(name: string, value: number): AnalyzedRegion {
  return {
    adm_cd2: `48111${name.length}0000`,
    adm_nm: `경상남도 ${name}`,
    score: value,
    metrics: [
      {
        label: "평균소득",
        value,
        unit: "만원/월",
        formula: "f",
        referenceMonth: "2025-12",
        limitation: "",
      },
    ],
  } as AnalyzedRegion;
}

const base = (regions: AnalyzedRegion[]): AnalysisResult =>
  ({
    title: "t",
    summary: "s",
    rankedRegions: regions,
    selectedRegion: null,
    filteredFacilities: [],
    legend: [],
    formulaNotes: [],
  }) as unknown as AnalysisResult;

describe("한 줄 결론 문구", () => {
  test("내림차순이면 상위라고 쓴다", () => {
    const text = buildOneLineConclusion(base([region("가동", 500), region("나동", 300), region("다동", 100)]));
    expect(text).toContain("상위 3곳");
  });

  test("오름차순이면 가장 낮은이라고 쓴다", () => {
    const text = buildOneLineConclusion(base([region("가동", 100), region("나동", 300), region("다동", 500)]));
    expect(text).toContain("가장 낮은 3곳");
  });

  test("두 곳뿐이면 방향을 읽지 않는다", () => {
    // "진주 vs 사천 비교"가 "가장 낮은 2곳"으로 나왔다. 비교는 정렬이 아니라 나열이다.
    const text = buildOneLineConclusion(base([region("사천읍", 100), region("문산읍", 300)]));
    expect(text).toContain("상위 2곳");
    expect(text).not.toContain("가장 낮은");
  });

  test("한 곳이면 받침에 맞는 조사를 붙인다", () => {
    // "김해시이(가)"처럼 둘 다 적어 두면 보고서에 그대로 실린다.
    expect(buildOneLineConclusion(base([region("김해시", 100)]))).toContain("김해시가");
    expect(buildOneLineConclusion(base([region("진영읍", 100)]))).toContain("진영읍이");
  });
});
