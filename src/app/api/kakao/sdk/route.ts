import { NextResponse } from "next/server";

/**
 * Same-origin bootstrap for Kakao Maps SDK.
 * Avoids browser CORS/crossOrigin failures on the primary script tag.
 * Secondary library scripts still load from daumcdn (allowed by CSP).
 */
export async function GET(request: Request) {
  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_KEY?.trim();
  if (!appKey) {
    return new NextResponse("// NEXT_PUBLIC_KAKAO_MAP_KEY missing\n", {
      status: 503,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }

  const incoming = new URL(request.url);
  const libraries = incoming.searchParams.get("libraries") ?? "services,clusterer";

  const upstream = new URL("https://dapi.kakao.com/v2/maps/sdk.js");
  upstream.searchParams.set("appkey", appKey);
  upstream.searchParams.set("autoload", "false");
  upstream.searchParams.set("libraries", libraries);

  try {
    const response = await fetch(upstream.toString(), {
      headers: {
        Accept: "application/javascript,*/*",
        // Help Kakao domain checks when proxying from server
        Referer: process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/`
          : "https://ralphton-ai-gis-copilot.vercel.app/",
        "User-Agent": "ralphton-ai-gis-copilot/1.0",
      },
      // Revalidate hourly
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return new NextResponse(`// upstream status ${response.status}\n`, {
        status: 502,
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
      });
    }

    const body = await response.text();
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    return new NextResponse("// failed to fetch kakao sdk\n", {
      status: 502,
      headers: { "Content-Type": "application/javascript; charset=utf-8" },
    });
  }
}
