import { expect, it } from "vitest";
import { rankedToCsv, facilitiesToCsv } from "@/lib/analysis/export-csv";
import { buildMarkdownReport, type ReportInput } from "@/lib/analysis/export-report";
import { buildA4HtmlReport } from "@/lib/analysis/export-a4";
import { buildHwpHtmlReport } from "@/lib/analysis/export-hwp";
import { buildSlideHtml } from "@/lib/analysis/export-slide";

const notes = [
  "행정안전부 주민등록 인구통계 공식 CSV: 2025-09~2026-09, 경남 305개 행정동 전수.",
  "주민등록 인구는 매월 말일 기준이며 외국인은 제외합니다. 1인세대는 주민등록 세대 기준으로 통계청 1인가구와 다릅니다.",
  "출생등록·사망말소는 등록·말소 처리월 기준으로 출생·사망 사건 발생월과 다릅니다.",
  "공식 출처: https://jumin.mois.go.kr/ (행정안전부 주민등록 인구통계)",
  "HIRA 병원정보서비스(v2)로 경남 시설 4254곳을 갱신했습니다.",
];
const input: ReportInput = {
  title: "자연증가 순위", summary: "주민등록 통계를 분석했습니다.", referenceMonth: "2026-09",
  source: "supabase-cache", sourceNotes: notes, mode: "live", populationDerived: true, formulaNotes: [],
  rows: [{ rank: 1, code: "4817051000", name: "진주시 중앙동", valueLabel: "10명", note: "출생등록 − 사망말소" }],
};

it.each([
  ["CSV", () => rankedToCsv(input.title, input.referenceMonth, input.source, input.mode, input.rows, input)],
  ["Markdown", () => buildMarkdownReport(input)],
  ["A4", () => buildA4HtmlReport(input)],
  ["HWP", () => buildHwpHtmlReport(input)],
  ["slide", () => buildSlideHtml(input)],
] as const)("%s preserves official definitions and origin independently of the cache storage name", (_name, render) => {
  const output = render();
  expect(output).toContain("행정안전부 주민등록 인구통계");
  expect(output).toContain("https://jumin.mois.go.kr/");
  expect(output).toContain("통계청 1인가구와 다릅니다");
  expect(output).toContain("출생·사망 사건 발생월과 다릅니다");
  expect(output).not.toContain("supabase-cache");
  expect(output).not.toContain("합성값이라");
});

it("does not attach population definitions to independent private data or facility exports", () => {
  const privateReport = buildA4HtmlReport({ ...input, title: "카드매출 순위", populationDerived: false, source: "NH" });
  const facilities = facilitiesToCsv("시설", "2026-09", "supabase-cache", "live", [], input);
  expect(privateReport).not.toContain("통계청 1인가구와 다릅니다");
  expect(facilities).not.toContain("출생·사망 사건 발생월과 다릅니다");
});
