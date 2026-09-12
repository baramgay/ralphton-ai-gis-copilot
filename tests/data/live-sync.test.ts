import { describe, expect, it, vi } from "vitest";

import { rewriteSyntheticNote, runLiveSync } from "@/lib/data/live-sync";
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
      adm_cd2: "4812125000",
      adm_nm: "경상남도 창원시 의창구 동읍",
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
      adm_cd2: "4812125000",
      adm_nm: "경상남도 창원시 의창구 동읍",
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
        <addr>경상남도 창원시 의창구</addr>
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

/*
 * 각주는 화면 배지(`populationIsLive`)가 읽는 정본이다. 남은 합성 항목을 정확히 말하지
 * 않으면 배지가 거짓말을 한다 — `mode: "live"`인데 인구가 합성이던 사건이 그랬다.
 * 단계 실행에서는 인구만 실측인 중간 상태가 실제로 존재하므로 네 경우를 모두 잠근다.
 */
describe("rewriteSyntheticNote", () => {
  const SYNTHETIC = "인구·세대·출생·사망 값은 합성값이며 실제 주민등록 통계가 아닙니다.";

  it("아무것도 실측이 아니면 그대로 둔다", () => {
    expect(rewriteSyntheticNote(SYNTHETIC, { population: false, vitals: false })).toBe(SYNTHETIC);
  });

  it("인구만 실측이면 출생·사망만 합성이라 말한다", () => {
    expect(rewriteSyntheticNote(SYNTHETIC, { population: true, vitals: false })).toBe(
      "출생·사망 값은 합성값이며 실제 주민등록 통계가 아닙니다.",
    );
  });

  it("출생·사망만 실측이면 인구·세대만 합성이라 말한다", () => {
    expect(rewriteSyntheticNote(SYNTHETIC, { population: false, vitals: true })).toBe(
      "인구·세대 값은 합성값이며 실제 주민등록 통계가 아닙니다.",
    );
  });

  it("둘 다 실측이면 각주를 지운다", () => {
    expect(rewriteSyntheticNote(SYNTHETIC, { population: true, vitals: true })).toBeNull();
  });

  it("합성 각주가 아닌 줄은 건드리지 않는다", () => {
    const other = "분석 거리는 행정동 대표점 기준 직선거리입니다.";
    expect(rewriteSyntheticNote(other, { population: true, vitals: true })).toBe(other);
  });

  it("HIRA로 교체했으면 PRNG 좌표 각주를 지운다", () => {
    const prng = "시설 위치는 행정동 내부 대표점 주변 PRNG 배치이며 실제 요양기관 좌표가 아닙니다.";
    expect(rewriteSyntheticNote(prng, { population: false, vitals: false, facilities: true })).toBeNull();
    expect(rewriteSyntheticNote(prng, { population: false, vitals: false, facilities: false })).toBe(prng);
  });

  it("실측이 하나라도 있으면 전체를 시연이라 부르지 않는다", () => {
    const demo = "경상남도 행정동 경계를 기준으로 만든 결정론적 시연 데이터입니다.";
    expect(rewriteSyntheticNote(demo, { population: false, vitals: false, facilities: true })).toBe(
      "경상남도 행정동 경계를 기준으로 구성한 자료입니다.",
    );
    expect(rewriteSyntheticNote(demo, { population: false, vitals: false, facilities: false })).toBe(demo);
  });

  it("만든 사람 말투의 진료과 각주를 사실 문장으로 바꾼다", () => {
    expect(
      rewriteSyntheticNote(
        "진료과·운영시간 null은 UI의 '데이터 없음' 처리를 검증하기 위한 의도적 값입니다.",
        { population: false, vitals: false, facilities: true },
      ),
    ).toBe("진료과·운영시간이 제공되지 않는 시설이 있습니다.");
  });
});
