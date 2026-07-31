import { describe, expect, it } from "vitest";

import {
  MAX_QUERY_MONTHS,
  fetchAndMergeRegionalPopulation,
  monthWindows,
  sumRowsByDongMonth,
} from "@/lib/data/population-live";
import type { AnalysisSnapshot } from "@/lib/domain/schemas";

/*
 * 이 피드는 한 번도 동작한 적이 없었다. 요청이 API 규격과 달라 어떤 달을 물어도 0행이었고,
 * 그 사실이 "월 공개 지연"으로 설명돼 3개월 폴백까지 만들어져 있었다 — 대책이 있다는 사실이
 * 진단이 맞다는 증거처럼 보였다. 규격 실측은 docs/POPULATION-API-FINDINGS.md.
 *
 * 여기서 잠그는 것은 셋이다: 4개월 창으로 끊는가, 통·반 행을 (동, 월)별로 합치는가,
 * **하나라도 빠지면 전부 버리는가**. 셋째가 가장 중요하다 — 일부만 실데이터로 바뀌면
 * 지역 간 순위가 실측과 합성을 섞어 비교하게 되고, 그것은 조용히 틀린 답이다.
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
const row = (admmCd: string, statsYm: string, totNmprCnt: number, hhCnt: number) => ({
  admmCd,
  statsYm,
  totNmprCnt: String(totNmprCnt),
  hhCnt: String(hhCnt),
  tong: "1",
  ban: "1",
});

/** 요청 URL을 읽어 그 (동, 창)에 해당하는 통·반 행을 돌려주는 가짜 서버. */
function fakeApi(options: { skip?: (code: string, month: string) => boolean } = {}) {
  const asked: Array<{ code: string; from: string; to: string }> = [];
  const fetchImpl = (async (url: string) => {
    const params = new URL(url).searchParams;
    const code = params.get("admmCd") ?? "";
    const from = params.get("srchFrYm") ?? "";
    const to = params.get("srchToYm") ?? "";
    asked.push({ code, from, to });
    const items = MONTHS.map((month) => month.replace("-", ""))
      .filter((month) => month >= from && month <= to)
      .filter((month) => !options.skip?.(code, month))
      // 한 동·한 달을 통·반 두 행으로 쪼갠다 — 합산이 실제로 일어나는지 보려면 나뉘어야 한다.
      .flatMap((month) => [row(code, month, 700, 300), row(code, month, 300, 100)]);
    return new Response(
      JSON.stringify({
        Response: { head: { resultCode: "0", totalCount: items.length }, items: { item: items } },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as unknown as typeof fetch;
  return { fetchImpl, asked };
}

describe("monthWindows", () => {
  it("13개월을 4개월 이하 구간 4개로 자른다", () => {
    expect(monthWindows(MONTHS)).toEqual([
      ["202506", "202509"],
      ["202510", "202601"],
      ["202602", "202605"],
      ["202606", "202606"],
    ]);
  });

  it("한도는 4개월이다 — 늘리면 조용히 0행이 된다", () => {
    expect(MAX_QUERY_MONTHS).toBe(4);
  });
});

describe("sumRowsByDongMonth", () => {
  it("통·반 행을 (동, 월)별로 합친다", () => {
    const totals = sumRowsByDongMonth([
      row("4817025000", "202603", 224, 132),
      row("4817025000", "202603", 152, 82),
      row("4817025000", "202604", 200, 100),
      row("4812125000", "202603", 500, 200),
    ]);
    expect(totals.get("4817025000|2026-03")).toEqual({ population: 376, households: 214 });
    expect(totals.get("4817025000|2026-04")).toEqual({ population: 200, households: 100 });
    expect(totals.get("4812125000|2026-03")).toEqual({ population: 500, households: 200 });
  });

  it("달을 섞지 않는다 — 같은 동이라도 월이 다르면 따로 센다", () => {
    const totals = sumRowsByDongMonth([
      row("4817025000", "202603", 100, 50),
      row("4817025000", "202604", 100, 50),
    ]);
    expect(totals.size).toBe(2);
  });
});

describe("fetchAndMergeRegionalPopulation", () => {
  it("동마다 4개월 창으로 나눠 묻는다", async () => {
    const { fetchImpl, asked } = fakeApi();
    await fetchAndMergeRegionalPopulation(base, "key", { fetch: fetchImpl });
    expect(asked).toHaveLength(8); // 2개 동 × 4개 창
    expect(asked.filter((a) => a.code === "4817025000").map((a) => `${a.from}-${a.to}`)).toEqual([
      "202506-202509",
      "202510-202601",
      "202602-202605",
      "202606-202606",
    ]);
  });

  it("시계열 13칸을 전부 실데이터로 채운다", async () => {
    const { fetchImpl } = fakeApi();
    const result = await fetchAndMergeRegionalPopulation(base, "key", { fetch: fetchImpl });
    expect(result.updatedCount).toBe(2);
    const [munsan] = result.regions;
    expect(munsan.population).toHaveLength(13);
    expect(munsan.population.every((value) => value === 1000)).toBe(true); // 700 + 300
    expect(munsan.households.every((value) => value === 400)).toBe(true); // 300 + 100
  });

  it("인구밀도를 다시 계산한다", async () => {
    const { fetchImpl } = fakeApi();
    const result = await fetchAndMergeRegionalPopulation(base, "key", { fetch: fetchImpl });
    expect(result.regions[0].populationDensity[0]).toBeCloseTo(100, 5); // 1000 / 10km²
  });

  it("각주가 '기준 스냅샷'이라 말하지 않는다 — 배지가 그 문장을 읽는다", async () => {
    const { fetchImpl } = fakeApi();
    const result = await fetchAndMergeRegionalPopulation(base, "key", { fetch: fetchImpl });
    expect(result.notes.join(" ")).toMatch(/실데이터로 교체/);
    expect(result.notes.join(" ")).not.toMatch(/기준 스냅샷/);
  });

  it("한 동의 한 달만 비어도 전부 기준 스냅샷을 유지한다", async () => {
    /*
     * 이것이 이 기능의 핵심 규칙이다. 한 동만 합성으로 남으면 그 동은 순위에서 엉뚱한
     * 자리에 앉고, 사용자는 그 사실을 알 방법이 없다 — 조용히 틀린 답이다.
     */
    const { fetchImpl } = fakeApi({
      skip: (code, month) => code === "4812125000" && month === "202601",
    });
    const result = await fetchAndMergeRegionalPopulation(base, "key", { fetch: fetchImpl });
    expect(result.updatedCount).toBe(0);
    expect(result.regions[0].population.every((value) => value === 1000)).toBe(true);
    expect(result.notes.join(" ")).toMatch(/기준 스냅샷을 유지/);
    expect(result.notes.join(" ")).toMatch(/동읍/); // 어느 동이 빠졌는지 밝힌다
  });

  it("요청이 실패하면 재시도하고, 그래도 안 되면 전부 유지한다", async () => {
    let calls = 0;
    const failing = (async () => {
      calls += 1;
      throw new Error("네트워크");
    }) as unknown as typeof fetch;
    const result = await fetchAndMergeRegionalPopulation(base, "key", { fetch: failing }, { retries: 1 });
    expect(result.updatedCount).toBe(0);
    expect(calls).toBe(16); // 8개 요청 × (최초 1 + 재시도 1)
    expect(result.notes.join(" ")).toMatch(/기준 스냅샷을 유지/);
  });
});
