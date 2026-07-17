import type { NextConfig } from "next";

export function buildContentSecurityPolicy(isProduction: boolean): string {
  // Kakao Maps loads secondary scripts/tiles from multiple daumcdn hosts.
  // Explicit hosts: some browsers are picky with CSP host wildcards for scripts.
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(isProduction ? [] : ["'unsafe-eval'"]),
    "https://dapi.kakao.com",
    "https://t1.daumcdn.net",
    "https://ssl.daumcdn.net",
    "https://mts.daumcdn.net",
    "https://map.kakao.com",
    "https://*.daumcdn.net",
    "https://*.kakao.com",
  ];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src ${scriptSources.join(" ")}`,
    "script-src-elem 'self' 'unsafe-inline' https://dapi.kakao.com https://t1.daumcdn.net https://ssl.daumcdn.net https://mts.daumcdn.net https://*.daumcdn.net https://*.kakao.com",
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
    "worker-src 'self' blob: https://dapi.kakao.com https://*.daumcdn.net",
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

const nextConfig: NextConfig = {
  productionBrowserSourceMaps: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
