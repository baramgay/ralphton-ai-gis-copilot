import { describe, expect, it } from "vitest";

import {
  mapHiraClinicType,
  parseHiraXmlItems,
  mapHiraRowToFacility,
} from "@/lib/data/hira-hospitals";
import type { AssignableRegion } from "@/lib/data/region-assignment";

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
  <body>
    <items>
      <item>
        <yadmNm>테스트병원</yadmNm>
        <clCd>11</clCd>
        <clCdNm>종합병원</clCdNm>
        <XPos>129.0756</XPos>
        <YPos>35.1796</YPos>
        <addr>경상남도 창원시 의창구 테스트로 1</addr>
        <telno>055-000-0000</telno>
        <ykiho>A123</ykiho>
      </item>
    </items>
    <numOfRows>1</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>1</totalCount>
  </body>
</response>`;

describe("hira-hospitals", () => {
  it("parses HIRA XML items", () => {
    const page = parseHiraXmlItems(sampleXml);
    expect(page.resultCode).toBe("00");
    expect(page.totalCount).toBe(1);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.yadmNm).toBe("테스트병원");
    expect(page.items[0]?.XPos).toBe("129.0756");
  });

  it("maps clinic types", () => {
    expect(mapHiraClinicType("상급종합병원", "01")).toBe("종합병원");
    expect(mapHiraClinicType("종합병원", "11")).toBe("종합병원");
    expect(mapHiraClinicType("요양병원", "28")).toBe("요양병원");
    expect(mapHiraClinicType("치과의원", "51")).toBe("치과의원");
    expect(mapHiraClinicType("한의원", "93")).toBe("한의원");
    expect(mapHiraClinicType("보건소", "71")).toBe("보건소");
  });

  it("maps row to facility when inside a region", () => {
    // Minimal polygon around Changwon Uichang-gu point
    const regions: AssignableRegion[] = [
      {
        adm_cd2: "4812125000",
        adm_nm: "경상남도 창원시 의창구 동읍",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [129.0, 35.1],
              [129.2, 35.1],
              [129.2, 35.3],
              [129.0, 35.3],
              [129.0, 35.1],
            ],
          ],
        },
      },
    ];
    const facility = mapHiraRowToFacility(
      {
        yadmNm: "테스트병원",
        clCdNm: "종합병원",
        clCd: "11",
        XPos: "129.0756",
        YPos: "35.1796",
        addr: "경남",
        ykiho: "A123",
      },
      regions,
      0,
    );
    expect(facility?.id).toBe("A123");
    expect(facility?.type).toBe("종합병원");
    expect(facility?.adm_cd2).toBe("4812125000");
  });
});
