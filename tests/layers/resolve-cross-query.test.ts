import { describe, expect, test } from "vitest";

import {
  KCB_CREDIT_LAYER,
  KCB_MIGRATION_LAYER,
  NH_CONSUMPTION_LAYER,
  NH_DEMOGRAPHICS_LAYER,
  NH_HOURLY_LAYER,
  POPULATION_LAYER,
  SKT_DAYNIGHT_LAYER,
  SKT_LIVING_LAYER,
  SKT_MOBILITY_LAYER,
} from "@/lib/layers/catalog";
import { resolveCrossQuery } from "@/lib/layers/resolve-cross-query";

// All cube-backed layers are cross-analysis candidates (public population + private).
const CUBE_LAYERS = [
  POPULATION_LAYER,
  SKT_LIVING_LAYER,
  SKT_MOBILITY_LAYER,
  SKT_DAYNIGHT_LAYER,
  NH_CONSUMPTION_LAYER,
  NH_DEMOGRAPHICS_LAYER,
  NH_HOURLY_LAYER,
  KCB_CREDIT_LAYER,
  KCB_MIGRATION_LAYER,
];

describe("resolveCrossQuery", () => {
  test("생활인구 대비 카드매출 → gap, A=생활인구 B=카드매출 (order preserved)", () => {
    const match = resolveCrossQuery("생활인구 대비 카드매출 낮은 동", CUBE_LAYERS);
    expect(match?.mode).toBe("gap");
    expect(match?.a.layerId).toBe("skt-living");
    expect(match?.a.metricKey).toBe("living_total");
    expect(match?.b.layerId).toBe("nh-consumption");
    expect(match?.b.metricKey).toBe("card_sales");
  });

  test("longest-trigger: 생활인구(not 인구) is operand A", () => {
    const match = resolveCrossQuery("생활인구 대비 소득", CUBE_LAYERS);
    expect(match?.a.layerId).toBe("skt-living");
    expect(match?.b.layerId).toBe("kcb-credit");
    expect(match?.b.metricKey).toBe("avg_income");
  });

  test("인구 대비 카드매출 → population vs NH (per-capita spending gap)", () => {
    const match = resolveCrossQuery("인구 대비 카드매출", CUBE_LAYERS);
    expect(match?.a.layerId).toBe("population");
    expect(match?.a.metricKey).toBe("pop_total");
    expect(match?.b.layerId).toBe("nh-consumption");
  });

  test("both-mode connective", () => {
    const match = resolveCrossQuery("소득과 카드매출 모두 높은 동", CUBE_LAYERS);
    expect(match?.mode).toBe("both");
    const layers = [match?.a.layerId, match?.b.layerId].sort();
    expect(layers).toEqual(["kcb-credit", "nh-consumption"].sort());
  });

  test("infers gap from one-high-one-low contrast without a 대비 cue", () => {
    const match = resolveCrossQuery("생활인구 많고 소득 낮은 동", CUBE_LAYERS);
    expect(match?.mode).toBe("gap");
    expect(match?.a.layerId).toBe("skt-living");
    expect(match?.b.layerId).toBe("kcb-credit");
  });

  test("infers both from two same-direction metrics joined by a conjunction", () => {
    const match = resolveCrossQuery("소득 높고 신용도 좋은 동", CUBE_LAYERS);
    expect(match?.mode).toBe("both");
    expect(match?.a.layerId).toBe("kcb-credit");
    expect(match?.b.layerId).toBe("kcb-credit");
    expect(new Set([match?.a.metricKey, match?.b.metricKey])).toEqual(
      new Set(["avg_income", "credit_score"]),
    );
  });

  test("returns null without a cross connective or contrast", () => {
    expect(resolveCrossQuery("카드매출 높은 동", CUBE_LAYERS)).toBeNull();
    expect(resolveCrossQuery("생활인구 많은 동", CUBE_LAYERS)).toBeNull();
    expect(resolveCrossQuery("평균소득 높은 지역", CUBE_LAYERS)).toBeNull();
    // overlapping triggers collapse to one metric → not a cross query
    expect(resolveCrossQuery("생활인구 고령 비중 높은 동", CUBE_LAYERS)).toBeNull();
  });

  test("returns null when fewer than two distinct metrics are found", () => {
    // "대비" present but only one metric resolvable
    expect(resolveCrossQuery("카드매출 대비 높은 곳", CUBE_LAYERS)).toBeNull();
  });

  test.each([
    ["주간인구 대비 카드매출 낮은 동", "skt-daynight", "nh-consumption"],
    ["야간인구 대비 소득 낮은 곳", "skt-daynight", "kcb-credit"],
    ["전입 대비 카드매출 낮은 동", "kcb-migration", "nh-consumption"],
    ["전입 많고 소득 낮은 동", "kcb-migration", "kcb-credit"],
    ["전입과 카드매출 모두 높은 동", "kcb-migration", "nh-consumption"],
  ])("cross-routes %s across the newer layers", (query, aLayer, bLayer) => {
    const match = resolveCrossQuery(query, CUBE_LAYERS);
    expect(match?.a.layerId).toBe(aLayer);
    expect(match?.b.layerId).toBe(bLayer);
  });

  test("every one-click preset query still resolves to a cross analysis", () => {
    // Mirrors CROSS_PRESETS in copilot-app.tsx. Presets run through this same resolver,
    // so a resolver rule change that breaks a preset must fail here.
    const PRESET_QUERIES = [
      "생활인구 대비 카드매출 낮은 동",
      "평균소득 대비 카드매출 낮은 동",
      "유입인구 대비 카드매출 낮은 동",
      "평균소득과 신용평점 모두 높은 동",
      "전입 대비 카드매출 낮은 동",
      "주간인구 대비 카드매출 낮은 동",
      "야간인구 대비 야간 매출 낮은 동",
    ];
    for (const query of PRESET_QUERIES) {
      const match = resolveCrossQuery(query, CUBE_LAYERS);
      expect(match, `preset "${query}" must resolve`).not.toBeNull();
      expect(match?.a.metricKey).not.toBe(match?.b.metricKey);
    }
  });

  test("detects 시군구 admin level", () => {
    expect(resolveCrossQuery("시군구별 생활인구 대비 소득", CUBE_LAYERS)?.adminLevel).toBe("sgg");
  });
});
