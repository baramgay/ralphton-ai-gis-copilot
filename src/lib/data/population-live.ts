/**
 * 기준 스냅샷 위에 행정안전부 주민등록 인구·세대 **시계열 전체**를 덮어쓴다.
 *
 * 이 API는 읍면동 10자리 코드로만 답하고 한 번에 최대 4개월치를 준다. 경남 305개
 * 읍면동 × 13개월이면 1,220회 호출이다. 규격 실측은 docs/POPULATION-API-FINDINGS.md.
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
    /*
     * 실제 필드명은 `totNmprCnt`다(실측). 후보 목록에 `totNmpr`만 있어서, 응답이 정상이어도
     * 인구를 못 읽고 0행으로 취급하고 있었다(docs/POPULATION-API-FINDINGS.md).
     */
    row.totNmprCnt ?? row.population ?? row.totNmpr ?? row.totPpltn ?? row.ppltnCnt ?? row.totPop;
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

/** 행정표준 시도 코드: 경남 48 */
export const POPULATION_CTPV_CODES = ["48"] as const;

/**
 * 한 번에 조회할 수 있는 최대 개월 수.
 *
 * 5개월을 넘기면 `QUERY_PERIOD_LIMIT_EXCEEDED`가 온다(실측). 이 상수를 늘리면 조용히
 * 0행이 되므로, 호출 수를 줄이고 싶어도 여기를 건드리면 안 된다.
 */
export const MAX_QUERY_MONTHS = 4;

/** `["2025-06", …, "2026-06"]` → `[["202506","202509"], …]`. 각 구간은 4개월 이하. */
export function monthWindows(
  months: readonly string[],
  size = MAX_QUERY_MONTHS,
): Array<[string, string]> {
  const compact = months.map((month) => month.replace("-", ""));
  const windows: Array<[string, string]> = [];
  for (let index = 0; index < compact.length; index += size) {
    const chunk = compact.slice(index, index + size);
    windows.push([chunk[0], chunk[chunk.length - 1]]);
  }
  return windows;
}

/**
 * 통·반 행을 (행정동, 월)별로 합친다.
 *
 * 행은 통·반 단위이고 서로 겹치지 않는다 — 통 합계·동 합계 같은 중복 행은 없다.
 * `tong`·`ban`이 빈 행이 하나씩 섞여 있는데(거주불명자로 보인다) 그것도 합산 대상이다.
 * 문산읍 2026-03: 61행 합계 7,396명.
 */
export function sumRowsByDongMonth(
  rows: ReadonlyArray<Record<string, unknown>>,
): Map<string, { population: number; households: number | null }> {
  const totals = new Map<string, { population: number; households: number | null }>();
  for (const row of rows) {
    const code = asAdmCode(row);
    const month = asMonth(row);
    const population = asPopulation(row);
    if (!code || !month || population === null) continue;
    const key = `${code}|${month}`;
    const prev = totals.get(key);
    const households = asHouseholds(row);
    totals.set(key, {
      population: (prev?.population ?? 0) + population,
      households: households === null ? prev?.households ?? null : (prev?.households ?? 0) + households,
    });
  }
  return totals;
}

/** 동시 실행 수를 묶어 순회한다. 1,220회를 한꺼번에 던지면 공급자가 막는다. */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export type PopulationBackfillOptions = {
  /*
   * 동시 요청 수. 기본 8로 처음 배포했다가 prod에서 504 FUNCTION_INVOCATION_TIMEOUT으로
   * 죽었다(`writeSyncStatus`도 못 남길 만큼 이른 시점). 라우트의 `maxDuration=300`에
   * 맞춰 1,220회 ÷ 16 ≈ 76배치 × 1.5~2초 ≈ 114~152초로 여유를 뒀다.
   */
  concurrency?: number;
  /*
   * 창 하나당 재시도 횟수. 기본을 1에서 0으로 낮췄다 — 재시도가 있으면 실패한 배치마다
   * 최악의 경우 시간이 두 배가 되어 타임아웃을 오히려 앞당긴다. 실패는 예외로 잡혀
   * "전부 아니면 전무" 경로로 이미 안전하게 처리되므로, 속도가 안정성보다 급하다.
   */
  retries?: number;
};

/**
 * 경남 305개 읍면동의 인구·세대 **시계열 전체**를 실데이터로 채운다.
 *
 * 예전 구현은 시도 코드 하나로 한 번 호출해 **최신월 한 칸만** 바꾸려 했다. 그 요청은
 * 규격이 달라 한 번도 성공한 적이 없고, 설령 성공했더라도 실측 1개월 + 합성 12개월이 되어
 * 12개월 추세가 실측과 합성의 단차를 줄 세웠을 것이다(docs/POPULATION-API-FINDINGS.md).
 *
 * **전부 아니면 전무로 간다.** 일부 지역만 실데이터로 바뀌면 지역 간 순위가 실측과 합성을
 * 섞어 비교하게 된다 — 조용히 틀린 답이고, 이 프로젝트에서 가장 나쁜 실패다. 한 지역이라도
 * 한 달이라도 빠지면 기준 스냅샷을 그대로 둔다.
 */
export async function fetchAndMergeRegionalPopulation(
  base: AnalysisSnapshot,
  serviceKey: string,
  deps: PublicDataFetchDeps = {},
  options: PopulationBackfillOptions = {},
): Promise<PopulationMergeResult> {
  const windows = monthWindows(base.months);
  const jobs = base.regions.flatMap((region) =>
    windows.map((window) => ({ code: region.adm_cd2, window })),
  );
  const retries = Math.max(0, options.retries ?? 0);

  const settled = await mapWithConcurrency(jobs, options.concurrency ?? 16, async (job) => {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        return await fetchAllPublicDataPages(
          "residentPopulation",
          {
            serviceKey,
            admmCode: job.code,
            fromMonth: job.window[0],
            toMonth: job.window[1],
            numOfRows: 1_000,
          },
          deps,
        );
      } catch {
        if (attempt === retries) return null;
      }
    }
    return null;
  });

  const failed = settled.filter((rows) => rows === null).length;
  if (failed > 0) {
    return {
      regions: base.regions,
      updatedCount: 0,
      month: null,
      notes: [
        `인구 live 요청 ${failed}/${jobs.length}건 실패 — 인구·세대 시계열은 기준 스냅샷을 유지합니다.`,
      ],
    };
  }

  // 키의 월은 `asMonth`가 정규화한 "2026-03" 꼴이다. 요청은 "202603"으로 보내지만
  // 조회는 스냅샷의 월 표기를 그대로 쓴다 — 두 표기를 섞으면 전부 미스가 난다.
  const totals = sumRowsByDongMonth(settled.flatMap((rows) => rows ?? []));

  // 한 칸이라도 비면 그 지역은 못 쓴다 — 섞인 시계열은 추세를 거짓말하게 만든다.
  const missing = base.regions.filter((region) =>
    base.months.some((month) => !totals.has(`${region.adm_cd2}|${month}`)),
  );
  if (missing.length > 0) {
    return {
      regions: base.regions,
      updatedCount: 0,
      month: null,
      notes: [
        `인구 live: ${missing.length}/${base.regions.length}개 동의 시계열이 불완전해 기준 스냅샷을 유지합니다(예: ${missing[0].adm_nm}).`,
      ],
    };
  }

  const regions = base.regions.map((region) => {
    const population = base.months.map(
      (month) => totals.get(`${region.adm_cd2}|${month}`)!.population,
    );
    const households = base.months.map((month, index) => {
      const hit = totals.get(`${region.adm_cd2}|${month}`)!.households;
      return hit === null ? region.households[index] : hit;
    });
    const populationDensity = population.map((value, index) =>
      region.areaSquareKm > 0 ? value / region.areaSquareKm : region.populationDensity[index],
    );
    return { ...region, population, households, populationDensity };
  });

  return {
    regions,
    updatedCount: regions.length,
    month: base.months[base.months.length - 1],
    notes: [
      `인구 live: 경남 ${regions.length}개 읍면동의 인구·세대 ${base.months.length}개월 시계열을 실데이터로 교체했습니다.`,
      `요청 ${jobs.length}건(동 ${base.regions.length} × 구간 ${windows.length}).`,
    ],
  };
}
