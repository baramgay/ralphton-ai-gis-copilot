/**
 * 기준 스냅샷 위에 행정안전부 주민등록 **출생·사망 시계열 전체**를 덮어쓴다.
 *
 * 인구(`population-live.ts`)와 같은 `1741000` 계열이고 요청 규격도 같다 — 행정동 10자리
 * 코드, 한 번에 최대 4개월, 통·반 행. 다른 점은 하나뿐인데 그 하나가 중요하다:
 * **그 달 그 동에 아무도 태어나거나 죽지 않으면 행이 아예 없다.** 인구에서 쓴
 * "한 칸이라도 비면 버린다"를 그대로 옮기면 시골 면 대부분이 탈락한다.
 *
 * 규격 실측은 docs/PUBLIC-DATA-API-SPEC.md.
 */

import type { AnalysisSnapshot, RegionSeries } from "@/lib/domain/schemas";
import { fetchAllPublicDataPages, type PublicDataFetchDeps } from "@/lib/data/public-api";
import {
  mapWithConcurrency,
  monthWindows,
  type PopulationBackfillOptions,
} from "@/lib/data/population-live";

export type VitalsMergeResult = {
  regions: RegionSeries[];
  updatedCount: number;
  notes: string[];
};

function asAdmCode(row: Record<string, unknown>): string | null {
  const raw = row.admmCd ?? row.adm_cd2 ?? row.admCd2 ?? row.stdgCd;
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(0, 10) : null;
}

function asMonth(row: Record<string, unknown>): string | null {
  const raw = row.statsYm ?? row.stdgMtrYm ?? row.month ?? row.baseYm;
  if (raw == null) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 6) return `${digits.slice(0, 4)}-${digits.slice(4, 6)}`;
  if (/^\d{4}-\d{2}$/.test(String(raw))) return String(raw);
  return null;
}

function asCount(row: Record<string, unknown>): number | null {
  // 출생·사망 모두 총계 필드명이 인구와 같은 `totNmprCnt`다(실측).
  const raw = row.totNmprCnt;
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).replaceAll(",", ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

/**
 * 통·반 행을 (행정동, 월)별로 합친다.
 *
 * 행은 통·반 단위이고 겹치지 않는다 — 소계·합계 행은 없다(실측: 창원 오동동 202606
 * 사망 17행, `(통,반)` 쌍이 모두 다르고 합계 20명).
 */
export function sumVitalRowsByDongMonth(
  rows: ReadonlyArray<Record<string, unknown>>,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const code = asAdmCode(row);
    const month = asMonth(row);
    const count = asCount(row);
    if (!code || !month || count === null) continue;
    const key = `${code}|${month}`;
    totals.set(key, (totals.get(key) ?? 0) + count);
  }
  return totals;
}

/**
 * 경남 305개 행정동의 출생·사망 **시계열 전체**를 실데이터로 채운다.
 *
 * **전부 아니면 전무로 간다** — 인구와 같은 이유다. 일부 지역만 실데이터가 되면 지역 간
 * 순위가 실측과 합성을 섞어 비교하게 되고, 그것은 조용히 틀린 답이다.
 *
 * 다만 "전무"의 판정 기준이 인구와 다르다. **요청 실패만 실패로 센다.** 성공한 요청에
 * 행이 없는 (동, 월)은 결측이 아니라 실제로 0명이므로 0으로 채운다.
 */
export async function fetchAndMergeVitals(
  base: AnalysisSnapshot,
  serviceKey: string,
  deps: PublicDataFetchDeps = {},
  options: PopulationBackfillOptions = {},
): Promise<VitalsMergeResult> {
  const windows = monthWindows(base.months);
  const jobs = (["births", "deaths"] as const).flatMap((dataset) =>
    base.regions.flatMap((region) =>
      windows.map((window) => ({ dataset, code: region.adm_cd2, window })),
    ),
  );
  const retries = Math.max(0, options.retries ?? 0);

  const settled = await mapWithConcurrency(jobs, options.concurrency ?? 16, async (job) => {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const rows = await fetchAllPublicDataPages(
          job.dataset,
          {
            serviceKey,
            admmCode: job.code,
            fromMonth: job.window[0],
            toMonth: job.window[1],
            numOfRows: 1_000,
          },
          deps,
        );
        return { dataset: job.dataset, rows };
      } catch {
        if (attempt === retries) return null;
      }
    }
    return null;
  });

  const failed = settled.filter((entry) => entry === null).length;
  if (failed > 0) {
    return {
      regions: base.regions,
      updatedCount: 0,
      notes: [
        `출생·사망 live 요청 ${failed}/${jobs.length}건 실패 — 출생·사망 시계열은 기준 스냅샷을 유지합니다.`,
      ],
    };
  }

  const byDataset = { births: [] as Record<string, unknown>[], deaths: [] as Record<string, unknown>[] };
  for (const entry of settled) {
    if (entry) byDataset[entry.dataset].push(...entry.rows);
  }
  const birthTotals = sumVitalRowsByDongMonth(byDataset.births);
  const deathTotals = sumVitalRowsByDongMonth(byDataset.deaths);

  const regions = base.regions.map((region) => {
    // 행이 없는 달은 0명이다. 요청 실패는 위에서 이미 걸렀으므로 여기 오는 빈 칸은 전부 실측 0이다.
    const births = base.months.map((month) => birthTotals.get(`${region.adm_cd2}|${month}`) ?? 0);
    const deaths = base.months.map((month) => deathTotals.get(`${region.adm_cd2}|${month}`) ?? 0);
    const naturalChange = births.map((value, index) => value - deaths[index]);
    return { ...region, births, deaths, naturalChange };
  });

  return {
    regions,
    updatedCount: regions.length,
    notes: [
      `출생·사망 live: 경남 ${regions.length}개 행정동의 ${base.months.length}개월 시계열을 실데이터로 교체했습니다.`,
      `요청 ${jobs.length}건(동 ${base.regions.length} × 구간 ${windows.length} × 데이터셋 2).`,
    ],
  };
}
