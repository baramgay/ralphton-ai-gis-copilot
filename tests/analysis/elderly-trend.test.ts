import { describe, expect, test } from "vitest";

import { resolveQueryWithRules } from "@/lib/analysis/query-rules";

/*
 * "노인 인구 비율 상승하는 곳"이 고령비율 **수준** 순위로 답하고, "고령비율 늘어나는 동"은
 * 아예 12개월 **인구** 증감률로 갔다(prod 실측). 고령비율에 추세 도구가 없어 growth 단서가
 * 인구 쪽 도구를 이긴 것이다.
 *
 * 수준과 속도는 정책적으로 다른 질문이다. 이미 고령비율이 높은 군은 오래전부터 높았고,
 * 지금 빠르게 늙는 곳은 대개 다른 데다 — 섞으면 대상지가 뒤바뀐다.
 */
function tool(query: string): string {
  return resolveQueryWithRules(query).intent?.tool ?? `(답못함:${resolveQueryWithRules(query).kind})`;
}

describe("고령화 속도와 수준을 가른다", () => {
  test.each([
    "고령비율 상승하는 동",
    "노인 인구 비율 늘어나는 곳",
    "고령비율 늘어나는 동",
    "고령화 빨라지는 지역",
  ])("고령 + 방향 → 추세 도구: %s", (query) => {
    expect(tool(query)).toBe("rankElderlyRatioTrend");
  });

  // "노인 많은 지역"은 예전부터 고령×의료로 간다 — 이 변경과 무관하므로 건드리지 않는다.
  test.each(["고령비율 높은 동", "고령인구 비율 높은 동", "고령인구 비율 상위 시군구"])(
    "고령만 → 수준 도구 그대로: %s",
    (query) => {
      expect(tool(query)).toBe("rankElderlyRatio");
    },
  );

  test.each(["인구 늘어나는 동", "인구 증가 지역"])("방향만 → 인구 도구 그대로: %s", (query) => {
    expect(tool(query)).toBe("rankPopulationGrowthPressure");
  });

  test("인구 감소는 그대로 감소 도구", () => {
    expect(tool("인구 줄어드는 동")).toBe("rankPopulationDeclineRisk");
  });

  test("시군구로도 답할 수 있다 — 성분 합에서 비율을 다시 내므로", () => {
    expect(resolveQueryWithRules("고령비율 상승하는 시군구").intent?.adminLevel).toBe("sgg");
  });
});
