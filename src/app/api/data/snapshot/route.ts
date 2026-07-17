import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { DemoSnapshotSchema, type DemoSnapshot } from '@/lib/domain/schemas';
import { readPublishedSnapshot } from '@/lib/supabase/public';
import { CachedSnapshotSchema } from '@/lib/supabase/types';

const ModeSchema = z.enum(['auto', 'live', 'demo']);
const DEMO_SNAPSHOT_PATH = path.join(process.cwd(), 'public', 'data', 'demo-snapshot.json');

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

function snapshotResponse(snapshot: unknown, source: 'supabase-cache' | 'demo' | 'demo-fallback') {
  return NextResponse.json(snapshot, {
    headers: {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
      'X-Data-Source': source,
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
  const cached = await readPublishedSnapshot(mode.data === 'auto' ? 'live' : mode.data);
  const validatedCache = CachedSnapshotSchema.safeParse(cached);

  if (
    validatedCache.success &&
    (mode.data === 'auto' || validatedCache.data.mode === mode.data)
  ) {
    return snapshotResponse(validatedCache.data, 'supabase-cache');
  }

  return snapshotResponse(await loadDemoSnapshot(), 'demo-fallback');
}
