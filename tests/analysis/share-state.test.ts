import { describe, expect, test } from "vitest";

import {
  applyFollowUpMerge,
  buildShareSearch,
  isFollowUpQuery,
  parseShareState,
  resolveSharedRegionCode,
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
      region: "4812125000",
      radius: 3,
      markers: "selected",
    });
    const parsed = parseShareState(search.startsWith("?") ? search.slice(1) : search);
    expect(parsed.tool).toBe("rankHospitalScarcity");
    expect(parsed.region).toBe("4812125000");
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
      "4812125000",
      "경상남도 창원시 의창구 동읍",
    );
    expect(merged.filters.regions?.[0]).toContain("동읍");
  });

  test("follow-up radius override", () => {
    const merged = applyFollowUpMerge(
      "반경 3km로",
      baseIntent,
      baseIntent,
      "4812125000",
      "중앙동",
    );
    expect(merged.filters.radiusKm).toBe(3);
  });
});

describe("resolveSharedRegionCode", () => {
  const regions = [
    { adm_cd2: "4812125000", adm_nm: "경상남도 창원시의창구 동읍" },
    { adm_cd2: "4817025000", adm_nm: "경상남도 진주시 문산읍" },
  ];

  test("행정동 코드·이름을 그대로 푼다", () => {
    expect(resolveSharedRegionCode(regions, "4812125000")).toBe("4812125000");
    expect(resolveSharedRegionCode(regions, "문산읍")).toBe("4817025000");
  });

  test("시군구 5자리는 소속 동 확인 뒤 그대로 쓴다", () => {
    // 대표 동으로 바꾸면 공유받은 사람의 지도 강조와 선택이 어긋난다.
    expect(resolveSharedRegionCode(regions, "48170")).toBe("48170");
  });

  test("없는 코드·빈 값은 버린다", () => {
    expect(resolveSharedRegionCode(regions, "99999")).toBeNull();
    expect(resolveSharedRegionCode(regions, undefined)).toBeNull();
    expect(resolveSharedRegionCode(regions, "")).toBeNull();
  });
});
