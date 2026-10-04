import { NextResponse } from "next/server";

import { runLiveSync } from "@/lib/data/live-sync";
import { writeSyncStatus } from "@/lib/data/sync-status";

/**
 * Vercel Cron entry: daily facility snapshot refresh.
 * Auth: Authorization Bearer CRON_SECRET (Vercel injects) or DATA_SYNC_SECRET / x-sync-secret.
 * Never echoes credentials.
 *
 * 야간 크론은 시설만 갱신한다. 인구(1,220회)·출생사망(2,440회) 백필을 함께 넣으면
 * 실행 상한을 넘겨 통째로 실패하고, 시설 갱신까지 51일 멈춘 적이 있다.
 * 인구·출생사망은 `/api/data/sync` 수동 단계 실행(`datasets`+`baseFrom:"published"`)으로
 * 이어 붙인다 — 그 경로가 이미 있다.
 */
export const maxDuration = 300;
function authorized(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const syncSecret = process.env.DATA_SYNC_SECRET?.trim();
  const auth = request.headers.get("authorization")?.trim();
  const headerSecret = request.headers.get("x-sync-secret")?.trim();

  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (syncSecret && auth === `Bearer ${syncSecret}`) return true;
  if (syncSecret && headerSecret === syncSecret) return true;
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
  await writeSyncStatus({ lastAttemptAt: attemptedAt, lastStatus: "running", lastPublished: false, lastError: null });

  let result;
  try {
    result = await runLiveSync({ publish: true, datasets: ["facilities"], baseFrom: "published" });
  } catch {
    await writeSyncStatus({ lastStatus: "failed", lastPublished: false, lastError: "자료 갱신에 실패했습니다." });
    return NextResponse.json({ ok: false, status: "failed", published: false, error: "자료 갱신에 실패했습니다." }, { status: 500 });
  }
  const succeeded = result.status !== "failed" && result.published;

  await writeSyncStatus({
    lastAttemptAt: attemptedAt,
    lastStatus: succeeded ? result.status : "failed",
    lastFacilityCount: result.facilityCount,
    lastPublished: result.published,
    ...(succeeded ? { lastSuccessAt: new Date().toISOString() } : {}),
    lastError: succeeded ? null : "자료 갱신 또는 게시에 실패했습니다.",
  });

  if (!succeeded) {
    const webhook = process.env.CRON_ALERT_WEBHOOK?.trim();
    if (webhook) {
      try {
        await fetch(webhook, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: `[누리맵] 시설 sync cron 실패 · ${attemptedAt}\n${result.notes.join(" ")}`,
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
    ok: succeeded,
    source: "cron",
    status: result.status,
    facilityCount: result.facilityCount,
    published: result.published,
    populationUpdated: result.populationUpdated ?? 0,
    referenceMonth: result.snapshot.referenceMonth,
    attemptedAt,
    notes: succeeded ? ["시설 자료를 갱신하고 게시했습니다."] : ["자료 갱신 또는 게시에 실패했습니다."],
  });
}

// Allow manual POST with same auth (ops tooling)
export async function POST(request: Request) {
  return GET(request);
}
