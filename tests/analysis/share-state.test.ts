import { describe, expect, test } from "vitest";

import {
  applyFollowUpMerge,
  buildShareSearch,
  isFollowUpQuery,
  parseShareState,
} from "@/lib/analysis/share-state";
import type { AnalysisIntent } from "@/lib/analysis/intent-schema";

const baseIntent: AnalysisIntent = {
  tool: "countFacilitiesWithinRadius",
  filters: { radiusKm: 2, limit: 10 },
};

describe("share-state", () => {
  test("round-trips query params", () => {
    const search = buildShareSearch({
      tool: "rankHospitalScarcity",
      region: "2611051000",
      radius: 3,
      markers: "selected",
    });
    const parsed = parseShareState(search.startsWith("?") ? search.slice(1) : search);
    expect(parsed.tool).toBe("rankHospitalScarcity");
    expect(parsed.region).toBe("2611051000");
    expect(parsed.radius).toBe(3);
    expect(parsed.markers).toBe("selected");
  });

  test("detects follow-up queries", () => {
    expect(isFollowUpQuery("이 동만 병원")).toBe(true);
    expect(isFollowUpQuery("반경 3km로")).toBe(true);
    expect(isFollowUpQuery("해운대 의료 취약")).toBe(false);
  });

  test("merges selected region into follow-up intent", () => {
    const merged = applyFollowUpMerge(
      "이 동만 자세히",
      { tool: "getRegionDetails", filters: {} },
      baseIntent,
      "2611051000",
      "부산광역시 중구 중앙동",
    );
    expect(merged.filters.regions?.[0]).toContain("중앙동");
  });

  test("follow-up radius override", () => {
    const merged = applyFollowUpMerge(
      "반경 3km로",
      baseIntent,
      baseIntent,
      "2611051000",
      "중앙동",
    );
    expect(merged.filters.radiusKm).toBe(3);
  });
});
