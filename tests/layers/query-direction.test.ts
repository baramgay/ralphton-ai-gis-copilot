import { describe, expect, test } from "vitest";

import { CUBE_LAYERS } from "@/lib/layers/catalog";
import { detectDirection, resolveLayerQuery } from "@/lib/layers/resolve-layer-query";
import { buildLayerView } from "@/lib/layers/select";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

/**
 * 낮은 쪽을 물었는데 높은 순으로 답하면 **정반대 답**이다. prod에서 "생활인구 적은 곳"에
 * 양산시 물금읍 97,787명을 1위로 내놓고 있었다. 정책 질의의 상당수가 "적은·낮은·부족한"
 * 이라 이 방향 판정은 라우팅만큼 중요하다.
 */
describe("detectDirection", () => {
  test.each([
    ["생활인구 적은 곳", "asc"],
    ["평균소득 낮은 동", "asc"],
    ["카드매출 적은 지역", "asc"],
    ["일자리 부족한 곳", "asc"],
    ["신용평점 하위 지역", "asc"],
    ["생활인구 많은 동", "desc"],
    ["평균소득 높은 동", "desc"],
    ["카드매출 상위", "desc"],
    ["생활인구", "desc"],
  ] as const)('"%s" → %s', (query, expected) => {
    expect(detectDirection(query)).toBe(expected);
  });

  test("둘 다 있으면 뒤에 오는 쪽을 따른다", () => {
    // "소득 낮고 소비 많은 곳"에서 정렬은 마지막 요구인 "많은"을 따른다.
    expect(detectDirection("소득 낮고 소비 많은 곳")).toBe("desc");
    expect(detectDirection("소비 많고 소득 낮은 곳")).toBe("asc");
  });
});

describe("resolveLayerQuery 방향", () => {
  test("낮은 질의는 asc를 싣는다", () => {
    expect(resolveLayerQuery("평균소득 낮은 동", CUBE_LAYERS)?.direction).toBe("asc");
    expect(resolveLayerQuery("평균소득 높은 동", CUBE_LAYERS)?.direction).toBe("desc");
  });
});

describe("buildLayerView 정렬", () => {
  const metric: MetricDef = {
    key: "v", label: "값", unit: "명", aggregation: "sum",
    formula: "f", limitation: "", triggers: ["값"],
  };
  const cube: LayerCube = {
    layerId: "t",
    adminLevel: "dong",
    referenceMonth: "2025-01",
    months: ["2025-01"],
    cells: [
      { code: "4811100000", name: "동1", point: { lat: 35, lng: 128 }, areaKm2: 1, series: { v: [10] } },
      { code: "4811200000", name: "동2", point: { lat: 35, lng: 128 }, areaKm2: 1, series: { v: [30] } },
      { code: "4811300000", name: "동3", point: { lat: 35, lng: 128 }, areaKm2: 1, series: { v: [20] } },
      { code: "4811400000", name: "동4", point: { lat: 35, lng: 128 }, areaKm2: 1, series: { v: [null] } },
    ],
  };

  test("기본은 큰 값부터", () => {
    const view = buildLayerView(cube, "v", "dong", 0, [metric]);
    expect(view.ranking.map((r) => r.value)).toEqual([30, 20, 10, null]);
  });

  test("asc는 작은 값부터", () => {
    const view = buildLayerView(cube, "v", "dong", 0, [metric], "asc");
    expect(view.ranking.map((r) => r.value)).toEqual([10, 20, 30, null]);
  });

  test("값 없는 지역은 방향과 무관하게 뒤에 둔다", () => {
    // 오름차순이라고 결측을 1위로 올리면 "가장 적은 곳"이 데이터 없는 곳이 된다.
    const view = buildLayerView(cube, "v", "dong", 0, [metric], "asc");
    expect(view.ranking[view.ranking.length - 1].value).toBeNull();
  });
});
