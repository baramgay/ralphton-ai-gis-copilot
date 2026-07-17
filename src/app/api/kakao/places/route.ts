import { NextResponse } from "next/server";
import { z } from "zod";

import {
  KakaoRestError,
  isKakaoRestConfigured,
  searchPlacesByCategory,
  searchPlacesByKeyword,
} from "@/lib/kakao/rest";

const QuerySchema = z
  .object({
    q: z.string().trim().max(80).optional(),
    category: z.enum(["HP8", "PM9", "CS2", "SW8"]).optional(),
    lat: z.coerce.number().min(33).max(39).optional(),
    lng: z.coerce.number().min(124).max(132).optional(),
    radius: z.coerce.number().int().min(100).max(20_000).optional(),
    size: z.coerce.number().int().min(1).max(15).optional(),
  })
  .strict();

export async function GET(request: Request) {
  if (!isKakaoRestConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        places: [],
        notice: "카카오 REST 키가 없어 실시간 장소 검색을 사용할 수 없습니다. 데모 스냅샷 시설로 분석해 주세요.",
      },
      { status: 200 },
    );
  }

  const url = new URL(request.url);
  const parsed = QuerySchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    category: url.searchParams.get("category") ?? undefined,
    lat: url.searchParams.get("lat") ?? undefined,
    lng: url.searchParams.get("lng") ?? undefined,
    radius: url.searchParams.get("radius") ?? undefined,
    size: url.searchParams.get("size") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, places: [], notice: "장소 검색 조건이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const { q, category, lat, lng, radius, size } = parsed.data;

  if (!q && !category) {
    return NextResponse.json(
      { ok: false, places: [], notice: "검색어(q) 또는 카테고리(category)가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const places = category
      ? await searchPlacesByCategory({
          categoryGroupCode: category,
          lat,
          lng,
          radiusMeters: radius,
          size,
        })
      : await searchPlacesByKeyword({
          query: q!,
          lat,
          lng,
          radiusMeters: radius,
          size,
        });

    return NextResponse.json({
      ok: true,
      places,
      count: places.length,
      notice:
        places.length === 0
          ? "조건에 맞는 실시간 장소 데이터가 없습니다."
          : `카카오 로컬 검색으로 ${places.length}곳을 찾았습니다.`,
    });
  } catch (error) {
    const notice =
      error instanceof KakaoRestError
        ? error.message
        : "카카오 장소 검색에 실패했습니다.";
    return NextResponse.json({ ok: false, places: [], notice }, { status: 502 });
  }
}
