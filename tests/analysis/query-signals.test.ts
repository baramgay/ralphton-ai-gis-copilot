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
    expect(signals.districts).toEqual(expect.arrayContaining(["창원시 의창구", "김해시"]));
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
});
