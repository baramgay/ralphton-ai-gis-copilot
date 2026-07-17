import { describe, expect, test } from "vitest";

import { extractQuerySignals } from "@/lib/analysis/query-signals";

describe("extractQuerySignals", () => {
  test("maps colloquial district aliases", () => {
    const signals = extractQuerySignals("해운대 근처 병원");
    expect(signals.districts).toContain("해운대구");
    expect(signals.spatial.has("nearby")).toBe(true);
    expect(signals.metrics.has("medical")).toBe(true);
  });

  test("detects compare with vs", () => {
    const signals = extractQuerySignals("해운대 vs 기장");
    expect(signals.districts).toEqual(expect.arrayContaining(["해운대구", "기장군"]));
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
