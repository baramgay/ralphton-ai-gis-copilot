import type { NextConfig } from "next";

export function buildContentSecurityPolicy(isProduction: boolean): string {
  // Kakao Maps loads secondary scripts/tiles from multiple daumcdn hosts.
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(isProduction ? [] : ["'unsafe-eval'"]),
    "https://dapi.kakao.com",
    "https://t1.daumcdn.net",
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
    "style-src 'self' 'unsafe-inline' https://*.daumcdn.net https://*.kakao.com",
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data: https://*.daumcdn.net https://*.kakao.com",
    [
      "connect-src 'self'",
      "https://*.kakao.com",
      "https://*.daum.net",
      "https://*.daumcdn.net",
      "https://dapi.kakao.com",
      "https://*.supabase.co",
      "wss://*.kakao.com",
    ].join(" "),
    "worker-src 'self' blob:",
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
