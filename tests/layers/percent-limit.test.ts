import { describe, expect, test } from "vitest";

import { detectValueThreshold } from "@/lib/analysis/query-signals";
import { detectDirection, detectPercentLimit, detectResultCount } from "@/lib/layers/resolve-layer-query";

/*
 * "상위 10% 소득 지역"이 조건을 무시하고 기본 24행을 답했다(prod 실측).
 *
 * 비율은 **단위 변환이 없어** 안전하다. 값 조건("100만원 이상")은 지표마다 단위가 다르고
 * (카드매출은 백만원인데 사람은 "1,000만원"이라 쓴다) 잘못 환산하면 조용히 틀린 필터가
 * 걸린다 — 안 거르는 것보다 나쁘다. 그래서 비율만 반영하고 값은 고지한다.
 */
describe("detectPercentLimit", () => {
  test.each([
    ["상위 10% 소득 지역", 10],
    ["하위 20% 소득 동", 20],
    ["상위 5 % 카드매출", 5],
    ["top 15% 생활인구", 15],
  ])("비율을 읽는다: %s → %i", (query, expected) => {
    expect(detectPercentLimit(query)).toBe(expected);
  });

  test.each([
    "생활인구 많은 동",
    "카드매출 상위 5곳만",
    "20대가 많은 동네",
    "2km 안에 병원 많은 동",
    "소득 100만원 이상인 동",
  ])("비율이 아니면 null: %s", (query) => {
    expect(detectPercentLimit(query)).toBeNull();
  });

  test.each(["상위 0% 소득", "상위 100% 소득"])("뜻 없는 비율은 무시: %s", (query) => {
    expect(detectPercentLimit(query)).toBeNull();
  });

  test("하위 N%는 방향도 낮은 쪽이다", () => {
    expect(detectDirection("하위 20% 소득 동")).toBe("asc");
    expect(detectPercentLimit("하위 20% 소득 동")).toBe(20);
  });

  test("개수와 비율은 서로 건드리지 않는다", () => {
    expect(detectResultCount("상위 10% 소득 지역")).toBeNull();
    expect(detectPercentLimit("카드매출 상위 5곳만")).toBeNull();
  });
});

describe("비율과 값 조건은 서로 다른 경로다", () => {
  test.each(["상위 10% 소득 지역", "하위 20% 소득 동"])(
    "비율은 값 조건으로 읽지 않는다: %s",
    (query) => {
      expect(detectValueThreshold(query)).toBeNull();
    },
  );

  test.each(["소득 100만원 이상인 동", "생활인구 5만 명 넘는 동"])(
    "값 조건은 비율로 읽지 않는다: %s",
    (query) => {
      expect(detectPercentLimit(query)).toBeNull();
      expect(detectValueThreshold(query)).not.toBeNull();
    },
  );
});
