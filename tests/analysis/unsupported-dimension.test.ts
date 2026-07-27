import { describe, expect, test } from "vitest";

import { detectUnsupportedDimension } from "@/lib/analysis/query-signals";

/*
 * "주말에 사람 몰리는 곳"이 12개월 인구 증감률로 답하고 있었다(prod 실측). "몰리"가 인구
 * 증가 신호로 등록돼 있어서다. 큐브는 월 집계라 요일·시간대 축 자체가 없다 — 없는 축을
 * 물었는데 있는 축으로 답하면 사용자는 그것이 답인 줄 안다.
 */
describe("detectUnsupportedDimension", () => {
  test.each(["주말에 사람 몰리는 곳", "평일 낮에 붐비는 동네", "시간대별 유동인구", "요일별 소비"])(
    "요일·시간대를 물으면 멈춘다: %s",
    (query) => {
      expect(detectUnsupportedDimension(query)).not.toBeNull();
    },
  );

  test.each(["주말 여는 약국", "야간 진료 병원", "주말에 문 여는 의원"])(
    "영업시간 필터가 실제로 있는 시설 검색은 통과시킨다: %s",
    (query) => {
      expect(detectUnsupportedDimension(query)).toBeNull();
    },
  );

  test.each(["생활인구 많은 동", "소득 낮은 읍면동", "카드매출 늘어나는 곳"])(
    "월 단위 질의는 건드리지 않는다: %s",
    (query) => {
      expect(detectUnsupportedDimension(query)).toBeNull();
    },
  );
});
