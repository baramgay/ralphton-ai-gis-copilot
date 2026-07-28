import { describe, expect, test } from "vitest";

import { resolveQueryWithRules } from "@/lib/analysis/query-rules";

/*
 * "세대수 늘어나는 동"·"1인가구 늘어나는 동"이 **총인구 증감률**로 갔다(prod 실측,
 * Sonnet 2차 리포트). 방향 단서 점수가 커서 질의가 지목한 지표를 통째로 무시하고
 * 전혀 다른 질문에 답한 것이다. 고령비율에서 겪은 것과 같은 함정이다.
 *
 * 추세 도구가 없는 지표라면 **수준이라도 그 지표로** 답하는 편이 낫다. 지표가 맞고
 * 방향만 못 맞춘 답은 사용자가 알아볼 수 있지만, 지표가 다른 답은 알아볼 수 없다.
 */
function parsed(query: string) {
  return resolveQueryWithRules(query);
}

describe("지목한 지표가 방향보다 우선한다", () => {
  test.each([
    ["세대수 늘어나는 동", "rankHouseholdCount"],
    ["세대수 줄어드는 동", "rankHouseholdCount"],
    ["1인가구 늘어나는 동", "rankSingleHouseholdRisk"],
    ["출생 늘어나는 동", "rankBirthCount"],
    ["사망 늘어나는 동", "rankDeathCount"],
  ])("%s → %s", (query, expected) => {
    expect(parsed(query).intent?.tool).toBe(expected);
  });

  test.each(["인구 늘어나는 동", "인구 증가 지역"])(
    "지표를 안 지목하면 인구 추세 그대로: %s",
    (query) => {
      expect(parsed(query).intent?.tool).toBe("rankPopulationGrowthPressure");
    },
  );

  test("인구 감소도 그대로", () => {
    expect(parsed("인구 줄어드는 동").intent?.tool).toBe("rankPopulationDeclineRisk");
  });

  test("고령은 전용 추세 도구가 있으므로 그쪽이 이긴다", () => {
    expect(parsed("고령비율 늘어나는 동").intent?.tool).toBe("rankElderlyRatioTrend");
  });
});

describe("못 맞춘 방향은 밝힌다", () => {
  test.each(["세대수 늘어나는 동", "1인가구 늘어나는 동", "출생 늘어나는 동"])(
    "추세 도구가 없으면 수준으로 답했다고 말한다: %s",
    (query) => {
      expect(parsed(query).notice).toMatch(/변화는 이 지표로 아직 낼 수 없어/);
    },
  );

  test.each(["인구 늘어나는 동", "고령비율 늘어나는 동", "인구 줄어드는 동"])(
    "실제로 추세를 답하면 군더더기를 붙이지 않는다: %s",
    (query) => {
      expect(parsed(query).notice).not.toMatch(/아직 낼 수 없어/);
    },
  );

  test("방향을 안 물으면 붙이지 않는다", () => {
    expect(parsed("세대수 많은 동").notice).not.toMatch(/아직 낼 수 없어/);
  });
});
