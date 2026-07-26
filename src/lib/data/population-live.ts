/**
 * Partial live population merge onto a verified base snapshot.
 * Fetches resident population for Gyeongnam (ctpv 48) and updates the latest month only.
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

/**
 * 기준월부터 과거로 내려가며 조회할 월 목록. "2026-06" → ["202606","202605","202604"].
 *
 * 주민등록 인구 통계는 보통 한두 달 지연되어 공개된다. 기준월 하나만 물어보면 아직 올라오지
 * 않은 달에 걸려 인구 갱신이 통째로 실패하고, 화면은 조용히 옛 스냅샷을 계속 보여준다.
 * 실제로 있는 가장 최근 달을 찾아 쓰기 위해 후보를 만든다.
 */
export function monthCandidates(referenceMonth: string, lookback = 3): string[] {
  const match = /^(\d{4})-?(\d{2})$/.exec(referenceMonth.trim());
  if (!match) return [referenceMonth.replace("-", "")];

  const year = Number(match[1]);
  const month = Number(match[2]);
  const candidates: string[] = [];
  for (let step = 0; step < Math.max(1, lookback); step += 1) {
    const total = year * 12 + (month - 1) - step;
    if (total < 0) break;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    candidates.push(`${y}${String(m).padStart(2, "0")}`);
  }
  return candidates;
}

/** 행정표준 시도 코드: 경남 48 */
export const POPULATION_CTPV_CODES = ["48"] as const;

/**
 * Merge latest resident population for one or more ctpv codes (default 경남).
 */
export async function fetchAndMergeRegionalPopulation(
  base: AnalysisSnapshot,
  serviceKey: string,
  deps: PublicDataFetchDeps = {},
  referenceMonth?: string,
  ctpvCodes: readonly string[] = POPULATION_CTPV_CODES,
): Promise<PopulationMergeResult> {
  const candidates = monthCandidates(referenceMonth ?? base.referenceMonth);
  const allRows: Array<Record<string, unknown>> = [];
  const notes: string[] = [];

  try {
    // 아직 공개되지 않은 달에 걸리면 인구가 통째로 갱신되지 않으므로, 실제로 값이 있는
    // 가장 최근 달을 찾을 때까지 과거로 내려간다.
    for (const month of candidates) {
      for (const ctpvCode of ctpvCodes) {
        try {
          const rows = await fetchAllPublicDataPages(
            "residentPopulation",
            {
              serviceKey,
              ctpvCode,
              referenceMonth: month,
              numOfRows: 1_000,
            },
            deps,
          );
          allRows.push(...rows);
          notes.push(`인구 ${month} ctpv ${ctpvCode}: ${rows.length}행`);
        } catch {
          notes.push(`인구 ${month} ctpv ${ctpvCode} 요청 실패`);
        }
      }
      if (allRows.length > 0) break;
    }

    if (allRows.length === 0) {
      return {
        regions: base.regions,
        updatedCount: 0,
        month: null,
        notes: ["인구 live 요청 실패 — 인구 시계열은 기준 스냅샷을 유지합니다.", ...notes],
      };
    }

    const indexed = indexResidentRows(allRows);
    const merged = mergeLatestPopulation(base, indexed);
    return {
      ...merged,
      notes: [...notes, ...merged.notes],
    };
  } catch {
    return {
      regions: base.regions,
      updatedCount: 0,
      month: null,
      notes: ["인구 live 요청 실패 — 인구 시계열은 기준 스냅샷을 유지합니다."],
    };
  }
}
