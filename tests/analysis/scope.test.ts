import { describe, expect, it } from "vitest";

import {
  applySidoScopeToRegions,
  countBySido,
  filterBySidoScope,
  matchesSidoScope,
  sidoBadge,
  stripSido,
} from "@/lib/analysis/scope";

describe("analysis scope", () => {
  it("matches sido prefixes", () => {
    expect(matchesSidoScope("부산광역시 해운대구 우동", "busan")).toBe(true);
    expect(matchesSidoScope("경상남도 창원시 의창구", "busan")).toBe(false);
    expect(matchesSidoScope("경상남도 김해시", "gyeongnam")).toBe(true);
    expect(matchesSidoScope("부산광역시 중구", "all")).toBe(true);
  });

  it("strips sido and badges", () => {
    expect(stripSido("부산광역시 해운대구 우동")).toBe("해운대구 우동");
    expect(stripSido("경상남도 진주시 중앙동")).toBe("진주시 중앙동");
    expect(sidoBadge("부산광역시 중구")).toBe("부산");
    expect(sidoBadge("경상남도 양산시")).toBe("경남");
  });

  it("counts and filters by sido", () => {
    const items = [
      { adm_nm: "부산광역시 중구 중앙동" },
      { adm_nm: "부산광역시 해운대구 우동" },
      { adm_nm: "경상남도 창원시 의창구" },
    ];
    expect(countBySido(items)).toEqual({ busan: 2, gyeongnam: 1, other: 0 });
    expect(filterBySidoScope(items, "gyeongnam")).toHaveLength(1);
  });

  it("applies sido token only when regions empty", () => {
    expect(applySidoScopeToRegions(undefined, "busan")).toEqual(["부산광역시"]);
    expect(applySidoScopeToRegions(["해운대구"], "busan")).toEqual(["해운대구"]);
    expect(applySidoScopeToRegions(undefined, "all")).toBeUndefined();
  });
});
