import { describe, expect, test } from "vitest";

import {
  KCB_CREDIT_LAYER,
  NH_CONSUMPTION_LAYER,
  SKT_LIVING_LAYER,
  SKT_MOBILITY_LAYER,
} from "@/lib/layers/catalog";
import { resolveLayerQuery } from "@/lib/layers/resolve-layer-query";

/**
 * Natural-language coverage corpus for EVERY private-data metric (SKT 생활/이동,
 * NH 카드소비, KCB 소득·신용). Each private metric must be reachable by several
 * colloquial phrasings so the copilot can switch to the right layer/metric.
 * Add a phrasing here whenever a new private-data question should be supported.
 */
const PRIVATE_LAYERS = [SKT_LIVING_LAYER, SKT_MOBILITY_LAYER, NH_CONSUMPTION_LAYER, KCB_CREDIT_LAYER];

const CORPUS: Array<[query: string, layerId: string, metricKey: string]> = [
  // SKT 생활인구
  ["생활인구 많은 동", "skt-living", "living_total"],
  ["유동인구 높은 곳", "skt-living", "living_total"],
  ["활동인구 어디가 많아", "skt-living", "living_total"],
  ["실제 머무는 인구 많은 곳", "skt-living", "living_total"],
  ["체류인구 많은 동", "skt-living", "living_total"],
  ["생활인구 고령 비중 높은 동", "skt-living", "elderly_ratio"],
  // SKT 이동인구
  ["유입인구 많은 동", "skt-mobility", "inflow_total"],
  ["외지에서 많이 들어오는 곳", "skt-mobility", "inflow_total"],
  ["유출인구 많은 동", "skt-mobility", "outflow_total"],
  ["빠져나가는 인구 많은 곳", "skt-mobility", "outflow_total"],
  ["순유입 큰 지역", "skt-mobility", "net_flow"],
  ["순유입 인구 높은 동", "skt-mobility", "net_flow"],
  // NH 카드소비
  ["카드매출 높은 동", "nh-consumption", "card_sales"],
  ["상권 매출 많은 곳", "nh-consumption", "card_sales"],
  ["소비가 활발한 지역", "nh-consumption", "card_sales"],
  ["카드소비 많은 동", "nh-consumption", "card_sales"],
  ["매출 높은 상권", "nh-consumption", "card_sales"],
  ["결제 건수 많은 동", "nh-consumption", "card_txns"],
  ["카드 이용건수 높은 곳", "nh-consumption", "card_txns"],
  // KCB 소득·신용
  ["평균소득 높은 동", "kcb-credit", "avg_income"],
  ["소득 수준 높은 지역", "kcb-credit", "avg_income"],
  ["월소득 많은 곳", "kcb-credit", "avg_income"],
  ["부자 동네", "kcb-credit", "avg_income"],
  ["신용평점 높은 동", "kcb-credit", "credit_score"],
  ["신용점수 높은 곳", "kcb-credit", "credit_score"],
  ["신용도 좋은 지역", "kcb-credit", "credit_score"],
  ["1인 소비 높은 동", "kcb-credit", "card_spend"],
  ["인당 소비 많은 곳", "kcb-credit", "card_spend"],
  ["대출 많은 동", "kcb-credit", "loan_ratio"],
  ["대출 보유 많은 곳", "kcb-credit", "loan_ratio"],
  ["부채 많은 지역", "kcb-credit", "loan_ratio"],
  ["빚 많은 동네", "kcb-credit", "loan_ratio"],
  ["연체율 높은 동", "kcb-credit", "delinquency_ratio"],
  ["연체자 많은 곳", "kcb-credit", "delinquency_ratio"],
  ["하이엔드 비율 높은 동", "kcb-credit", "highend_ratio"],
  ["고소득층 많은 곳", "kcb-credit", "highend_ratio"],
  ["부유층 밀집 지역", "kcb-credit", "highend_ratio"],
];

describe("private-data NL coverage corpus", () => {
  test.each(CORPUS)('routes "%s" → %s / %s', (query, layerId, metricKey) => {
    const match = resolveLayerQuery(query, PRIVATE_LAYERS);
    expect(match).not.toBeNull();
    expect(match?.layerId).toBe(layerId);
    expect(match?.metricKey).toBe(metricKey);
  });

  test("every private metric has at least one corpus phrasing", () => {
    const covered = new Set(CORPUS.map(([, layerId, metricKey]) => `${layerId}/${metricKey}`));
    for (const layer of PRIVATE_LAYERS) {
      for (const metric of layer.metrics) {
        expect(covered.has(`${layer.id}/${metric.key}`)).toBe(true);
      }
    }
  });

  test("public-population and out-of-domain queries do not hijack a private layer", () => {
    expect(resolveLayerQuery("인구 많은 동", PRIVATE_LAYERS)).toBeNull();
    expect(resolveLayerQuery("사망자 많은 곳", PRIVATE_LAYERS)).toBeNull();
    expect(resolveLayerQuery("김해 근처 병원", PRIVATE_LAYERS)).toBeNull();
  });
});
