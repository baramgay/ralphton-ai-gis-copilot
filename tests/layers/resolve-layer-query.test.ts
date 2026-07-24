import { describe, expect, test } from "vitest";

import { MEDICAL_LAYER, POPULATION_LAYER, SKT_LIVING_LAYER } from "@/lib/layers/catalog";
import { detectAdminLevel, resolveLayerQuery } from "@/lib/layers/resolve-layer-query";

// Private (non-공공) layers that natural language may switch to.
const PRIVATE_LAYERS = [SKT_LIVING_LAYER];
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
