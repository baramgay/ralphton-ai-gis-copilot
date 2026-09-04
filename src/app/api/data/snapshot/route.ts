import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { DemoSnapshotSchema, type DemoSnapshot } from '@/lib/domain/schemas';
import { readPublishedSnapshotMeta } from '@/lib/supabase/public';
import { CachedSnapshotSchema } from '@/lib/supabase/types';

const ModeSchema = z.enum(['auto', 'live', 'demo']);
const DEMO_SNAPSHOT_PATH = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  'public',
  'data',
  'demo-snapshot.json',
);

let demoSnapshotPromise: Promise<DemoSnapshot> | null = null;

function loadDemoSnapshot(): Promise<DemoSnapshot> {
  if (!demoSnapshotPromise) {
    demoSnapshotPromise = readFile(DEMO_SNAPSHOT_PATH, 'utf8')
      .then((text) => DemoSnapshotSchema.parse(JSON.parse(text)))
      .catch((error) => {
        demoSnapshotPromise = null;
        throw error;
      });
  }

  return demoSnapshotPromise;
}

/*
 * s-maxage가 없으면 Vercel CDN은 60초마다 만료시키고, 그 순간 들어온 방문자가
 * 함수 콜드스타트를 그대로 기다린다(prod에서 11.5초 관측). CDN은 5분간 신선하게 주고,
 * 그 뒤에는 낡은 응답을 즉시 주면서 뒤에서 갱신하게 한다. 스냅샷은 월 단위로 바뀌므로
 * 이 정도 지연은 감수할 만하다.
 *
 * ⚠️ `max-age`는 **`s-maxage`보다 커야 한다.**
 *
 * Vercel은 클라이언트에게 `s-maxage`·`stale-while-revalidate`를 지우고 `max-age`만
 * 남겨 보내면서, CDN에 머문 시간을 `Age`에 실어 준다. `max-age=60`이면 CDN에 60초만
 * 있어도 브라우저에는 **도착하는 순간 이미 만료된 응답**이 된다(실측: `Age: 67`).
 * 그러면 `<link rel="preload">`로 미리 받아 둔 것을 곧이어 부르는 `fetch()`가 쓰지
 * 못하고 313KB를 **한 번 더** 내려받는다 — 미리 받는 이유가 사라진다.
 * 경계 파일이 멀쩡했던 것은 `immutable`이라 늘 신선해서였다.
 */
export const SNAPSHOT_CACHE_CONTROL = 'public, max-age=600, s-maxage=300, stale-while-revalidate=3600';

function snapshotResponse(
  snapshot: { mode?: string; referenceMonth?: string; facilities?: unknown[]; regions?: unknown[] },
  source: 'supabase-cache' | 'demo' | 'demo-fallback',
  publishedAt?: string | null,
) {
  return NextResponse.json(snapshot, {
    headers: {
      'Cache-Control': SNAPSHOT_CACHE_CONTROL,
      'X-Data-Source': source,
      'X-Snapshot-Mode': String(snapshot.mode ?? ''),
      'X-Reference-Month': String(snapshot.referenceMonth ?? ''),
      'X-Facility-Count': String(snapshot.facilities?.length ?? 0),
      'X-Region-Count': String(snapshot.regions?.length ?? 0),
      ...(publishedAt ? { 'X-Published-At': publishedAt } : {}),
    },
  });
}

export async function GET(request: Request) {
  const mode = ModeSchema.safeParse(new URL(request.url).searchParams.get('mode') ?? 'auto');

  if (!mode.success) {
    return NextResponse.json(
      { error: '요청한 데이터 모드를 처리할 수 없습니다.' },
      { status: 400 },
    );
  }

  if (mode.data === 'demo') {
    return snapshotResponse(await loadDemoSnapshot(), 'demo');
  }

  // "auto" prefers the newest published live snapshot and then falls back to
  // the bundled demo. The public cache adapter intentionally accepts only
  // concrete database modes.
  const cachedMeta = await readPublishedSnapshotMeta(mode.data === 'auto' ? 'live' : mode.data);
  const validatedCache = CachedSnapshotSchema.safeParse(cachedMeta?.snapshot);

  if (
    validatedCache.success &&
    (mode.data === 'auto' || validatedCache.data.mode === mode.data)
  ) {
    return snapshotResponse(validatedCache.data, 'supabase-cache', cachedMeta?.createdAt);
  }

  return snapshotResponse(await loadDemoSnapshot(), 'demo-fallback');
}
