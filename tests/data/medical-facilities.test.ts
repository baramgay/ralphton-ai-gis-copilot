import { describe, expect, it } from "vitest";

import {
  buildMedicalInstitutionsUrl,
  facilitiesFromMedicalRows,
  mapMedicalRowToFacility,
  normalizeFacilityTypeLabel,
} from "@/lib/data/medical-facilities";
import type { AssignableRegion } from "@/lib/data/region-assignment";

const region: AssignableRegion = {
  adm_cd2: "4812125000",
  adm_nm: "경상남도 창원시 의창구 동읍",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [129.03, 35.09],
        [129.05, 35.09],
        [129.05, 35.11],
        [129.03, 35.11],
        [129.03, 35.09],
      ],
    ],
  },
};

describe("medical facilities adapter", () => {
  it("builds the medical institutions endpoint", () => {
    const url = new URL(
      buildMedicalInstitutionsUrl({
        serviceKey: "fixture+key",
        pageNo: 2,
        numOfRows: 100,
      }),
    );

    expect(url.hostname).toBe("apis.data.go.kr");
    expect(url.pathname).toBe("/6260000/MedicInstitService/MedicalInstitInfo");
    expect(url.searchParams.get("pageNo")).toBe("2");
    expect(url.searchParams.get("resultType")).toBe("json");
  });

  it("normalizes facility type labels", () => {
    expect(normalizeFacilityTypeLabel("종합병원")).toBe("종합병원");
    expect(normalizeFacilityTypeLabel("치과의원 일반")).toBe("치과의원");
    expect(normalizeFacilityTypeLabel("알 수 없음")).toBeNull();
  });

  it("maps a medical row inside a boundary", () => {
    const facility = mapMedicalRowToFacility(
      {
        yadmNm: "중앙의원",
        clCdNm: "의원",
        YPos: 35.1,
        XPos: 129.04,
        ykiho: "abc",
        addr: "경남 창원시",
      },
      [region],
      0,
    );

    expect(facility).toMatchObject({
      id: "abc",
      name: "중앙의원",
      type: "의원",
      adm_cd2: "4812125000",
    });
  });

  it("deduplicates facilities by id", () => {
    const facilities = facilitiesFromMedicalRows(
      [
        { yadmNm: "A", clCdNm: "의원", YPos: 35.1, XPos: 129.04, ykiho: "same" },
        { yadmNm: "B", clCdNm: "의원", YPos: 35.1, XPos: 129.04, ykiho: "same" },
      ],
      [region],
    );

    expect(facilities).toHaveLength(1);
  });
});
