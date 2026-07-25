import { describe, expect, test } from "vitest";

import {
  KCB_CREDIT_LAYER,
  NH_CONSUMPTION_LAYER,
  POPULATION_LAYER,
  SKT_LIVING_LAYER,
  SKT_MOBILITY_LAYER,
} from "@/lib/layers/catalog";
import { resolveCrossQuery } from "@/lib/layers/resolve-cross-query";

// All cube-backed layers are cross-analysis candidates (public population + private).
const CUBE_LAYERS = [
  POPULATION_LAYER,
  SKT_LIVING_LAYER,
  SKT_MOBILITY_LAYER,
  NH_CONSUMPTION_LAYER,
  KCB_CREDIT_LAYER,
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

  test("returns null without a cross connective", () => {
    expect(resolveCrossQuery("카드매출 높은 동", CUBE_LAYERS)).toBeNull();
    expect(resolveCrossQuery("생활인구 많은 동", CUBE_LAYERS)).toBeNull();
  });

  test("returns null when fewer than two distinct metrics are found", () => {
    // "대비" present but only one metric resolvable
    expect(resolveCrossQuery("카드매출 대비 높은 곳", CUBE_LAYERS)).toBeNull();
  });

  test("detects 시군구 admin level", () => {
    expect(resolveCrossQuery("시군구별 생활인구 대비 소득", CUBE_LAYERS)?.adminLevel).toBe("sgg");
  });
});
