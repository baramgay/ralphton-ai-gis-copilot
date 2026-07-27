import { describe, expect, test } from "vitest";

import { KCB_CREDIT_LAYER, KCB_GRID_LAYER, SKT_LIVING_LAYER } from "@/lib/layers/catalog";
import { detectGridScope, resolveLayerQuery } from "@/lib/layers/resolve-layer-query";

/*
 * prod에서 6개 표현 중 5개가 조용히 행정동으로 떨어졌다. "격자"는 지표 이름이 아니라
 * 단위인데 트리거에 이름의 일부("격자 소득")로만 적혀 있어서, 두 낱말이 떨어져 있으면
 * 통째로 놓쳤다. 사용자는 격자를 요구했는데 행정동 답을 받고도 그 사실을 알 수 없다.
 */
const LAYERS = [SKT_LIVING_LAYER, KCB_CREDIT_LAYER, KCB_GRID_LAYER];

describe("detectGridScope", () => {
  test.each([
    "격자로 봤을 때 소득 낮은 블록",
    "격자에서 소득 낮은 곳",
    "격자 단위로 소득 낮은 곳",
    "소득 낮은 격자",
    "500m 단위로 보고 싶다",
    "그리드로 보면",
  ])("단위 신호를 찾는다: %s", (query) => {
    expect(detectGridScope(query)).toBe(true);
  });

  test.each(["소득 낮은 동", "생활인구 많은 곳", "카드매출 늘어나는 읍면동"])(
    "단위 신호가 없으면 false: %s",
    (query) => {
      expect(detectGridScope(query)).toBe(false);
    },
  );
});

describe("resolveLayerQuery — 격자 단위 요구", () => {
  test.each([
    "격자로 봤을 때 소득 낮은 블록",
    "격자 소득 낮은 블록",
    "격자에서 소득 낮은 곳",
    "격자 단위로 소득 낮은 곳",
    "소득 낮은 격자",
    "격자로 보면 소득 낮은 곳",
  ])("낱말이 떨어져 있어도 격자 소득으로 간다: %s", (query) => {
    const match = resolveLayerQuery(query, LAYERS);
    expect(match?.layerId).toBe("kcb-grid-500m");
    expect(match?.metricKey).toBe("avg_income");
    expect(match?.geometry).toBe("grid");
    expect(match?.direction).toBe("asc");
  });

  test("격자를 말하지 않으면 행정동 평균소득 그대로", () => {
    const match = resolveLayerQuery("소득 낮은 동", LAYERS);
    expect(match?.layerId).toBe("kcb-credit");
    expect(match?.geometry).toBe("admin");
  });

  test("격자 안에서는 더 구체적인 이름이 이긴다", () => {
    const match = resolveLayerQuery("격자 카드소비 높은 곳", LAYERS);
    expect(match?.metricKey).toBe("card_spend");
  });

  test("격자 인구는 생활인구가 아니라 격자 성인인구", () => {
    const match = resolveLayerQuery("격자로 보면 인구 많은 곳", LAYERS);
    expect(match?.layerId).toBe("kcb-grid-500m");
    expect(match?.metricKey).toBe("pop_total");
  });

  test("격자 레이어를 안 넘기면 격자를 물어도 행정동으로 답한다", () => {
    // 격자 큐브가 없는 배포에서도 답이 사라지지 않아야 한다.
    const match = resolveLayerQuery("격자로 봤을 때 소득 낮은 곳", [SKT_LIVING_LAYER, KCB_CREDIT_LAYER]);
    expect(match?.layerId).toBe("kcb-credit");
  });
});
