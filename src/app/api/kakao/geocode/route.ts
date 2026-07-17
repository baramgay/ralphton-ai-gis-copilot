import { NextResponse } from "next/server";
import { z } from "zod";

import {
  KakaoRestError,
  coordToRegion,
  isKakaoRestConfigured,
  searchAddress,
} from "@/lib/kakao/rest";

const QuerySchema = z
  .object({
    q: z.string().trim().min(1).max(120).optional(),
    lat: z.coerce.number().min(33).max(39).optional(),
    lng: z.coerce.number().min(124).max(132).optional(),
  })
  .strict();

export async function GET(request: Request) {
  if (!isKakaoRestConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        results: [],
        notice: "카카오 REST 키가 없어 주소 변환을 사용할 수 없습니다.",
      },
      { status: 200 },
    );
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    lat: url.searchParams.get("lat") ?? undefined,
    lng: url.searchParams.get("lng") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, results: [], notice: "주소 변환 조건이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.q) {
      const results = await searchAddress(parsed.data.q);
      return NextResponse.json({
        ok: true,
        results,
        notice:
          results.length === 0
            ? "일치하는 주소 데이터가 없습니다."
            : `${results.length}건의 주소를 찾았습니다.`,
      });
    }

    if (parsed.data.lat != null && parsed.data.lng != null) {
      const region = await coordToRegion(parsed.data.lat, parsed.data.lng);
      return NextResponse.json({
        ok: true,
        results: region ? [region] : [],
        notice: region
          ? "좌표를 행정구역 정보로 변환했습니다."
          : "해당 좌표의 행정구역 데이터가 없습니다.",
      });
    }

    return NextResponse.json(
      { ok: false, results: [], notice: "q 또는 lat·lng가 필요합니다." },
      { status: 400 },
    );
  } catch (error) {
    const notice =
      error instanceof KakaoRestError ? error.message : "주소 변환에 실패했습니다.";
    return NextResponse.json({ ok: false, results: [], notice }, { status: 502 });
  }
}
