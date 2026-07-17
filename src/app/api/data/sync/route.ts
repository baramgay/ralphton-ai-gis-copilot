import { NextResponse } from "next/server";
import { z } from "zod";

import { runLiveSync } from "@/lib/data/live-sync";

const SyncBodySchema = z
  .object({
    publish: z.boolean().optional(),
    boundaryVersion: z.string().regex(/^\d{8}$/).optional(),
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
  return NextResponse.json({
    ok: true,
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

  const result = await runLiveSync({
    publish: parsed.data?.publish,
    boundaryVersion: parsed.data?.boundaryVersion,
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
  });
}
