import { describe, expect, test } from "vitest";

import { baseUnit, detectValueThreshold, thresholdMatches } from "@/lib/analysis/query-signals";

/*
 * "소득 100만원 이상인 동"이 조건을 통째로 무시하고 기본 순위를 답했다(prod 실측).
 *
 * 값 조건에서 위험한 것은 **단위**다. 지표마다 다르다 — 평균소득은 만원/월, 카드매출은
 * 백만원, 생활인구는 명이다. 사람이 쓴 단위와 지표의 단위가 다른데 숫자만 비교하면
 * 조용히 틀린 필터가 걸린다. 그건 안 거르는 것보다 나쁘므로, 단위가 맞을 때만 거른다.
 */
describe("detectValueThreshold", () => {
  test("「100만원」의 만은 단위의 일부다 — 자릿수가 아니다", () => {
    // greedy로 두면 만을 자릿수로 먹고 단위가 "원"이 되어, 평균소득(만원/월)과 영영 안 맞는다.
    expect(detectValueThreshold("소득 100만원 이상인 동")).toEqual({
      op: ">=",
      value: 100,
      unit: "만원",
    });
  });

  test("「5만 명」의 만은 자릿수다 — 단위는 명이다", () => {
    expect(detectValueThreshold("생활인구 5만 명 넘는 동")).toEqual({
      op: ">=",
      value: 50_000,
      unit: "명",
    });
  });

  test.each([
    ["세대수 3000세대 미만인 동", { op: "<", value: 3000, unit: "세대" }],
    ["연체율 5% 이상인 동", { op: ">=", value: 5, unit: "%" }],
    ["소득 300만원 초과", { op: ">", value: 300, unit: "만원" }],
    ["소득 200만원 이하인 동", { op: "<=", value: 200, unit: "만원" }],
    ["카드매출 1,000만원 이상 상권", { op: ">=", value: 1000, unit: "만원" }],
  ])("%s", (query, expected) => {
    expect(detectValueThreshold(query)).toEqual(expected);
  });

  test.each([
    "생활인구 많은 동",
    "카드매출 상위 5곳만",
    "상위 10% 소득 지역",
    "2km 안에 병원 많은 동",
    "최근 6개월 소비 추세",
  ])("값 조건이 아니면 null: %s", (query) => {
    expect(detectValueThreshold(query)).toBeNull();
  });
});

describe("baseUnit — 분모를 뗀다", () => {
  test.each([
    ["만원/월", "만원"],
    ["명/㎢", "명"],
    ["명", "명"],
    ["%", "%"],
    ["백만원", "백만원"],
  ])("%s → %s", (unit, expected) => {
    expect(baseUnit(unit)).toBe(expected);
  });

  test("단위가 다르면 거르지 않는다는 판단의 근거", () => {
    // 카드매출은 백만원인데 사람은 만원으로 쓴다 → 숫자만 비교하면 100배 틀린다.
    const asked = detectValueThreshold("카드매출 1,000만원 이상 상권");
    expect(asked?.unit).toBe("만원");
    expect(baseUnit("백만원")).not.toBe(asked?.unit);
  });

  test("소득은 단위가 맞으므로 거를 수 있다", () => {
    const asked = detectValueThreshold("소득 100만원 이상인 동");
    expect(baseUnit("만원/월")).toBe(asked?.unit);
  });
});

describe("thresholdMatches", () => {
  const ge = { op: ">=" as const, value: 100, unit: "만원" };
  test.each([
    [100, true],
    [150, true],
    [99, false],
  ])("이상 %i → %s", (value, expected) => {
    expect(thresholdMatches(value, ge)).toBe(expected);
  });

  test("초과는 같은 값을 뺀다", () => {
    expect(thresholdMatches(100, { op: ">", value: 100, unit: "만원" })).toBe(false);
  });

  test("값이 없으면 넣지 않는다 — 추정하지 않는다", () => {
    expect(thresholdMatches(null, ge)).toBe(false);
    expect(thresholdMatches(Number.NaN, ge)).toBe(false);
  });
});
