import { describe, expect, test } from "vitest";

import { CUBE_LAYERS } from "@/lib/layers/catalog";
import { resolveTrendCrossQuery } from "@/lib/layers/resolve-trend-cross-query";

/**
 * "생활인구는 느는데 소비는 주는 곳"은 값의 크기가 아니라 두 흐름이 엇갈리는 곳을 묻는다.
 * 이 경로가 없어 생활인구 단순 순위로 답하고 있었다 — 물어본 것과 다른 답이다.
 */
describe("추세 교차 해석", () => {
  test("엇갈리는 두 흐름을 읽는다", () => {
    const match = resolveTrendCrossQuery("생활인구는 느는데 소비는 주는 곳", CUBE_LAYERS);
    expect(match).not.toBeNull();
    expect(match?.a.layerId).toBe("skt-living");
    expect(match?.a.direction).toBe("rising");
    expect(match?.b.layerId).toBe("nh-consumption");
    expect(match?.b.direction).toBe("falling");
  });

  test("같은 방향도 다룬다", () => {
    const match = resolveTrendCrossQuery("생활인구도 늘고 카드매출도 느는 동", CUBE_LAYERS);
    expect(match?.a.direction).toBe("rising");
    expect(match?.b.direction).toBe("rising");
  });

  test("한쪽에만 방향이 붙으면 추세 교차가 아니다", () => {
    // "생활인구 많고 소비 느는 곳"은 수준과 추세가 섞여 있다. 일반 교차가 맡는다.
    expect(resolveTrendCrossQuery("생활인구 많은데 소비 주는 곳", CUBE_LAYERS)?.a.direction).toBeUndefined();
  });

  test("지표가 하나면 단일 추세가 맡는다", () => {
    expect(resolveTrendCrossQuery("카드매출 늘어나는 동", CUBE_LAYERS)).toBeNull();
  });

  test("기간과 지역도 함께 읽는다", () => {
    const match = resolveTrendCrossQuery("최근 6개월 창원 생활인구는 느는데 소비는 주는 곳", CUBE_LAYERS);
    expect(match?.months).toBe(6);
    expect(match?.regionFilters[0]).toMatch(/^창원시/);
  });
});
