import { describe, expect, it } from "vitest";

import { fetchAndMergeVitals, sumVitalRowsByDongMonth } from "@/lib/data/vitals-live";
import type { AnalysisSnapshot } from "@/lib/domain/schemas";

/*
 * 출생·사망은 인구와 규격이 같지만 **결측의 뜻이 정반대다.**
 *
 * 인구는 모든 (동, 월)에 행이 있다 — 한 칸이라도 비면 요청이 잘못된 것이므로 전부 버린다.
 * 출생·사망은 그 달 그 동에 아무도 태어나지 않으면 **행이 아예 없다**(실측: 창원 명곡동
 * 202606 출생 0행). 여기서 "빈 칸 = 버린다"로 두면 시골 면 대부분이 탈락해 영영 못 채운다.
 *
 * 그래서 갈라야 한다: **요청이 실패한 것**은 전부 버리고, **성공한 요청에 행이 없는 것**은
 * 0으로 채운다. 이 둘을 뭉뚱그리면 둘 중 하나는 반드시 틀린다.
 */
const MONTHS = [
  "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
];

function region(adm_cd2: string, adm_nm: string) {
  return {
    adm_cd2,
    adm_nm,
    representativePoint: { lat: 35.2, lng: 128.6 },
    areaSquareKm: 10,
    months: MONTHS,
    population: MONTHS.map(() => 1000),
    households: MONTHS.map(() => 400),
    populationDensity: MONTHS.map(() => 100),
    youthPopulation: MONTHS.map(() => 200),
    workingAgePopulation: MONTHS.map(() => 600),
    elderlyPopulation: MONTHS.map(() => 200),
    onePersonHouseholds: MONTHS.map(() => 150),
    births: MONTHS.map(() => 5),
    deaths: MONTHS.map(() => 8),
    naturalChange: MONTHS.map(() => -3),
  };
}

const base = {
  mode: "demo",
  referenceMonth: "2026-06",
  months: MONTHS,
  regions: [
    region("4817025000", "경상남도 진주시 문산읍"),
    region("4812125000", "경상남도 창원시 의창구 동읍"),
  ],
  facilities: [],
  sourceNotes: [],
} as unknown as AnalysisSnapshot;

/** 통·반 행 하나. 실제 응답과 같은 필드명을 쓴다. */
const row = (admmCd: string, statsYm: string, totNmprCnt: number) => ({
  admmCd,
  statsYm,
  totNmprCnt: String(totNmprCnt),
  maleNmprCnt: String(totNmprCnt),
  femlNmprCnt: "0",
  tong: "1",
  ban: "1",
});

/**
 * 출생·사망 두 데이터셋을 각각 흉내 낸다. `empty`로 지정한 (동, 월)은 **행 없이 정상 응답**을
 * 돌려준다 — 실제 API가 0명인 달에 그렇게 답한다.
 */
function fakeApi(options: { empty?: (code: string, month: string) => boolean; fail?: (code: string) => boolean } = {}) {
  const asked: Array<{ dataset: string; code: string; from: string; to: string }> = [];
  const fetchImpl = (async (url: string) => {
    const parsed = new URL(url);
    const dataset = parsed.pathname.includes("BrthReg") ? "births" : "deaths";
    const params = parsed.searchParams;
    const code = params.get("admmCd") ?? "";
    const from = params.get("srchFrYm") ?? "";
    const to = params.get("srchToYm") ?? "";
    asked.push({ dataset, code, from, to });
    if (options.fail?.(code)) {
      return new Response("boom", { status: 500 });
    }
    const items = MONTHS.map((month) => month.replace("-", ""))
      .filter((month) => month >= from && month <= to)
      .filter((month) => !options.empty?.(code, month))
      // 한 동·한 달을 통·반 두 행으로 쪼갠다 — 합산이 실제로 일어나는지 보려면 나뉘어야 한다.
      .flatMap((month) => [
        row(code, month, dataset === "births" ? 2 : 3),
        row(code, month, dataset === "births" ? 1 : 4),
      ]);
    return new Response(
      JSON.stringify({
        Response: { head: { resultCode: "0", totalCount: items.length }, items: { item: items } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

describe("sumVitalRowsByDongMonth", () => {
  it("통·반 행을 (동, 월)별로 합친다", () => {
    const totals = sumVitalRowsByDongMonth([
      row("4817025000", "202603", 2),
      row("4817025000", "202603", 1),
      row("4817025000", "202604", 4),
      row("4812125000", "202603", 7),
    ]);
    expect(totals.get("4817025000|2026-03")).toBe(3);
    expect(totals.get("4817025000|2026-04")).toBe(4);
    expect(totals.get("4812125000|2026-03")).toBe(7);
  });
});

describe("fetchAndMergeVitals", () => {
  it("동마다 4개월 창으로 두 데이터셋을 묻는다", async () => {
    const { fetchImpl, asked } = fakeApi();
    await fetchAndMergeVitals(base, "key", { fetch: fetchImpl });

    expect(asked).toHaveLength(16); // 2개 동 × 4개 창 × 2개 데이터셋
    expect(asked.filter((a) => a.dataset === "births" && a.code === "4817025000").map((a) => `${a.from}-${a.to}`)).toEqual([
      "202506-202509",
      "202510-202601",
      "202602-202605",
      "202606-202606",
    ]);
  });

  it("시계열 13칸을 전부 실데이터로 채우고 자연증감을 다시 낸다", async () => {
    const { fetchImpl } = fakeApi();
    const result = await fetchAndMergeVitals(base, "key", { fetch: fetchImpl });

    expect(result.updatedCount).toBe(2);
    const [munsan] = result.regions;
    expect(munsan.births).toHaveLength(13);
    expect(munsan.births.every((value) => value === 3)).toBe(true); // 2 + 1
    expect(munsan.deaths.every((value) => value === 7)).toBe(true); // 3 + 4
    expect(munsan.naturalChange.every((value) => value === -4)).toBe(true); // 3 - 7
  });

  /*
   * 이 테스트가 이 파일의 이유다. 인구 백필을 그대로 베끼면 "행이 없다"를 결측으로 읽어
   * 시골 면이 통째로 탈락하고, 그러면 전부-아니면-전무 규칙에 걸려 아무것도 못 바꾼다.
   */
  it("행이 없는 달은 0명으로 채운다 — 결측이 아니라 실제로 0명이다", async () => {
    const { fetchImpl } = fakeApi({ empty: (code, month) => code === "4817025000" && month === "202603" });
    const result = await fetchAndMergeVitals(base, "key", { fetch: fetchImpl });

    expect(result.updatedCount).toBe(2);
    const munsan = result.regions.find((item) => item.adm_cd2 === "4817025000")!;
    const index = MONTHS.indexOf("2026-03");
    expect(munsan.births[index]).toBe(0);
    expect(munsan.deaths[index]).toBe(0);
    expect(munsan.naturalChange[index]).toBe(0);
    // 다른 달은 그대로 실데이터
    expect(munsan.births[0]).toBe(3);
  });

  it("요청이 하나라도 실패하면 기준 스냅샷을 그대로 둔다", async () => {
    const { fetchImpl } = fakeApi({ fail: (code) => code === "4812125000" });
    const result = await fetchAndMergeVitals(base, "key", { fetch: fetchImpl });

    expect(result.updatedCount).toBe(0);
    expect(result.regions).toBe(base.regions);
    expect(result.notes.join(" ")).toContain("실패");
  });
});
