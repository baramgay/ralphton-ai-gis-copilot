import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminSecret, authorizedUsage } from '@/lib/analytics/auth';
import { aggregateUsage } from '@/lib/analytics/aggregate';
import { readUsageDaily } from '@/lib/analytics/server';
import { USAGE_DATASETS } from '@/lib/analytics/catalog';

const headers = { 'Cache-Control': 'private, no-store' };
const Params = z.object({ period: z.enum(['day', 'week', 'month']).default('day'), days: z.enum(['30', '90', '365']).default('30') }).strict();
export async function GET(request: Request) {
  if (!adminSecret()) return NextResponse.json({ notice: '사용 통계 관리자 설정이 필요합니다.' }, { status: 503, headers });
  if (!authorizedUsage(request)) return NextResponse.json({ notice: '관리자 인증이 필요합니다.' }, { status: 401, headers });
  const url = new URL(request.url);
  const parsed = Params.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return NextResponse.json({ notice: '조회 기간을 확인해 주세요.' }, { status: 400, headers });
  const days = Number(parsed.data.days) as 30 | 90 | 365;
  const now = new Date();
  try {
    const rows = await readUsageDaily(days, now);
    const result = aggregateUsage(rows, { period: parsed.data.period, days, now });
    const datasetCounts: Record<string, number> = {};
    for (const row of rows) {
      if (row.day < result.startDay || row.day > result.endDay) continue;
      for (const [id, count] of Object.entries(row.datasets)) datasetCounts[id] = (datasetCounts[id] ?? 0) + count;
    }
    return NextResponse.json({ timezone: 'Asia/Seoul', period: parsed.data.period, days, startDate: result.startDay, endDate: result.endDay, totals: result.totals, series: result.series.map((row) => ({ ...row, date: row.day })),
      datasets: USAGE_DATASETS.map((dataset) => ({ ...dataset, count: datasetCounts[dataset.id] ?? 0 })).filter((dataset) => dataset.count > 0).sort((a, b) => b.count - a.count), updatedAt: now.toISOString(),
    }, { headers });
  } catch { return NextResponse.json({ notice: '통계를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: 503, headers }); }
}
