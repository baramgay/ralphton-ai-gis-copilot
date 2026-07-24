import { describe, expect, it } from "vitest";
import { AnalysisIntentSchema } from "@/lib/analysis/intent-schema";

describe("AnalysisIntent layer slots", () => {
  it("accepts optional layer/metric/adminLevel", () => {
    const parsed = AnalysisIntentSchema.parse({
      tool: "getRegionDetails",
      layerId: "population",
      metricKey: "pop_total",
      adminLevel: "sgg",
      filters: {},
    });
    expect(parsed.adminLevel).toBe("sgg");
  });

  it("still accepts a legacy intent without layer slots", () => {
    const parsed = AnalysisIntentSchema.parse({ tool: "compareRegions", filters: {} });
    expect(parsed.layerId).toBeUndefined();
  });

  it("rejects an invalid adminLevel", () => {
    expect(() =>
      AnalysisIntentSchema.parse({ tool: "compareRegions", adminLevel: "block", filters: {} }),
    ).toThrow();
  });
});
