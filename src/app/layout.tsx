import type { Metadata } from "next";
import type { ReactNode } from "react";

import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/ui/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "누리맵 — 경남 공간데이터 분석",
    template: "%s · 누리맵",
  },
  description: "경상남도 305개 행정동 공간데이터 분석 코파일럿 — 이동통신·카드소비·신용(SKT·NH·KCB)과 공공데이터를 자연어로",
  applicationName: "누리맵",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/brand-mark.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/brand-mark.svg" }],
    shortcut: ["/favicon.svg"],
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
      <body>{children}</body>
    </html>
  );
}
