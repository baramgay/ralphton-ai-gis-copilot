import { describe, expect, test } from "vitest";

import { TOOL_CATALOG } from "@/lib/analysis/query-catalog";
import { resolveQueryWithRules } from "@/lib/analysis/query-rules";
import { extractQuerySignals } from "@/lib/analysis/query-signals";

/*
 * 세대수는 큐브에도 있고 신호(metricCue "households")도 잡히는데 순위 도구만 없었다.
 * "세대수 많은 동"이 어떤 표현으로도 "등록된 분석 도구와 맞지 않습니다"로 떨어졌다
 * (prod 실측) — 총인구·고령비율·출생은 되는데 세대수만 안 됐다.
 *
 * 이 결함은 회귀 스크립트가 아니라, 1인가구 안내가 "세대수로 물어보세요"라고 가리킨
 * 자리가 정작 답이 안 되는 것을 화면 글자에서 읽고 드러났다.
 */
/*
 * 앱이 실제로 쓰는 경로를 그대로 부른다. 처음엔 채점 규칙을 손으로 옮겨 적은 테스트를
 * 썼는데, 그것은 카탈로그 행이 있는지만 확인할 뿐 **질의가 답에 닿는지**는 확인하지
 * 못한다. 문턱값(SOFT_SCORE_THRESHOLD·GAP)을 넘지 못해 "도구와 맞지 않습니다"로
 * 떨어지는 경우가 그 테스트에서는 통과로 보인다.
 */
function bestTool(query: string): string {
  const parsed = resolveQueryWithRules(query);
  return parsed.intent?.tool ?? `(답못함:${parsed.kind})`;
}

describe("세대 수 순위 도구", () => {
  test("카탈로그에 등록돼 있다", () => {
    expect(TOOL_CATALOG.some((entry) => entry.id === "rankHouseholdCount")).toBe(true);
  });

  test.each(["세대수 많은 동", "가구 수 많은 읍면동", "세대 많은 지역"])(
    "세대수 질의가 이 도구로 간다: %s",
    (query) => {
      expect(bestTool(query)).toBe("rankHouseholdCount");
    },
  );

  test("1인가구를 물으면 그쪽에 양보한다", () => {
    expect(bestTool("1인가구 비중 높은 동")).toBe("rankSingleHouseholdRisk");
    expect(bestTool("단독가구 많은 곳")).toBe("rankSingleHouseholdRisk");
  });

  test("세대수만으로 판단하지 말라는 경고가 안내에 있다", () => {
    const entry = TOOL_CATALOG.find((item) => item.id === "rankHouseholdCount");
    expect(entry?.notice(extractQuerySignals("세대수 많은 동"))).toMatch(/세대당 인구/);
  });
});
