import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight health — keep imports minimal so serverless cold start stays reliable.
 * Optional modules loaded dynamically inside try/catch.
 */
export async function GET() {
  const base = {
    status: "ok" as const,
    serverTime: new Date().toISOString(),
    capabilities: {
      kakaoMapsJs: Boolean(process.env.NEXT_PUBLIC_KAKAO_MAP_KEY?.trim()),
      kakaoRest: Boolean(process.env.KAKAO_REST_API_KEY?.trim()),
      qwen: Boolean(process.env.QWEN_API_KEY?.trim() && process.env.QWEN_BASE_URL?.trim()),
      publicData: Boolean(process.env.DATA_GO_KR_SERVICE_KEY?.trim()),
      hiraHosp: Boolean(
        process.env.HIRA_HOSP_SERVICE_KEY?.trim() || process.env.DATA_GO_KR_SERVICE_KEY?.trim(),
      ),
      supabase: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
      ),
      dataSync: Boolean(process.env.DATA_SYNC_SECRET?.trim()),
      cronAlert: Boolean(process.env.CRON_ALERT_WEBHOOK?.trim()),
      populationLive:
        Boolean(process.env.DATA_GO_KR_SERVICE_KEY?.trim()) &&
        process.env.LIVE_POPULATION_DISABLED?.trim() !== "1",
      ragRemoteEmbed:
        process.env.RAG_REMOTE_EMBED?.trim() === "1" ||
        Boolean(process.env.QWEN_EMBED_MODEL?.trim()),
      rag: true,
      placeIndex: true,
      scopeBusanGyeongnam: true,
    },
    scope: {
      regions: ["부산광역시", "경상남도"],
      hospitalApi: "hira/hospInfoServicev2",
      hiraSidoCd: ["210000", "380000"],
      populationCtpv: ["26", "48"],
    },
  };

  try {
    const { computeStaleness, readSyncStatus } = await import("@/lib/data/sync-status");
    const { readPublishedSnapshotMeta } = await import("@/lib/supabase/public");

    const liveMeta = await readPublishedSnapshotMeta("live");
    const syncLocal = await readSyncStatus();
    const publishedAt = liveMeta?.createdAt ?? syncLocal.lastSuccessAt;
    const staleness = computeStaleness(publishedAt, syncLocal);

    return NextResponse.json({
      ...base,
      publishedLive: liveMeta
        ? {
            available: true,
            createdAt: liveMeta.createdAt,
            source: liveMeta.source,
            referenceMonth: liveMeta.snapshot.referenceMonth,
            mode: liveMeta.snapshot.mode,
            facilityCount: liveMeta.snapshot.facilities.length,
            regionCount: liveMeta.snapshot.regions.length,
            checksum: liveMeta.checksum,
          }
        : { available: false },
      syncOps: {
        lastAttemptAt: syncLocal.lastAttemptAt,
        lastSuccessAt: syncLocal.lastSuccessAt,
        lastStatus: syncLocal.lastStatus,
        lastFacilityCount: syncLocal.lastFacilityCount,
        lastError: syncLocal.lastError,
        stale: staleness.stale,
        recommendSync: staleness.recommendSync,
        reason: staleness.reason,
      },
    });
  } catch (error) {
    // Still report capabilities if optional deps fail on cold start.
    return NextResponse.json({
      ...base,
      publishedLive: { available: false },
      syncOps: {
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastStatus: "idle",
        lastFacilityCount: null,
        lastError: error instanceof Error ? error.message : "optional health deps failed",
        stale: true,
        recommendSync: true,
        reason: "동기화 상태 조회 실패 — 기본 상태만 반환",
      },
      degraded: true,
    });
  }
}
