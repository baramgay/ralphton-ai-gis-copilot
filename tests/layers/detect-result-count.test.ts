import { describe, expect, test } from "vitest";

import { detectResultCount } from "@/lib/layers/resolve-layer-query";

/**
 * "상위 5곳만 알려줘"의 5를 읽는다.
 *
 * 위험은 못 읽는 것이 아니라 **엉뚱한 숫자를 개수로 읽는 것**이다. 질의에는 개수가 아닌
 * 숫자가 훨씬 많다("20대 여성", "2km", "500m 격자", "최근 6개월"). 개수로 잘못 읽으면
 * 사용자가 요청하지도 않은 개수로 결과를 잘라 놓고 그 사실을 말하지 않는다 — 조용히
 * 틀리는 쪽이라 더 나쁘다.
 */
describe("detectResultCount", () => {
  test.each([
    ["상위 5곳만 알려줘", 5],
    ["생활인구 많은 동 10개만", 10],
    ["카드매출 높은 3곳", 3],
    ["소득 높은 동네 7군데", 7],
    ["상위 20곳 뽑아줘", 20],
  ])("%s → %i", (query, expected) => {
    expect(detectResultCount(query)).toBe(expected);
  });

  test.each([
    "생활인구 많은 동",
    "20대 여성 소비 많은 곳",
    "2km 안에 병원 없는 동",
    "500m 격자 소득 높은 블록",
    "최근 6개월 생활인구 늘어난 곳",
    "최근 3개월 카드매출",
    "지난 12개월 추세",
    "반경 3km 의료기관",
  ])("개수가 아닌 숫자를 개수로 읽지 않는다: %s", (query) => {
    expect(detectResultCount(query)).toBeNull();
  });

  test("개수 단위 뒤에 글자가 이어지면 개수가 아니다", () => {
    // "6개월"의 6을 개수로 읽으면 결과가 6행으로 잘린다.
    expect(detectResultCount("최근 6개월 소비 추세")).toBeNull();
    expect(detectResultCount("병원 3개소 있는 동")).toBeNull();
  });

  test("범위를 벗어난 값은 개수로 보지 않는다", () => {
    expect(detectResultCount("0곳")).toBeNull();
    expect(detectResultCount("9999곳")).toBeNull();
  });

  test("빈 질의는 null", () => {
    expect(detectResultCount("")).toBeNull();
    expect(detectResultCount("   ")).toBeNull();
  });
});
