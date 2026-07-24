import type { Metadata } from "next";
import type { ReactNode } from "react";

import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/ui/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "경상남도 AI GIS 코파일럿",
    template: "%s · 경남 AI GIS",
  },
  description: "경상남도 행정동 의료·인구 접근성 분석 AI GIS 코파일럿",
  applicationName: "경남 AI GIS",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/brand-mark.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/brand-mark.svg" }],
    shortcut: ["/favicon.svg"],
  },
  openGraph: {
    title: "경상남도 AI GIS 코파일럿",
    description:
      "경상남도 305개 행정동 의료·인구 접근성 · HIRA 병원 · 자연어 분석",
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
