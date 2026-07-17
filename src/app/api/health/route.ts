import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "ok",
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
  });
}
