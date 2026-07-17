import { NextResponse } from "next/server";

import { runLiveSync } from "@/lib/data/live-sync";
import { writeSyncStatus } from "@/lib/data/sync-status";

/**
 * Vercel Cron entry: daily facility snapshot refresh.
 * Auth: Authorization Bearer CRON_SECRET (Vercel injects) or DATA_SYNC_SECRET / x-sync-secret.
 * Never echoes credentials.
 */
function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const syncSecret = process.env.DATA_SYNC_SECRET?.trim();
  const auth = request.headers.get("authorization")?.trim();
  const headerSecret = request.headers.get("x-sync-secret")?.trim();
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";

  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (syncSecret && auth === `Bearer ${syncSecret}`) return true;
  if (syncSecret && headerSecret === syncSecret) return true;
  // Vercel Cron 호출: CRON_SECRET 미설정 시 DATA_SYNC_SECRET만 있으면 허용
  if (isVercelCron && syncSecret && !cronSecret) return true;
  return false;
}

export async function GET(request: Request) {
  if (!process.env.DATA_SYNC_SECRET?.trim() && !process.env.CRON_SECRET?.trim()) {
    return NextResponse.json(
      { ok: false, error: "동기화 cron이 비활성입니다. CRON_SECRET 또는 DATA_SYNC_SECRET을 설정하세요." },
      { status: 503 },
    );
  }

  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "권한이 없습니다." }, { status: 401 });
  }

  const attemptedAt = new Date().toISOString();
  await writeSyncStatus({ lastAttemptAt: attemptedAt, lastError: null });

  const result = await runLiveSync({ publish: true });

  await writeSyncStatus({
    lastAttemptAt: attemptedAt,
    lastStatus: result.status,
    lastFacilityCount: result.facilityCount,
    lastPublished: result.published,
    lastSuccessAt: result.status !== "failed" ? attemptedAt : undefined,
    lastError: result.status === "failed" ? result.notes.join(" ") || "동기화 실패" : null,
  });

  if (result.status === "failed") {
    const webhook = process.env.CRON_ALERT_WEBHOOK?.trim();
    if (webhook) {
      try {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `[랄프톤] 시설 sync cron 실패 · ${attemptedAt}\n${result.notes.join(" ")}`,
            status: result.status,
            attemptedAt,
            notes: result.notes,
          }),
          signal: AbortSignal.timeout(8_000),
        });
      } catch {
        /* alert best-effort */
      }
    }
  }

  return NextResponse.json({
    ok: result.status !== "failed",
    source: "cron",
    status: result.status,
    facilityCount: result.facilityCount,
    published: result.published,
    populationUpdated: result.populationUpdated ?? 0,
    referenceMonth: result.snapshot.referenceMonth,
    attemptedAt,
    notes: result.notes,
  });
}

// Allow manual POST with same auth (ops tooling)
export async function POST(request: Request) {
  return GET(request);
}
