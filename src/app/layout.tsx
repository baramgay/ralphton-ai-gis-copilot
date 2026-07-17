import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "부산 AI GIS 코파일럿",
    template: "%s · 부산 AI GIS",
  },
  description: "부산 행정동 의료·인구 접근성 분석 AI GIS 코파일럿",
  applicationName: "부산 AI GIS",
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/brand-mark.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/brand-mark.svg" }],
    shortcut: ["/favicon.svg"],
  },
  openGraph: {
    title: "부산 AI GIS 코파일럿",
    description: "부산 행정동 의료·인구 접근성 분석",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
