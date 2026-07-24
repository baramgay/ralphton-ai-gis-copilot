import { describe, expect, test } from "vitest";

import {
  KCB_CREDIT_LAYER,
  MEDICAL_LAYER,
  NH_CONSUMPTION_LAYER,
  POPULATION_LAYER,
  SKT_LIVING_LAYER,
  SKT_MOBILITY_LAYER,
} from "@/lib/layers/catalog";
import { detectAdminLevel, resolveLayerQuery } from "@/lib/layers/resolve-layer-query";

// Private (non-공공) layers that natural language may switch to.
const PRIVATE_LAYERS = [SKT_LIVING_LAYER, SKT_MOBILITY_LAYER, NH_CONSUMPTION_LAYER, KCB_CREDIT_LAYER];
// Full set incl. public — used to prove longest-trigger precedence.
const ALL_LAYERS = [POPULATION_LAYER, SKT_LIVING_LAYER, MEDICAL_LAYER];

describe("resolveLayerQuery", () => {
  test("routes 생활인구 to the SKT living layer, not public population", () => {
    const match = resolveLayerQuery("생활인구 많은 동", PRIVATE_LAYERS);
    expect(match?.layerId).toBe("skt-living");
    expect(match?.metricKey).toBe("living_total");
    expect(match?.provider).toBe("SKT");
  });

  test.each(["유동인구 많은 곳", "활동인구 어디가 높아"])(
    "recognizes SKT synonym %s",
    (query) => {
      expect(resolveLayerQuery(query, PRIVATE_LAYERS)?.layerId).toBe("skt-living");
    },
  );

  test("longest trigger wins: 생활인구 beats generic 인구 even with public layer present", () => {
    // Even if the public population layer is in the candidate set, the more specific
    // SKT trigger "생활인구" (len 4) outranks the public "인구" (len 2).
    const match = resolveLayerQuery("생활인구 고령 비중", ALL_LAYERS);
    expect(match?.provider).toBe("SKT");
  });

  test.each([
    ["유입인구 많은 동", "skt-mobility", "inflow_total"],
    ["유출인구 높은 곳", "skt-mobility", "outflow_total"],
    ["순유입 큰 지역", "skt-mobility", "net_flow"],
  ])("routes mobility query %s", (query, layerId, metricKey) => {
    const match = resolveLayerQuery(query, PRIVATE_LAYERS);
    expect(match?.layerId).toBe(layerId);
    expect(match?.metricKey).toBe(metricKey);
    expect(match?.provider).toBe("SKT");
  });

  test("생활인구 and 유입인구 stay on distinct SKT layers", () => {
    expect(resolveLayerQuery("생활인구 많은 동", PRIVATE_LAYERS)?.layerId).toBe("skt-living");
    expect(resolveLayerQuery("유입인구 많은 동", PRIVATE_LAYERS)?.layerId).toBe("skt-mobility");
  });

  test.each([
    ["카드매출 높은 동", "nh-consumption", "card_sales", "NH"],
    ["상권매출 많은 곳", "nh-consumption", "card_sales", "NH"],
    ["평균소득 높은 지역", "kcb-credit", "avg_income", "KCB"],
    ["소득 높은 동", "kcb-credit", "avg_income", "KCB"],
    ["신용평점 높은 곳", "kcb-credit", "credit_score", "KCB"],
    ["대출 많은 동", "kcb-credit", "loan_ratio", "KCB"],
    ["연체율 높은 지역", "kcb-credit", "delinquency_ratio", "KCB"],
    ["하이엔드 비율 높은 동", "kcb-credit", "highend_ratio", "KCB"],
  ])("routes NH/KCB query %s → %s", (query, layerId, metricKey, provider) => {
    const match = resolveLayerQuery(query, PRIVATE_LAYERS);
    expect(match?.layerId).toBe(layerId);
    expect(match?.metricKey).toBe(metricKey);
    expect(match?.provider).toBe(provider);
  });

  test("all four private providers are routable and distinct", () => {
    expect(resolveLayerQuery("생활인구", PRIVATE_LAYERS)?.provider).toBe("SKT");
    expect(resolveLayerQuery("유입인구", PRIVATE_LAYERS)?.provider).toBe("SKT");
    expect(resolveLayerQuery("카드매출", PRIVATE_LAYERS)?.provider).toBe("NH");
    expect(resolveLayerQuery("평균소득", PRIVATE_LAYERS)?.provider).toBe("KCB");
  });

  test("does not match a bare public-population query when only private layers are candidates", () => {
    // "인구 많은 동" must fall through (return null) so the public tool-registry handles it.
    expect(resolveLayerQuery("인구 많은 동", PRIVATE_LAYERS)).toBeNull();
    expect(resolveLayerQuery("사망자 많은 곳", PRIVATE_LAYERS)).toBeNull();
  });

  test("returns null when no trigger matches", () => {
    expect(resolveLayerQuery("김해 근처 병원", PRIVATE_LAYERS)).toBeNull();
    expect(resolveLayerQuery("", PRIVATE_LAYERS)).toBeNull();
  });

  test("detects 시군구 admin level from the query", () => {
    expect(resolveLayerQuery("시군구별 생활인구", PRIVATE_LAYERS)?.adminLevel).toBe("sgg");
    expect(resolveLayerQuery("생활인구 많은 동", PRIVATE_LAYERS)?.adminLevel).toBe("dong");
  });

  test("detectAdminLevel honors fallback and sgg cues", () => {
    expect(detectAdminLevel("생활인구", "dong")).toBe("dong");
    expect(detectAdminLevel("구별 생활인구", "dong")).toBe("sgg");
    expect(detectAdminLevel("생활인구", "sgg")).toBe("sgg");
  });
});
