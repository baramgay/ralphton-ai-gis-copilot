import { NextResponse } from "next/server";
import { z } from "zod";

import { runLiveSync } from "@/lib/data/live-sync";
import {
  computeStaleness,
  readSyncStatus,
  writeSyncStatus,
} from "@/lib/data/sync-status";

/*
 * 인구 백필이 경남 305개 읍면동 × 4개 구간 = 1,220회 호출이라 기본 실행 시간(60초)으로는
 * 모자란다. 중간에 끊기면 전부-아니면-전무 규칙에 따라 통째로 버려지므로, 끊기지 않는 것이
 * 곧 성공 조건이다. 플랜 상한을 넘는 값은 Vercel이 알아서 낮춘다.
 */
export const maxDuration = 300;

const SyncBodySchema = z
  .object({
    publish: z.boolean().optional(),
    boundaryVersion: z.string().regex(/^\d{8}$/).optional(),
    /*
     * 한 실행에 인구(1,220회)와 출생·사망(2,440회)을 함께 넣으면 실측 처리량 기준 약 420초라
     * `maxDuration` 300초를 넘긴다. 단계로 나눠 돌리고, 두 번째 실행은 `baseFrom:"published"`로
     * 앞 단계 결과 위에 얹는다. 기본값은 인구 하나 — 예전 동작 그대로다.
     */
    datasets: z.array(z.enum(["population", "vitals"])).min(1).optional(),
    baseFrom: z.enum(["demo", "published"]).optional(),
  })
  .strict()
  .optional();

function unauthorized() {
  return NextResponse.json(
    { ok: false, error: "동기화 권한이 없습니다." },
    { status: 401 },
  );
}

function readSyncSecret(request: Request): string | null {
  const header = request.headers.get("x-sync-secret")?.trim();
  if (header) {
    return header;
  }

  const auth = request.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  return null;
}

/**
 * Public status of live cache (no secrets). Used by data tab.
 */
export async function GET() {
  const { readPublishedSnapshotMeta } = await import("@/lib/supabase/public");
  const live = await readPublishedSnapshotMeta("live");
  const local = await readSyncStatus();
  const publishedAt = live?.createdAt ?? local.lastSuccessAt;
  const staleness = computeStaleness(publishedAt, local);

  return NextResponse.json({
    ok: true,
    serverTime: new Date().toISOString(),
    dataSyncConfigured: Boolean(process.env.DATA_SYNC_SECRET?.trim()),
    publicDataConfigured: Boolean(process.env.DATA_GO_KR_SERVICE_KEY?.trim()),
    publishedLive: live
      ? {
          available: true,
          createdAt: live.createdAt,
          source: live.source,
          referenceMonth: live.snapshot.referenceMonth,
          facilityCount: live.snapshot.facilities.length,
          mode: live.snapshot.mode,
        }
      : { available: false },
    syncOps: {
      lastAttemptAt: local.lastAttemptAt,
      lastSuccessAt: local.lastSuccessAt,
      lastStatus: local.lastStatus,
      lastFacilityCount: local.lastFacilityCount,
      lastError: local.lastError,
      lastPublished: local.lastPublished,
      recommendedIntervalHours: local.recommendedIntervalHours,
      stale: staleness.stale,
      recommendSync: staleness.recommendSync,
      reason: staleness.reason,
      hoursSincePublish: staleness.hoursSincePublish,
      hoursSinceAttempt: staleness.hoursSinceAttempt,
    },
  });
}

/**
 * Optional live snapshot refresh. Requires DATA_SYNC_SECRET.
 * Never echoes credentials or upstream provider payloads.
 */
export async function POST(request: Request) {
  const expected = process.env.DATA_SYNC_SECRET?.trim();
  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error: "동기화가 비활성화되어 있습니다. DATA_SYNC_SECRET을 설정하세요.",
      },
      { status: 503 },
    );
  }

  const provided = readSyncSecret(request);
  if (!provided || provided !== expected) {
    return unauthorized();
  }

  let body: unknown = {};
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json(
      { ok: false, error: "요청 본문 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const parsed = SyncBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "요청 본문 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const attemptedAt = new Date().toISOString();
  await writeSyncStatus({
    lastAttemptAt: attemptedAt,
    lastError: null,
  });

  const result = await runLiveSync({
    publish: parsed.data?.publish,
    boundaryVersion: parsed.data?.boundaryVersion,
    datasets: parsed.data?.datasets,
    baseFrom: parsed.data?.baseFrom,
  });

  await writeSyncStatus({
    lastAttemptAt: attemptedAt,
    lastStatus: result.status,
    lastFacilityCount: result.facilityCount,
    lastPublished: result.published,
    lastSuccessAt: result.status !== "failed" ? attemptedAt : undefined,
    lastError: result.status === "failed" ? result.notes.join(" ") || "동기화 실패" : null,
  });

  return NextResponse.json({
    ok: result.status !== "failed",
    status: result.status,
    mode: result.snapshot.mode,
    referenceMonth: result.snapshot.referenceMonth,
    facilityCount: result.facilityCount,
    published: result.published,
    checksum: result.checksum,
    notes: result.notes,
    attemptedAt,
  });
}
