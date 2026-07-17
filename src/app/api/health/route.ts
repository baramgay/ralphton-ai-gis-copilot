import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Zero heavy deps — pure capability probe for serverless reliability. */
export async function GET() {
  return NextResponse.json({
    status: "ok",
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
    publishedLive: { available: false },
    syncOps: {
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastStatus: "idle",
      lastFacilityCount: null,
      lastError: null,
      stale: true,
      recommendSync: true,
      reason: "경량 health — 상세 동기화 상태는 /api/data/sync 참고",
    },
  });
}
