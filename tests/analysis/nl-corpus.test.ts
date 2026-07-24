import { describe, expect, test } from "vitest";

import { resolveQueryWithRules } from "@/lib/analysis/query-rules";

/**
 * Broad natural-language routing corpus. Exercises colloquial / 반말 / 오탈자 / 축약 /
 * 복합 질의 across every tool so regressions in signal extraction or catalog scoring
 * surface as a failing case. expected === null means the query is out of scope and
 * must return an unsupported result carrying the "범위 밖" notice.
 *
 * When adding a newly-supported phrasing, add its case here so it stays locked.
 */
type Case = [query: string, expectedTool: string | null];

const CORPUS: Case[] = [
  // 사망
  ["사망자 많은 곳", "rankDeathCount"],
  ["사람 많이 죽는 동네", "rankDeathCount"],
  ["어디가 사망이 제일 많냐", "rankDeathCount"],
  ["사망자수 top10", "rankDeathCount"],
  // 출생
  ["출생이 많은 지역", "rankBirthCount"],
  ["출생아 많은 데", "rankBirthCount"],
  ["애기 많이 태어나는 곳", "rankBirthCount"],
  ["출산 많은 곳", "rankBirthCount"],
  // 자연증가/감소 (양극 분리)
  ["자연증가가 큰 곳", "rankNaturalIncrease"],
  ["자연증가 큰 동", "rankNaturalIncrease"],
  ["출생이 사망보다 많은 지역", "rankNaturalIncrease"],
  ["자연감소가 큰 곳", "rankNaturalDecrease"],
  ["사망이 출생보다 많은 동네", "rankNaturalDecrease"],
  // 인구 규모/밀도/증감
  ["인구 많은 동", "rankPopulationSize"],
  ["사람 제일 많은 지역", "rankPopulationSize"],
  ["주민수 많은 곳", "rankPopulationSize"],
  ["총인구 많은 지역", "rankPopulationSize"],
  ["인구밀도 높은 동", "rankPopulationDensity"],
  ["빽빽한 동네", "rankPopulationDensity"],
  ["인구 늘어나는 지역", "rankPopulationGrowthPressure"],
  ["사람 몰리는 곳", "rankPopulationGrowthPressure"],
  ["인구 줄어드는 동", "rankPopulationDeclineRisk"],
  ["소멸 위험 지역", "rankPopulationDeclineRisk"],
  ["인구 유출 심한 곳", "rankPopulationDeclineRisk"],
  // 고령/1인가구
  ["고령화율 높은 동", "rankElderlyRatio"],
  ["노인 비율 높은 곳", "rankElderlyRatio"],
  ["1인가구 많은 동", "rankSingleHouseholdRisk"],
  ["혼자 사는 사람 많은 곳", "rankSingleHouseholdRisk"],
  // 의료 취약/접근성
  ["의료 취약 지역", "rankHospitalScarcity"],
  ["병원 부족한 동네", "rankHospitalScarcity"],
  ["어디가 의료 사각지대야", "rankHospitalScarcity"],
  ["고령 인구 대비 병원 부족한 곳", "rankElderlyUnderserved"],
  ["노인 많은데 병원 없는 동네", "rankElderlyUnderserved"],
  ["2km 안에 병원 적은 동", "countFacilitiesWithinRadius"],
  ["3키로 반경 병원 수", "countFacilitiesWithinRadius"],
  ["병원까지 먼 동네", "nearestFacilityDistance"],
  // 시설 목록/유형/시간
  ["종합병원 어디 있어", "filterFacilitiesByTypeAndHours"],
  ["약국만 보여줘", "filterFacilitiesByTypeAndHours"],
  ["야간 진료 병원", "filterFacilitiesByTypeAndHours"],
  ["주말에 여는 약국", "filterFacilitiesByTypeAndHours"],
  ["치과 위치", "filterFacilitiesByTypeAndHours"],
  ["한의원 목록", "filterFacilitiesByTypeAndHours"],
  ["김해 근처 병원", "filterFacilitiesByTypeAndHours"],
  // 지역 상세/비교
  ["김해시 어때", "getRegionDetails"],
  ["진주시 현황", "getRegionDetails"],
  ["창원 현황", "getRegionDetails"],
  ["창원과 김해 비교", "compareRegions"],
  ["진주 vs 사천", "compareRegions"],
  // 지역 스코프 + 지표
  ["창원 인구 많은 동", "rankPopulationSize"],
  ["진주 고령화율 높은 동", "rankElderlyRatio"],
  // 범위 밖
  ["서울 인구", null],
  ["부산 해운대 병원", null],
  ["대구 사망자", null],
  ["제주도 고령화", null],
  ["경기도 인구밀도", null],
];

describe("natural-language routing corpus", () => {
  test.each(CORPUS)('routes "%s" correctly', (query, expectedTool) => {
    const resolved = resolveQueryWithRules(query);

    if (expectedTool === null) {
      expect(resolved.kind).toBe("unsupported");
      expect(resolved.notice).toContain("범위 밖");
      return;
    }

    expect(resolved.kind).toBe("intent");
    if (resolved.kind === "intent") {
      expect(resolved.intent.tool).toBe(expectedTool);
    }
  });
});
