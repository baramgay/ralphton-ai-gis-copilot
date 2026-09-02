import { describeEndpoint } from "@/lib/ai/llm";
import { readAiLastOutcome } from "@/lib/ai/last-outcome";
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
  const aiEndpoint = describeEndpoint(process.env.DEEPSEEK_BASE_URL);
  const base = {
    status: "ok" as const,
    serverTime: new Date().toISOString(),
    capabilities: {
      kakaoMapsJs: Boolean(process.env.NEXT_PUBLIC_KAKAO_MAP_KEY?.trim()),
      kakaoRest: Boolean(process.env.KAKAO_REST_API_KEY?.trim()),
      /*
       * "키가 있다"가 아니라 "실제로 붙을 수 있다"로 판정한다. 예전 기준(키+주소 존재)은
       * 주소가 허용 목록 밖이어서 호출이 매번 즉시 실패하는 동안에도 켜짐으로 보였고,
       * 상태표가 그 고장을 몇 달간 가려 주었다.
       */
      ai: aiEndpoint.ok && Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
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
      /*
       * 원격 임베딩은 채팅 제공자와 다른 곳이다(현재 채팅 제공자에는 임베딩이 없다).
       * 켜짐으로 적으려면 그 전용 자격증명이 실제로 있어야 한다.
       */
      ragRemoteEmbed:
        (process.env.RAG_REMOTE_EMBED?.trim() === "1" ||
          Boolean(process.env.EMBED_MODEL?.trim())) &&
        Boolean(process.env.EMBED_API_KEY?.trim() && process.env.EMBED_BASE_URL?.trim()),
      rag: true,
      placeIndex: true,
      scopeGyeongnam: true,
    },
    /** 켜지지 않은 이유. 제공사·모델·키가 드러나지 않는 낱말만 쓴다. */
    aiIssue: aiEndpoint.ok
      ? process.env.DEEPSEEK_API_KEY?.trim()
        ? null
        : "credential_missing"
      : aiEndpoint.code,
    /*
     * 설정이 아니라 실제로 걸어 본 결과. 이 인스턴스가 아직 한 번도 안 걸었으면
     * "unknown"이고, 그 모름도 사실대로 적는다.
     */
    aiLastOutcome: readAiLastOutcome(),
    scope: {
      regions: ["경상남도"],
      hospitalApi: "hira/hospInfoServicev2",
      hiraSidoCd: ["380000"],
      populationCtpv: ["48"],
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
          createdAt: live.createdAt ?? undefined,
          source: live.source ?? undefined,
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
