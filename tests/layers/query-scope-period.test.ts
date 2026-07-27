import { describe, expect, test } from "vitest";

import { CROSS_CANDIDATE_LAYERS, CUBE_LAYERS } from "@/lib/layers/catalog";
import { resolveCrossQuery } from "@/lib/layers/resolve-cross-query";
import { detectTrendMonths, resolveTrendQuery } from "@/lib/layers/resolve-trend-query";

describe("교차 질의의 지역 한정", () => {
  // "창원에서 소득 낮고 의료 취약한 곳"이 거창군 북상면을 답하고 있었다.
  test("시군구를 적으면 싣는다", () => {
    const match = resolveCrossQuery("창원에서 소득 낮고 의료 취약한 곳", CROSS_CANDIDATE_LAYERS);
    expect(match?.regionFilters[0]).toMatch(/^창원시/);
  });

  test("적지 않으면 null", () => {
    expect(resolveCrossQuery("소득 낮고 의료 취약한 곳", CROSS_CANDIDATE_LAYERS)?.regionFilters).toEqual([]);
  });
});

describe("추세 질의의 기간", () => {
  // 물어본 기간과 답한 기간이 다르면 그 자체로 틀린 답이다.
  test.each([
    ["최근 3개월 카드매출 늘어나는 동", 3],
    ["6개월 생활인구 줄어드는 곳", 6],
    ["최근 12개월 소득 늘어나는 지역", 12],
    ["카드매출 늘어나는 동", null],
  ] as const)('"%s" → %s', (query, expected) => {
    expect(detectTrendMonths(query)).toBe(expected);
  });

  test("말이 안 되는 기간은 무시한다", () => {
    // 1개월로는 변화를 말할 수 없고, 자료가 12개월뿐이라 99개월도 의미가 없다.
    expect(detectTrendMonths("최근 1개월 카드매출 늘어나는 동")).toBeNull();
    expect(detectTrendMonths("최근 99개월 카드매출 늘어나는 동")).toBeNull();
  });

  test("추세 매칭에 기간이 실린다", () => {
    const match = resolveTrendQuery("최근 3개월 카드매출 늘어나는 동", CUBE_LAYERS);
    expect(match?.months).toBe(3);
    expect(resolveTrendQuery("카드매출 늘어나는 동", CUBE_LAYERS)?.months).toBeNull();
  });
});
