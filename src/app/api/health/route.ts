import { NextResponse } from "next/server";

import { readPublishedSnapshotMeta } from "@/lib/supabase/public";

export async function GET() {
  const liveMeta = await readPublishedSnapshotMeta("live");

  return NextResponse.json({
    status: "ok",
    serverTime: new Date().toISOString(),
    capabilities: {
      kakaoMapsJs: Boolean(process.env.NEXT_PUBLIC_KAKAO_MAP_KEY?.trim()),
      kakaoRest: Boolean(process.env.KAKAO_REST_API_KEY?.trim()),
      qwen: Boolean(process.env.QWEN_API_KEY?.trim() && process.env.QWEN_BASE_URL?.trim()),
      publicData: Boolean(process.env.DATA_GO_KR_SERVICE_KEY?.trim()),
      supabase: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
      ),
      dataSync: Boolean(process.env.DATA_SYNC_SECRET?.trim()),
    },
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
  });
}
