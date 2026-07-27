import { describe, expect, test } from "vitest";

import { KCB_CREDIT_LAYER, MEDICAL_LAYER, SKT_LIVING_LAYER } from "@/lib/layers/catalog";
import { resolveLayerQuery } from "@/lib/layers/resolve-layer-query";

/*
 * "의료도 부족하고 소비도 적은 곳"에서 의료 조건이 통째로 빠졌다(prod 실측). 트리거가
 * "의료 부족"처럼 두 낱말을 붙여 놓은 꼴인데, 사람은 그 사이에 조사를 넣어 쓴다.
 */
const LAYERS = [MEDICAL_LAYER, KCB_CREDIT_LAYER, SKT_LIVING_LAYER];

describe("트리거 사이의 조사", () => {
  test.each([
    "의료도 부족하고 소비도 적은 곳",
    "의료가 부족한 동",
    "의료는 부족한데 사람은 많은 곳",
    "의료 부족한 읍면동",
  ])("조사가 끼어도 의료취약지수로 간다: %s", (query) => {
    const match = resolveLayerQuery(query, LAYERS);
    expect(match?.layerId).toBe("medical");
    expect(match?.metricKey).toBe("vulnerability");
  });

  test("조사 틈은 두 글자까지 — 아무 말이나 건너뛰지 않는다", () => {
    // "의료 시설이 많은 지역의 부족한 점"에는 "의료 부족"이 없다.
    const match = resolveLayerQuery("의료 시설이 많은 지역의 부족한 점", LAYERS);
    expect(match?.metricKey).not.toBe("vulnerability");
  });

  test("기존 인접 매칭은 그대로다", () => {
    expect(resolveLayerQuery("의료취약지수 높은 동", LAYERS)?.metricKey).toBe("vulnerability");
    expect(resolveLayerQuery("생활인구 많은 동", LAYERS)?.metricKey).toBe("living_total");
  });
});
