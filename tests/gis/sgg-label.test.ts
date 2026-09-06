import { describe, expect, test } from "vitest";

import { sggCodeOf, sggLabelOf, sggLabelPoints } from "@/lib/gis/sgg-label";

describe("sggLabelOf", () => {
  test("구가 있는 시는 구까지 남긴다", () => {
    expect(sggLabelOf("경상남도 창원시 의창구 동읍")).toBe("창원시 의창구");
  });

  test("일반 시는 시 이름만 남긴다", () => {
    expect(sggLabelOf("경상남도 김해시 내외동")).toBe("김해시");
  });
});

describe("sggLabelPoints", () => {
  test("같은 시군구 행정동을 한 점으로 접는다", () => {
    const points = sggLabelPoints([
      {
        adm_cd2: "4812125000",
        adm_nm: "경상남도 창원시 의창구 동읍",
        representativePoint: { lat: 35.1, lng: 129.0 },
      },
      {
        adm_cd2: "4812125300",
        adm_nm: "경상남도 창원시 의창구 북면",
        representativePoint: { lat: 35.3, lng: 129.2 },
      },
    ]);
    expect(points).toHaveLength(1);
    expect(points[0]?.code).toBe(sggCodeOf("4812125000"));
    expect(points[0]?.name).toBe("창원시 의창구");
    expect(points[0]?.lat).toBeCloseTo(35.2);
    expect(points[0]?.lng).toBeCloseTo(129.1);
  });
});
