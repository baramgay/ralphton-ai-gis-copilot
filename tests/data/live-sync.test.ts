import { describe, expect, it, vi } from "vitest";

import { runLiveSync } from "@/lib/data/live-sync";
import type { AnalysisSnapshot } from "@/lib/domain/schemas";

const baseSnapshot: AnalysisSnapshot = {
  mode: "demo",
  referenceMonth: "2026-06",
  months: [
    "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
  ],
  regions: [
    {
      adm_cd2: "2611051000",
      adm_nm: "부산광역시 중구 중앙동",
      representativePoint: { lat: 35.1, lng: 129.04 },
      areaSquareKm: 1,
      months: [
        "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
        "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      ],
      population: Array(13).fill(1000),
      households: Array(13).fill(400),
      populationDensity: Array(13).fill(1000),
      youthPopulation: Array(13).fill(100),
      workingAgePopulation: Array(13).fill(700),
      elderlyPopulation: Array(13).fill(200),
      onePersonHouseholds: Array(13).fill(50),
      births: Array(13).fill(1),
      deaths: Array(13).fill(1),
      naturalChange: Array(13).fill(0),
    },
  ],
  facilities: [
    {
      id: "demo-1",
      name: "데모의원",
      type: "의원",
      adm_cd2: "2611051000",
      adm_nm: "부산광역시 중구 중앙동",
      lat: 35.1,
      lng: 129.04,
      specialties: null,
      hours: null,
    },
  ],
  sourceNotes: ["demo"],
};

const hiraXml = `<?xml version="1.0" encoding="UTF-8"?>
<response>
  <header><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></header>
  <body>
    <items>
      <item>
        <yadmNm>실데이터의원</yadmNm>
        <clCd>31</clCd>
        <clCdNm>의원</clCdNm>
        <YPos>35.1</YPos>
        <XPos>129.04</XPos>
        <ykiho>live-1</ykiho>
        <addr>부산광역시 중구</addr>
      </item>
    </items>
    <numOfRows>1</numOfRows>
    <pageNo>1</pageNo>
    <totalCount>1</totalCount>
  </body>
</response>`;

describe("runLiveSync", () => {
  it("keeps demo snapshot when service key is absent", async () => {
    const result = await runLiveSync({
      serviceKey: "",
      hiraServiceKey: "",
      loadDemoSnapshot: async () => baseSnapshot,
      upsert: async () => false,
    });

    expect(result.status).toBe("demo-only");
    expect(result.snapshot.mode).toBe("demo");
    expect(result.facilityCount).toBe(1);
    expect(result.published).toBe(false);
  });

  it("replaces facilities when HIRA hospital rows map into boundaries", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("hospInfoServicev2") || url.includes("getHospBasisList")) {
        return {
          ok: true,
          text: async (): Promise<string> => hiraXml,
        };
      }
      // population or other
      return {
        ok: true,
        json: async () => ({
          response: {
            header: { resultCode: "00" },
            body: { items: { item: [] }, totalCount: 0, pageNo: 1, numOfRows: 0 },
          },
        }),
        text: async (): Promise<string> => "",
      };
    });

    const result = await runLiveSync({
      serviceKey: "fixture-key",
      hiraServiceKey: "fixture-hira-key",
      boundaryVersion: "20260701",
      publish: true,
      includePopulation: false,
      fetch: fetch as unknown as typeof globalThis.fetch,
      loadDemoSnapshot: async () => baseSnapshot,
      loadBoundary: async () => [
        {
          adm_cd2: "2611051000",
          adm_nm: "부산광역시 중구 중앙동",
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
        },
      ],
      upsert: async () => true,
    });

    expect(result.status).toBe("facilities-live");
    expect(result.snapshot.mode).toBe("live");
    expect(result.snapshot.facilities[0]?.name).toBe("실데이터의원");
    expect(result.published).toBe(true);
  });
});
