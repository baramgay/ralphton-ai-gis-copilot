import type { NextConfig } from "next";

export function buildContentSecurityPolicy(isProduction: boolean): string {
  // Kakao Maps (t1.daumcdn.net/mapjsapi/js/main/*/kakao.js) uses eval("document.namespaces").
  // Without 'unsafe-eval' the SDK never finishes load → DemoMap fallback.
  // See wiki [[method-kakao-maps-nextjs]] / eum-jido-next kakaoMaps.ts (no CSP there).
  void isProduction;
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    "https://dapi.kakao.com",
    "https://t1.daumcdn.net",
    "https://ssl.daumcdn.net",
    "https://mts.daumcdn.net",
    "https://map.kakao.com",
    "https://*.daumcdn.net",
    "https://*.kakao.com",
  ];

  const scriptElem = scriptSources.join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src ${scriptElem}`,
    `script-src-elem ${scriptElem}`,
    "style-src 'self' 'unsafe-inline' https://t1.daumcdn.net https://ssl.daumcdn.net https://*.daumcdn.net https://*.kakao.com",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data: https://t1.daumcdn.net https://ssl.daumcdn.net https://*.daumcdn.net https://*.kakao.com",
    [
      "connect-src 'self'",
      "https://dapi.kakao.com",
      "https://*.kakao.com",
      "https://*.daum.net",
      "https://t1.daumcdn.net",
      "https://ssl.daumcdn.net",
      "https://mts.daumcdn.net",
      "https://*.daumcdn.net",
      "https://*.supabase.co",
      "wss://*.kakao.com",
    ].join(" "),
    "worker-src 'self' blob: https://dapi.kakao.com https://t1.daumcdn.net https://*.daumcdn.net",
    "child-src 'self' blob:",
    "frame-src 'self' https://*.kakao.com https://*.daum.net",
  ].join("; ");
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy(process.env.NODE_ENV === "production"),
  },
];

/**
 * public/ 아래 데이터 파일의 캐시 정책.
 *
 * Next.js 기본값은 `public, max-age=0, must-revalidate`라, 행정동 경계 3.7MB와 민간 큐브
 * 11개를 방문할 때마다 다시 받고 있었다(prod 헤더 실측). 두 종류는 갱신 방식이 달라 정책도
 * 나눈다.
 *
 * - 행정동 경계: 파일명에 판번호가 들어간다(administrative-dong-20260701.geojson).
 *   내용이 바뀌면 이름이 바뀌므로 영구 캐시해도 낡은 파일을 볼 일이 없다.
 * - 민간 큐브: 파일명이 고정이고 어댑터를 다시 돌려 배포할 때 내용이 바뀐다. CDN은
 *   배포마다 분리되니 길게 잡아도 되지만, 브라우저는 10분 뒤 다시 확인하게 둔다.
 */
const dataCacheHeaders = [
  {
    source: "/data/administrative-dong-:version.geojson",
    headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
  },
  {
    source: "/data/layers/:file*",
    headers: [
      {
        key: "Cache-Control",
        value: "public, max-age=600, s-maxage=31536000, stale-while-revalidate=86400",
      },
    ],
  },
];

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  /*
   * 스타일시트를 HTML에 실어 보낸다.
   *
   * 첫 픽셀을 막는 것은 이제 자바스크립트가 아니라 CSS다(실측: TTFB 50ms → HTML 148ms →
   * CSS 152~260ms → 첫 픽셀 312ms). 앱 셸은 이미 SSR HTML에 들어 있는데, 그것을 칠할
   * 스타일을 받으러 한 번 더 다녀오느라 100ms 넘게 흰 화면이었다.
   *
   * 대가는 있다. 스타일시트는 파일명에 해시가 들어가 영구 캐시되지만, HTML은 매번 새로
   * 받는다(`max-age=0, must-revalidate`). 즉 재방문자는 15KB(br)를 다시 받는다. 이 도구는
   * 링크로 처음 열어 보는 사람이 대부분이라 왕복 한 번을 없애는 쪽이 낫다고 판단했다.
   */
  experimental: {
    inlineCss: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
      ...dataCacheHeaders,
    ];
  },
};

export default nextConfig;
