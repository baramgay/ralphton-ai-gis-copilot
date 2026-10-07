import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/ui/theme";

import "./pretendard.css";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: {
    default: "누리맵 — 경남 공간데이터 분석",
    template: "%s · 누리맵",
  },
  description: "경상남도 305개 행정동 공간데이터 분석 코파일럿 — 경남빅데이터허브플랫폼이 제공하는 이동통신·카드소비·신용(SKT·NH·KCB) 민간데이터와 공공데이터를 자연어로",
  applicationName: "누리맵",
  icons: {
    icon: [
      { url: "/favicon.ico?v=20261006-redesign", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { url: "/favicon-96.png?v=20261006-redesign", sizes: "96x96", type: "image/png" },
      { url: "/favicon.svg?v=20261006-redesign", sizes: "any", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-touch-icon.png?v=20261006-redesign", sizes: "180x180", type: "image/png" }],
    shortcut: ["/favicon.ico?v=20261006-redesign"],
  },
  openGraph: {
    title: "누리맵 — 경남 공간데이터 분석",
    description:
      "경상남도 305개 행정동 · SKT 생활인구 · NH 카드소비 · KCB 신용 · KOSIS 지표 · 자연어 공간분석",
    type: "website",
    locale: "ko_KR",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script
          // Prevent light flash before React hydrates theme from localStorage / system.
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
      </head>
      <body>
        <svg className="liquid-glass-defs" aria-hidden="true" focusable="false" width="0" height="0">
          <defs>
            <filter id="nurimap-glass-rim" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
              <feImage href="/liquid-glass-rim.png" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="rim" />
              <feDisplacementMap in="SourceGraphic" in2="rim" scale="-14" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
        </svg>
        {children}
      </body>
    </html>
  );
}
