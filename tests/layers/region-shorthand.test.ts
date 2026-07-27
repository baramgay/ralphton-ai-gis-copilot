import { describe, expect, test } from "vitest";

import { KCB_CREDIT_LAYER, NH_CONSUMPTION_LAYER, SKT_LIVING_LAYER } from "@/lib/layers/catalog";
import { resolveLayerQuery } from "@/lib/layers/resolve-layer-query";

/*
 * "거창 카드매출 높은 곳"이 경남 전체 순위를 답하고 있었다(prod 실측). 축약형에서 떼는
 * 접미사가 "시"뿐이라, 경남 10개 군 전체가 축약으로 안 걸렸다. 시 8곳만 되고 군은 안 되는
 * 것을 사용자가 알 길이 없다 — 지역을 지정했는데 도 전체 답을 받는다.
 */
const LAYERS = [SKT_LIVING_LAYER, NH_CONSUMPTION_LAYER, KCB_CREDIT_LAYER];

const GUNS = ["의령", "함안", "창녕", "고성", "남해", "하동", "산청", "함양", "거창", "합천"];

describe("군 이름 축약", () => {
  test.each(GUNS)("'%s'만 써도 그 군으로 좁힌다", (gun) => {
    const match = resolveLayerQuery(`${gun} 카드매출 높은 곳`, LAYERS);
    expect(match?.regionFilters).toEqual([`${gun}군`]);
  });

  test.each(GUNS)("'%s군'이라 써도 같다", (gun) => {
    const match = resolveLayerQuery(`${gun}군 카드매출 높은 곳`, LAYERS);
    expect(match?.regionFilters).toEqual([`${gun}군`]);
  });

  test("시 축약은 그대로 동작한다", () => {
    expect(resolveLayerQuery("김해 소득 낮은 동", LAYERS)?.regionFilters).toEqual(["김해시"]);
    expect(resolveLayerQuery("창원 생활인구 많은 동", LAYERS)?.regionFilters).toEqual(["창원시"]);
  });

  test("지역을 안 적으면 좁히지 않는다", () => {
    expect(resolveLayerQuery("카드매출 높은 곳", LAYERS)?.regionFilters).toEqual([]);
  });
});
