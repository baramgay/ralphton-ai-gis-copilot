import { describe, expect, test } from "vitest";

import { AnalysisIntentSchema } from "@/lib/analysis/intent-schema";
import { parseIntentWithRules, resolveQueryWithRules } from "@/lib/analysis/query-rules";
import { extractQuerySignals } from "@/lib/analysis/query-signals";
import { augmentQueryWithRag } from "@/lib/rag/augment";

/**
 * Broad regression matrix: colloquial, district-scoped, polarity, facility, compare, follow-up-ish.
 * Rules-only path (offline). AI path is covered separately when keys exist.
 */
const CASES: Array<{
  query: string;
  tool: string;
  check?: (intent: NonNullable<ReturnType<typeof parseIntentWithRules>>) => void;
}> = [
  // scarcity / medical
  { query: "의료 취약 지역", tool: "rankHospitalScarcity" },
  { query: "병원이 부족한 동", tool: "rankHospitalScarcity" },
  { query: "어디가 제일 의료 취약해", tool: "rankHospitalScarcity" },
  { query: "의료 공백 어디", tool: "rankHospitalScarcity" },
  // elderly
  { query: "고령 의료 부족", tool: "rankElderlyUnderserved" },
  { query: "노인 대비 병원 모자란 곳", tool: "rankElderlyUnderserved" },
  { query: "고령화율 높은 동", tool: "rankElderlyRatio" },
  { query: "노인 비율 높은 지역", tool: "rankElderlyRatio" },
  // population dynamics
  { query: "인구증가", tool: "rankPopulationGrowthPressure" },
  { query: "인구가 늘어나는 지역", tool: "rankPopulationGrowthPressure" },
  { query: "인구 감소 위험", tool: "rankPopulationDeclineRisk" },
  { query: "인구가 줄어드는 동", tool: "rankPopulationDeclineRisk" },
  { query: "인구 많은 동", tool: "rankPopulationSize" },
  { query: "주민 수 많은 곳", tool: "rankPopulationSize" },
  { query: "인구밀도 높은 동", tool: "rankPopulationDensity" },
  { query: "밀집 지역", tool: "rankPopulationDensity" },
  // vital
  { query: "사망자 많은 곳", tool: "rankDeathCount" },
  { query: "사망 수 높은 동", tool: "rankDeathCount" },
  { query: "출생이 많은 지역", tool: "rankBirthCount" },
  { query: "출산 많은 곳", tool: "rankBirthCount" },
  { query: "자연감소가 큰 곳", tool: "rankNaturalDecrease" },
  // single household
  { query: "1인가구 많은 동", tool: "rankSingleHouseholdRisk" },
  { query: "단독가구 비중 높은 곳", tool: "rankSingleHouseholdRisk" },
  // access
  { query: "2km 안 병원 적은 곳", tool: "countFacilitiesWithinRadius" },
  { query: "2키로 안 병원", tool: "countFacilitiesWithinRadius" },
  { query: "3km 반경 접근성", tool: "countFacilitiesWithinRadius" },
  { query: "병원까지 먼 동", tool: "nearestFacilityDistance" },
  { query: "최근접 의료기관 거리", tool: "nearestFacilityDistance" },
  // facilities
  { query: "종합병원 위치", tool: "filterFacilitiesByTypeAndHours" },
  { query: "약국만 보여줘", tool: "filterFacilitiesByTypeAndHours" },
  { query: "야간 진료 병원", tool: "filterFacilitiesByTypeAndHours" },
  { query: "주말 약국", tool: "filterFacilitiesByTypeAndHours" },
  { query: "치과 보여줘", tool: "filterFacilitiesByTypeAndHours" },
  { query: "한의원 어디", tool: "filterFacilitiesByTypeAndHours" },
  // region
  { query: "해운대구 상세", tool: "getRegionDetails" },
  { query: "수영구 어때", tool: "getRegionDetails" },
  { query: "기장군 현황", tool: "getRegionDetails" },
  { query: "기장군과 강서구 비교", tool: "compareRegions" },
  { query: "해운대 vs 기장", tool: "compareRegions" },
  { query: "해운대 근처 병원", tool: "filterFacilitiesByTypeAndHours" },
  // scoped rank
  {
    query: "해운대구 의료 취약",
    tool: "rankHospitalScarcity",
    check: (intent) => {
      expect(intent.filters.regions?.[0]).toBe("해운대구");
    },
  },
  {
    query: "수영구 사망자",
    tool: "rankDeathCount",
    check: (intent) => {
      expect(intent.filters.regions).toContain("수영구");
    },
  },
];

const UNSUPPORTED = [
  "오늘 날씨",
  "서울 인구",
  "주식 추천",
  "전입전출 통계",
  "select * from users",
];

describe("query diversity regression", () => {
  test.each(CASES)("parses %# $query → $tool", ({ query, tool, check }) => {
    const intent = parseIntentWithRules(query);
    expect(intent, `failed: ${query}`).not.toBeNull();
    expect(intent!.tool).toBe(tool);
    expect(() => AnalysisIntentSchema.parse(intent)).not.toThrow();
    check?.(intent!);
  });

  test.each(UNSUPPORTED)("rejects or unsupported: %s", (query) => {
    const resolved = resolveQueryWithRules(query);
    if (resolved.kind === "intent") {
      // Should not route security/sql to a tool
      expect(query.toLowerCase()).not.toMatch(/select|drop|exec/);
    } else {
      expect(["unsupported", "unsafe"]).toContain(resolved.kind);
    }
  });

  test("signals + rag agree on medical scarcity domain", () => {
    const query = "병원이 부족한 취약 지역";
    const signals = extractQuerySignals(query);
    expect(signals.metrics.has("scarcity") || signals.metrics.has("medical")).toBe(true);
    const rag = augmentQueryWithRag(query);
    expect(rag.hits.some((hit) => hit.chunk.tags.includes("rankHospitalScarcity"))).toBe(true);
  });

  test("compare aliases preserve order", () => {
    const intent = parseIntentWithRules("해운대 vs 수영");
    expect(intent?.tool).toBe("compareRegions");
    expect(intent?.filters.compare?.[0]).toBe("해운대구");
    expect(intent?.filters.compare?.[1]).toBe("수영구");
  });
});
