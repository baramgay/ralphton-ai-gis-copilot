import { describe, expect, test } from "vitest";

import { buildHwpHtmlReport } from "@/lib/analysis/export-hwp";
import type { ReportInput } from "@/lib/analysis/export-report";

const base: ReportInput = {
  title: "카드매출 순위",
  summary: "카드매출 기준 상위 3곳은 거창군 거창읍 · 진주시 천전동입니다.",
  referenceMonth: "2025-12",
  source: "NH · 카드소비",
  mode: "live",
  formulaNotes: ["카드매출 = 전체카드 이용금액 월 합계(전수화)"],
  rows: Array.from({ length: 25 }, (_, index) => ({
    rank: index + 1,
    code: `48111${String(index + 1).padStart(5, "0")}`,
    name: `테스트동${index + 1}`,
    valueLabel: `${1000 - index * 10}백만원`,
    note: "비고",
  })),
  exportedAt: "2026-07-26 00:30",
};

describe("buildHwpHtmlReport", () => {
  test("한글이 표로 인식하는 table 마크업을 만든다", () => {
    const html = buildHwpHtmlReport(base);
    expect(html).toContain("<table");
    expect(html).toContain("border-collapse:collapse");
    expect(html).toContain("<th");
    // 표 본문에 순위·지역·값이 셀로 들어간다
    expect(html).toContain("테스트동1");
    expect(html).toContain("1000백만원");
  });

  test("charset과 한글 기본 글꼴을 명시해 인코딩·서식이 깨지지 않게 한다", () => {
    const html = buildHwpHtmlReport(base);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("맑은 고딕");
  });

  test("요약을 명사형으로 정규화해 싣는다", () => {
    const html = buildHwpHtmlReport(base);
    expect(html).toContain("진주시 천전동.");
    expect(html).not.toContain("입니다.");
  });

  test("표시 상한이 아니라 실제 대상 건수를 보고한다", () => {
    const html = buildHwpHtmlReport({ ...base, rows: base.rows.slice(0, 30), totalCount: 305 });
    expect(html).toContain("대상 행정동 305개 중 상위 10개 제시");
  });

  test("상위 N개만 표에 담는다", () => {
    const html = buildHwpHtmlReport({ ...base, topCount: 5 });
    expect(html).toContain("상위 5개 지역");
    expect(html).toContain("테스트동5");
    expect(html).not.toContain("테스트동6");
  });

  test("HTML 특수문자가 든 지역명도 마크업을 깨뜨리지 않는다", () => {
    const html = buildHwpHtmlReport({
      ...base,
      rows: [{ rank: 1, code: "4811110000", name: "<script>동", valueLabel: "1 & 2", note: '"비고"' }],
    });
    expect(html).toContain("&lt;script&gt;동");
    expect(html).toContain("1 &amp; 2");
    expect(html).not.toContain("<script>동");
  });

  test("순위가 없으면 빈 표를 지어내지 않는다", () => {
    const html = buildHwpHtmlReport({ ...base, rows: [] });
    expect(html).toContain("표시할 순위 없음");
    expect(html).not.toContain("<table");
  });

  test("산식·유의사항을 각각 항목으로 싣는다", () => {
    const html = buildHwpHtmlReport(base);
    expect(html).toContain("산식 및 해석 기준");
    expect(html).toContain("카드매출 = 전체카드 이용금액 월 합계(전수화)");
    expect(html).toContain("유의사항");
    expect(html).toContain("비율 지표와 병행 해석 필요");
  });
});
