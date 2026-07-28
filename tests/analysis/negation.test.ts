import { describe, expect, test } from "vitest";

import { neutralizeNegatedDirection } from "@/lib/analysis/query-catalog-meta";
import { resolveQueryWithRules } from "@/lib/analysis/query-rules";
import { extractQuerySignals } from "@/lib/analysis/query-signals";

/*
 * "인구가 줄지 않은 동"이 감소율이 **가장 높은** 곳을 1위로 답했다(prod 실측). 정확히
 * 반대다. `"인구가 줄"` 단서가 "인구가 줄지 않은"에 그대로 걸려서다.
 *
 * 반대로 답하는 것은 못 답하는 것보다 훨씬 나쁘다 — 화면에 근거까지 붙어 나오므로
 * 사용자가 의심할 이유가 없다.
 */
describe("neutralizeNegatedDirection", () => {
  test.each([
    ["인구가 줄지 않은 동", "증가하"],
    ["카드매출이 늘지 않은 동", "감소하"],
    ["생활인구가 늘어나지 않는 곳", "감소하"],
    ["소비가 증가하지 않은 지역", "감소하"],
    ["인구가 감소하지 않은 동", "증가하"],
    ["매출이 안 늘어나는 동", "감소하"],
  ])("%s → %s 로 읽는다", (query, expected) => {
    expect(neutralizeNegatedDirection(query)).toContain(expected);
  });

  test.each([
    "인구가 줄어드는 동",
    "카드매출 늘어나는 곳",
    "생활인구 많은 동",
    "소득 낮은 읍면동",
  ])("부정이 없으면 그대로 둔다: %s", (query) => {
    expect(neutralizeNegatedDirection(query)).toBe(query);
  });
});

describe("부정문이 정반대 답으로 가지 않는다", () => {
  test("'인구가 줄지 않은 동'은 감소 순위가 아니다", () => {
    const signals = extractQuerySignals("인구가 줄지 않은 동");
    expect(signals.metrics.has("decline")).toBe(false);
    expect(signals.metrics.has("growth")).toBe(true);

    const parsed = resolveQueryWithRules("인구가 줄지 않은 동");
    expect(parsed.intent?.tool).not.toBe("rankPopulationDeclineRisk");
  });

  test("'인구가 줄어드는 동'은 그대로 감소 순위다", () => {
    const signals = extractQuerySignals("인구가 줄어드는 동");
    expect(signals.metrics.has("decline")).toBe(true);
    expect(resolveQueryWithRules("인구가 줄어드는 동").intent?.tool).toBe("rankPopulationDeclineRisk");
  });

  test("'인구가 늘지 않은 동'은 증가 순위가 아니다", () => {
    const signals = extractQuerySignals("인구가 늘지 않은 동");
    expect(signals.metrics.has("growth")).toBe(false);
    expect(signals.metrics.has("decline")).toBe(true);
  });
});
