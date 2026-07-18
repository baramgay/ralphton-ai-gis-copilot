import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublishedLive = {
  available: boolean;
  createdAt?: string;
  source?: string;
  referenceMonth?: string | null;
  facilityCount?: number;
  mode?: string;
};

type SyncOps = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: string;
  lastFacilityCount: number | null;
  lastError: string | null;
  lastPublished?: boolean | null;
  recommendedIntervalHours?: number;
  stale: boolean;
  recommendSync: boolean;
  reason: string | null;
  hoursSincePublish?: number | null;
  hoursSinceAttempt?: number | null;
};

const DEFAULT_SYNC_OPS: SyncOps = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastStatus: "idle",
  lastFacilityCount: null,
  lastError: null,
  lastPublished: null,
  recommendedIntervalHours: 24,
  stale: true,
  recommendSync: true,
  reason: "동기화 상태를 아직 확인하지 못했습니다.",
  hoursSincePublish: null,
  hoursSinceAttempt: null,
};

/**
 * Pure capability probe + optional degraded syncOps.
 * Heavy modules load only behind try/catch so /api/health never 500s.
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

  let publishedLive: PublishedLive = { available: false };
  let syncOps: SyncOps = { ...DEFAULT_SYNC_OPS };
  let syncDetailSource: "live" | "degraded" = "degraded";

  try {
    const [{ readPublishedSnapshotMeta }, { computeStaleness, readSyncStatus }] =
      await Promise.all([
        import("@/lib/supabase/public"),
        import("@/lib/data/sync-status"),
      ]);

    const [live, local] = await Promise.all([
      readPublishedSnapshotMeta("live"),
      readSyncStatus(),
    ]);

    const publishedAt = live?.createdAt ?? local.lastSuccessAt;
    const staleness = computeStaleness(publishedAt, local);

    publishedLive = live
      ? {
          available: true,
          createdAt: live.createdAt,
          source: live.source,
          referenceMonth: live.snapshot.referenceMonth,
          facilityCount: live.snapshot.facilities.length,
          mode: live.snapshot.mode,
        }
      : { available: false };

    syncOps = {
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
    };
    syncDetailSource = "live";
  } catch {
    syncOps = {
      ...DEFAULT_SYNC_OPS,
      reason: "경량 health — 상세 동기화 상태는 /api/data/sync 참고",
    };
  }

  return NextResponse.json({
    ...base,
    publishedLive,
    syncOps,
    syncDetailSource,
  });
}
