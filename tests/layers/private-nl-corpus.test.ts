import { describe, expect, test } from "vitest";

import {
  KCB_COMMUTE_LAYER,
  KCB_CREDIT_LAYER,
  KCB_MIGRATION_LAYER,
  NH_CONSUMPTION_LAYER,
  NH_DEMOGRAPHICS_LAYER,
  NH_HOURLY_LAYER,
  NH_INDUSTRY_LAYER,
  NH_STORETYPE_LAYER,
  SKT_DAYNIGHT_LAYER,
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
const PRIVATE_LAYERS = [
  SKT_LIVING_LAYER,
  SKT_MOBILITY_LAYER,
  SKT_DAYNIGHT_LAYER,
  NH_CONSUMPTION_LAYER,
  NH_DEMOGRAPHICS_LAYER,
  NH_HOURLY_LAYER,
  NH_INDUSTRY_LAYER,
  NH_STORETYPE_LAYER,
  KCB_CREDIT_LAYER,
  KCB_MIGRATION_LAYER,
  KCB_COMMUTE_LAYER,
];

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
  // SKT 주야간인구 — 생활인구(24시간 평균)와 구별되어야 한다
  ["주간인구 많은 동", "skt-daynight", "day_population"],
  ["낮 인구 많은 곳", "skt-daynight", "day_population"],
  ["주간 생활인구 높은 동", "skt-daynight", "day_population"],
  ["야간인구 많은 동", "skt-daynight", "night_population"],
  ["밤 인구 높은 곳", "skt-daynight", "night_population"],
  ["심야인구 많은 동", "skt-daynight", "night_population"],
  ["주야비 높은 동", "skt-daynight", "day_night_ratio"],
  ["주야간 비율 높은 곳", "skt-daynight", "day_night_ratio"],
  ["상권 성격 파악", "skt-daynight", "day_night_ratio"],
  // NH 카드소비
  ["카드매출 높은 동", "nh-consumption", "card_sales"],
  ["상권 매출 많은 곳", "nh-consumption", "card_sales"],
  ["소비가 활발한 지역", "nh-consumption", "card_sales"],
  ["카드소비 많은 동", "nh-consumption", "card_sales"],
  ["매출 높은 상권", "nh-consumption", "card_sales"],
  ["결제 건수 많은 동", "nh-consumption", "card_txns"],
  ["카드 이용건수 높은 곳", "nh-consumption", "card_txns"],
  // NH 소비주체 — 매출 총액(nh-consumption)과 구별되어야 한다
  ["청년 소비 비중 높은 동", "nh-demographics", "youth_share"],
  ["젊은 층 소비 많은 곳", "nh-demographics", "youth_share"],
  ["중장년 소비 많은 지역", "nh-demographics", "middle_share"],
  ["고령 소비 비중 높은 동", "nh-demographics", "senior_share"],
  ["여성 소비 비중 높은 곳", "nh-demographics", "female_share"],
  ["법인카드 비중 높은 동", "nh-demographics", "corporate_share"],
  // NH 시간대 소비 — SKT 주야간인구(사람)와 구별되어야 한다
  ["주간 매출 높은 동", "nh-hourly", "day_sales"],
  ["낮 매출 많은 곳", "nh-hourly", "day_sales"],
  ["야간 매출 높은 동", "nh-hourly", "night_sales"],
  ["심야 매출 높은 지역", "nh-hourly", "night_sales"],
  ["야간 상권 발달한 동", "nh-hourly", "night_share"],
  ["야간 소비비중 높은 곳", "nh-hourly", "night_share"],
  // NH 업종구성 — 매출 총액·소비주체와 구별되어야 한다
  ["음식점 비중 높은 동", "nh-industry", "food_share"],
  ["외식 상권 발달한 곳", "nh-industry", "food_share"],
  ["도소매 비중 높은 동", "nh-industry", "retail_share"],
  ["의료 소비 비중 높은 동", "nh-industry", "health_share"],
  ["여가 소비 비중 높은 동", "nh-industry", "leisure_share"],
  ["학원 소비 많은 동", "nh-industry", "education_share"],
  // NH 생활업종(소분류) — 업종구성(대분류)과 구별되어야 한다
  ["카페 상권 발달한 동", "nh-storetype", "cafe_share"],
  ["커피 소비 많은 곳", "nh-storetype", "cafe_share"],
  ["유흥 상권 발달한 동", "nh-storetype", "pub_share"],
  ["편의점 비중 높은 동", "nh-storetype", "grocery_share"],
  ["주유소 비중 높은 동", "nh-storetype", "fuel_share"],
  ["약국 비중 높은 곳", "nh-storetype", "medical_store_share"],
  ["식당 비중 높은 동", "nh-storetype", "restaurant_share"],
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
  // KCB 거주이동 — SKT 유입/유출(일시 체류)과 구별되어야 한다
  ["전입 많은 동", "kcb-migration", "move_in"],
  ["전입인구 많은 곳", "kcb-migration", "move_in"],
  ["이사 온 사람 많은 동", "kcb-migration", "move_in"],
  ["전출 많은 지역", "kcb-migration", "move_out_sgg"],
  ["전출인구 높은 곳", "kcb-migration", "move_out_sgg"],
  // KCB 통근 — 거주이동(주소 이전)과 구별되어야 한다
  ["일자리 많은 동", "kcb-commute", "jobs_in"],
  ["종사자 많은 곳", "kcb-commute", "jobs_in"],
  ["일자리 배율 높은 동", "kcb-commute", "job_ratio"],
  ["베드타운 성격 강한 동", "kcb-commute", "job_ratio"],
  ["관외 통근율 높은 동", "kcb-commute", "outbound_ratio"],
  ["타지 통근 많은 곳", "kcb-commute", "outbound_ratio"],
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
