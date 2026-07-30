import { describe, expect, test } from "vitest";

import { extractQuerySignals } from "@/lib/analysis/query-signals";

describe("extractQuerySignals", () => {
  test("maps colloquial district aliases", () => {
    const signals = extractQuerySignals("김해 근처 병원");
    expect(signals.districts).toContain("김해시");
    expect(signals.spatial.has("nearby")).toBe(true);
    expect(signals.metrics.has("medical")).toBe(true);
  });

  test("detects compare with vs", () => {
    const signals = extractQuerySignals("창원 vs 김해");
    expect(signals.districts).toEqual(expect.arrayContaining(["창원시", "김해시"]));
    expect(signals.spatial.has("compare")).toBe(true);
  });

  test("parses colloquial radius", () => {
    const signals = extractQuerySignals("2키로 안 병원");
    expect(signals.radiusKm).toBe(2);
    expect(signals.spatial.has("radius")).toBe(true);
  });

  test("picks dental facility type", () => {
    const signals = extractQuerySignals("치과 어디 있어");
    expect(signals.facilityTypes).toContain("치과의원");
  });

  /*
   * NEGATED_DIRECTIONS(query-catalog-meta.ts)는 "커지"·"많아지"·"하락"·"떨어지"·"작아지"·
   * "적어지"를 이미 방향 낱말로 다루는데, 이 목록엔 없어 기존 추세 도구(총인구·고령비율
   * 증가/감소)를 조용히 못 타고 수준 순위로 답하고 있었다(prod 실측, 4차 리포트).
   */
  test.each([
    ["총인구 커지는 동", "growth"],
    ["출생 많아지는 동", "growth"],
    ["고령비율 하락하는 동", "decline"],
    ["카드매출 떨어지는 동", "decline"],
    ["총인구 작아지는 동", "decline"],
    ["소득 적어지는 곳", "decline"],
  ] as const)("detects %s as %s", (text, metric) => {
    const signals = extractQuerySignals(text);
    expect(signals.metrics.has(metric)).toBe(true);
  });
});
