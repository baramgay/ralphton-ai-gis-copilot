import { describe, expect, test } from "vitest";

import { CROSS_CANDIDATE_LAYERS, CUBE_LAYERS } from "@/lib/layers/catalog";
import { resolveCrossQuery } from "@/lib/layers/resolve-cross-query";
import { resolveTrendCrossQuery } from "@/lib/layers/resolve-trend-cross-query";

/*
 * 조건 둘을 냈는데 하나로 답하는 결함 묶음. 셋 다 "답을 못 한다"가 아니라 "조건 하나를
 * 조용히 버리고 남은 하나로 자신 있게 답한다"라서, 사용자가 사라진 조건을 알아챌 수 없다.
 */
describe("빠진 조건", () => {
  test("'인구 준 동' — 줄다의 관형사형 축약을 읽는다", () => {
    const match = resolveTrendCrossQuery("작년보다 소비 늘고 인구 준 동", CUBE_LAYERS);
    expect(match).not.toBeNull();
    expect(match?.a.direction).toBe("rising");
    expect(match?.b.direction).toBe("falling");
  });

  test("'수준'·'기준'을 감소로 읽지 않는다", () => {
    // "준"을 그냥 낱말 목록에 넣으면 여기서 정반대로 읽는다.
    const match = resolveTrendCrossQuery("소비 수준 늘고 생활인구 기준 늘어나는 동", CUBE_LAYERS);
    expect(match?.a.direction).toBe("rising");
    expect(match?.b.direction).toBe("rising");
  });

  test("'의료도 부족하고 소비도 적은 곳' — 조사가 껴도 의료가 남는다", () => {
    const match = resolveCrossQuery("의료도 부족하고 소비도 적은 곳", CROSS_CANDIDATE_LAYERS);
    expect(match).not.toBeNull();
    const ids = [match?.a.layerId, match?.b.layerId];
    expect(ids).toContain("medical");
  });

  test("기존 교차는 그대로다", () => {
    const match = resolveCrossQuery("생활인구 대비 카드매출 적은 동", CROSS_CANDIDATE_LAYERS);
    expect(match).not.toBeNull();
  });
});
