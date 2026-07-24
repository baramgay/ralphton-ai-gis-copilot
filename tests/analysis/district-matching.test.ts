import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { AnalysisIntentSchema } from "@/lib/analysis/intent-schema";
import { extractQuerySignals } from "@/lib/analysis/query-signals";
import { getRegionDetails } from "@/lib/analysis/tool-registry";
import { DemoSnapshotSchema } from "@/lib/domain/schemas";

/**
 * Regression test for the 창원(Changwon) region-matching bug: NL queries about
 * Changwon districts resolved to zero regions because query-catalog-meta.ts
 * defines district labels/aliases with a space ("창원시 의창구") while the real
 * snapshot data has no space ("경상남도 창원시의창구 동읍"). regionMatches() in
 * tool-registry.ts did a plain, whitespace-sensitive `includes` check, so the
 * space-form district token never matched ~55/305 dongs (18% of all regions,
 * the largest city in the dataset).
 *
 * This test loads the REAL snapshot fixture and drives the actual app path:
 * extractQuerySignals() (the same district-token extractor query-rules.ts
 * uses to build AnalysisIntent.filters.regions) -> getRegionDetails() (which
 * calls scopedRegions()/regionMatches() internally, the exact code that had
 * the whitespace bug).
 */
const snapshotPath = path.join(process.cwd(), "public", "data", "demo-snapshot.json");
const snapshot = DemoSnapshotSchema.parse(JSON.parse(readFileSync(snapshotPath, "utf8")));

function resolvedRegionCountFor(query: string): { token: string | undefined; matches: number } {
  const signals = extractQuerySignals(query);
  const token = signals.districts[0];

  const intent = AnalysisIntentSchema.parse({
    tool: "getRegionDetails",
    filters: token ? { regions: [token] } : {},
  });

  const result = getRegionDetails(intent, snapshot);
  return { token, matches: result.selectedRegion ? 1 : 0 };
}

describe("district matching against real snapshot data", () => {
  test.each([
    // Bare "창원"/"창원시" now scopes to the whole city (all 5 자치구), not just 의창구.
    ["창원 의료 취약 어디?", "창원시"],
    ["의창구 인구", "창원시 의창구"],
    ["마산 세대", "창원시 마산합포구"],
  ])("%s resolves the %s token to at least one real region", (query, expectedToken) => {
    const { token, matches } = resolvedRegionCountFor(query);
    expect(token).toBe(expectedToken);
    expect(matches).toBeGreaterThanOrEqual(1);
  });

  test("bare 창원 scopes across all 5 자치구 (city-wide), more than any single 자치구", () => {
    const signals = extractQuerySignals("창원 인구");
    expect(signals.districts[0]).toBe("창원시");

    const cityWide = snapshot.regions.filter((region) =>
      region.adm_nm.replace(/\s+/g, "").includes("창원시"),
    ).length;
    const uichangOnly = snapshot.regions.filter((region) =>
      region.adm_nm.replace(/\s+/g, "").includes("창원시의창구"),
    ).length;

    expect(cityWide).toBeGreaterThan(uichangOnly);
    expect(uichangOnly).toBeGreaterThan(0);
  });

  test("non-Changwon control: 김해 고령 밀집? still resolves", () => {
    const { token, matches } = resolvedRegionCountFor("김해 고령 밀집?");
    expect(token).toBe("김해시");
    expect(matches).toBeGreaterThanOrEqual(1);
  });
});
