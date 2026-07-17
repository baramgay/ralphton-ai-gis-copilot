/**
 * Partial live population merge onto a verified base snapshot.
 * Fetches resident population for Busan (ctpv 26) and updates the latest month only.
 * Full 13-month live rebuild remains optional (normalizePublicData) when complete feeds exist.
 */

import type { AnalysisSnapshot, RegionSeries } from "@/lib/domain/schemas";
import { fetchAllPublicDataPages, type PublicDataFetchDeps } from "@/lib/data/public-api";

export type PopulationMergeResult = {
  regions: RegionSeries[];
  updatedCount: number;
  month: string | null;
  notes: string[];
};

function asAdmCode(row: Record<string, unknown>): string | null {
  const raw =
    row.adm_cd2 ??
    row.admCd2 ??
    row.admmCd ??
    row.stdgCd ??
    row.tongBanCd ??
    row.emdCd;
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(0, 10);
  if (digits.length === 8) return `${digits}00`; // some feeds omit tong/ban
  return null;
}

function asPopulation(row: Record<string, unknown>): number | null {
  const raw =
    row.population ?? row.totNmpr ?? row.totPpltn ?? row.ppltnCnt ?? row.totPop;
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replaceAll(",", ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function asHouseholds(row: Record<string, unknown>): number | null {
  const raw = row.households ?? row.hhCnt ?? row.totHhcnt ?? row.hhldCnt;
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replaceAll(",", ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function asMonth(row: Record<string, unknown>): string | null {
  const raw = row.stdgMtrYm ?? row.month ?? row.baseYm ?? row.statsYm;
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 6) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
  }
  if (/^\d{4}-\d{2}$/.test(String(raw))) return String(raw);
  return null;
}

/**
 * Map public API rows → adm_cd2 → {population, households, month}.
 */
export function indexResidentRows(
  rows: Array<Record<string, unknown>>,
): Map<string, { population: number; households: number | null; month: string | null }> {
  const map = new Map<
    string,
    { population: number; households: number | null; month: string | null }
  >();
  for (const row of rows) {
    const code = asAdmCode(row);
    const population = asPopulation(row);
    if (!code || population === null) continue;
    const prev = map.get(code);
    // Sum tong/ban fragments if multiple rows share an adm code
    map.set(code, {
      population: (prev?.population ?? 0) + population,
      households:
        asHouseholds(row) !== null
          ? (prev?.households ?? 0) + (asHouseholds(row) as number)
          : (prev?.households ?? null),
      month: asMonth(row) ?? prev?.month ?? null,
    });
  }
  return map;
}

export function mergeLatestPopulation(
  base: AnalysisSnapshot,
  indexed: Map<string, { population: number; households: number | null; month: string | null }>,
): PopulationMergeResult {
  const notes: string[] = [];
  if (indexed.size === 0) {
    return {
      regions: base.regions,
      updatedCount: 0,
      month: null,
      notes: ["인구 live 행을 매핑하지 못했습니다."],
    };
  }

  const last = base.months.length - 1;
  let updatedCount = 0;
  let month: string | null = null;

  const regions = base.regions.map((region) => {
    const hit = indexed.get(region.adm_cd2);
    if (!hit) return region;
    updatedCount += 1;
    month = hit.month ?? month;
    const population = [...region.population];
    const households = [...region.households];
    const populationDensity = [...region.populationDensity];
    population[last] = hit.population;
    if (hit.households !== null) households[last] = hit.households;
    populationDensity[last] =
      region.areaSquareKm > 0 ? hit.population / region.areaSquareKm : region.populationDensity[last];
    return {
      ...region,
      population,
      households,
      populationDensity,
    };
  });

  notes.push(
    `인구 live: 기준 스냅샷 최신월에 ${updatedCount}/${base.regions.length}개 동 인구를 반영했습니다.`,
  );
  if (month) notes.push(`인구 원천 월 표기: ${month}`);

  return { regions, updatedCount, month, notes };
}

export async function fetchAndMergeBusanPopulation(
  base: AnalysisSnapshot,
  serviceKey: string,
  deps: PublicDataFetchDeps = {},
  referenceMonth?: string,
): Promise<PopulationMergeResult> {
  const month = (referenceMonth ?? base.referenceMonth).replace("-", "");
  try {
    const rows = await fetchAllPublicDataPages(
      "residentPopulation",
      {
        serviceKey,
        ctpvCode: "26",
        referenceMonth: month,
        numOfRows: 1_000,
      },
      deps,
    );
    const indexed = indexResidentRows(rows);
    return mergeLatestPopulation(base, indexed);
  } catch {
    return {
      regions: base.regions,
      updatedCount: 0,
      month: null,
      notes: ["인구 live 요청 실패 — 인구 시계열은 기준 스냅샷을 유지합니다."],
    };
  }
}
