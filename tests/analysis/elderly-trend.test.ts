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
    // "오르"는 부정문 중화 목록에만 있고 방향 감지 목록에서 빠져 있었다(prod 실측).
    "고령비율 빨리 오르는 동",
    "고령비율 올라가는 동",
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

  /*
   * "고령비율 하락하는 동"이 rankElderlyRatioTrend(상승 전용, 항상 descending)로 새면
   * 요청과 반대인 "가장 빠르게 오르는 동"이 나온다(4차 피드백에서 지적). 인구 증가/감소가
   * 별도 도구 쌍인 것과 같은 구조로 하락 전용 도구가 있어야 한다.
   */
  test.each(["고령비율 하락하는 동", "노인 인구 비율 낮아지는 곳", "고령비율 떨어지는 동"])(
    "고령 + 하락 방향 → 하락 전용 도구: %s",
    (query) => {
      expect(tool(query)).toBe("rankElderlyRatioDecline");
    },
  );

  test("시군구로도 답할 수 있다 — 성분 합에서 비율을 다시 내므로", () => {
    expect(resolveQueryWithRules("고령비율 상승하는 시군구").intent?.adminLevel).toBe("sgg");
  });
});
