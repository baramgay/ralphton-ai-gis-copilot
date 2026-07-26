import { describe, expect, it } from "vitest";

import {
  fetchAndMergeRegionalPopulation,
  indexResidentRows,
  mergeLatestPopulation,
  monthCandidates,
} from "@/lib/data/population-live";
import type { AnalysisSnapshot } from "@/lib/domain/schemas";

const base: AnalysisSnapshot = {
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
      areaSquareKm: 2,
      months: [
        "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
        "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      ],
      population: Array(13).fill(1000),
      households: Array(13).fill(400),
      populationDensity: Array(13).fill(500),
      youthPopulation: Array(13).fill(100),
      workingAgePopulation: Array(13).fill(700),
      elderlyPopulation: Array(13).fill(200),
      onePersonHouseholds: Array(13).fill(50),
      births: Array(13).fill(1),
      deaths: Array(13).fill(1),
      naturalChange: Array(13).fill(0),
    },
  ],
  facilities: [],
  sourceNotes: [],
};

describe("population-live", () => {
  it("indexes and merges latest population month", () => {
    const indexed = indexResidentRows([
      {
        admmCd: "4812125000",
        totNmpr: 2500,
        hhCnt: 900,
        stdgMtrYm: "202606",
      },
    ]);
    expect(indexed.get("4812125000")?.population).toBe(2500);

    const merged = mergeLatestPopulation(base, indexed);
    expect(merged.updatedCount).toBe(1);
    expect(merged.regions[0].population[12]).toBe(2500);
    expect(merged.regions[0].households[12]).toBe(900);
    expect(merged.regions[0].population[0]).toBe(1000);
  });
});

describe("monthCandidates", () => {
  it("기준월부터 과거로 내려가는 후보를 만든다", () => {
    expect(monthCandidates("2026-06", 3)).toEqual(["202606", "202605", "202604"]);
  });

  it("연초에서는 전년 12월로 넘어간다", () => {
    expect(monthCandidates("2026-02", 3)).toEqual(["202602", "202601", "202512"]);
  });

  it("하이픈이 없어도 읽는다", () => {
    expect(monthCandidates("202606", 2)).toEqual(["202606", "202605"]);
  });

  it("형식이 어긋나면 원래 값을 그대로 쓴다", () => {
    expect(monthCandidates("bogus")).toEqual(["bogus"]);
  });

  it("lookback을 안 주면 기본 3개월을 본다", () => {
    expect(monthCandidates("2026-06")).toHaveLength(3);
  });
});

describe("fetchAndMergeRegionalPopulation 월 폴백", () => {
  const base = {
    mode: "demo" as const,
    referenceMonth: "2026-06",
    months: ["2026-05", "2026-06"],
    regions: [],
    facilities: [],
    sourceNotes: [],
  };

  it("기준월이 비어 있으면 직전 달을 찾아 쓴다", async () => {
    // 공공데이터는 한두 달 지연 공개된다. 기준월만 물어보면 갱신이 통째로 실패한다.
    const asked: string[] = [];
    const fetchImpl = (async (url: string) => {
      const month = new URL(url).searchParams.get("stdgMtrYm") ?? "";
      asked.push(month);
      const items = month === "202604" ? [{ admmCd: "4812125000", totNmprCnt: "100" }] : [];
      return new Response(JSON.stringify({ response: { body: { items, totalCount: items.length } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const result = await fetchAndMergeRegionalPopulation(base, "key", { fetch: fetchImpl });

    // 최신 달부터 순서대로 물어보고, 값이 나온 달에서 멈춘다.
    expect(asked.slice(0, 3)).toEqual(["202606", "202605", "202604"]);
    expect(result.notes.some((note) => note.includes("202604"))).toBe(true);
  });

  it("모든 후보가 비면 스냅샷을 유지하고 그 사실을 알린다", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ response: { body: { items: [], totalCount: 0 } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const result = await fetchAndMergeRegionalPopulation(base, "key", { fetch: fetchImpl });
    expect(result.updatedCount).toBe(0);
    expect(result.notes.some((note) => note.includes("기준 스냅샷을 유지"))).toBe(true);
  });
});
