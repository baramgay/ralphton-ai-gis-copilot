import { describe, expect, test } from "vitest";

import { detectUnsupportedThreshold } from "@/lib/analysis/query-signals";

/*
 * "소득 100만원 이상인 동"·"상위 10% 소득 지역"이 조건을 통째로 무시하고 기본 순위를
 * 그대로 답했다(prod 실측). 순위 자체는 쓸모가 있으므로 막지 않되, 거르지 않았다는
 * 사실은 밝힌다 — 조용히 무시하면 사용자는 걸러진 결과를 본 줄 안다.
 */
describe("detectUnsupportedThreshold", () => {
  test.each([
    ["상위 10% 소득 지역", "상위 N%"],
    ["하위 20% 소득 동", "하위 N%"],
    ["소득 100만원 이상인 동", "값 조건"],
    ["생활인구 5만 명 넘는 동", "값 조건"],
    ["카드매출 1,000만원 이상 상권", "값 조건"],
    ["세대수 3000세대 미만인 동", "값 조건"],
  ])("값 조건을 알아본다: %s", (query, expected) => {
    expect(detectUnsupportedThreshold(query)).toBe(expected);
  });

  test.each([
    "생활인구 많은 동",
    "소득 낮은 읍면동",
    "카드매출 상위 5곳만",
    "2km 안에 병원 많은 동",
    "최근 6개월 소비 추세",
    "20대가 많은 동네",
  ])("값 조건이 아닌 숫자는 건드리지 않는다: %s", (query) => {
    expect(detectUnsupportedThreshold(query)).toBeNull();
  });
});
