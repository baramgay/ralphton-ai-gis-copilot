import { describe, expect, test } from "vitest";

import type { ReportInput } from "@/lib/analysis/export-report";
import { buildSlideHtml } from "@/lib/analysis/export-slide";

const base: ReportInput = {
  title: "카드매출 순위",
  summary: "카드매출 기준 상위 3곳은 거창군 거창읍 · 진주시 천전동입니다.",
  referenceMonth: "2025-12",
  source: "NH · 카드소비",
  mode: "live",
  formulaNotes: ["카드매출 = 전체카드 이용금액 월 합계(전수화)"],
  rows: Array.from({ length: 25 }, (_, index) => ({
    rank: index + 1,
    name: `테스트동${index + 1}`,
    valueLabel: `${1000 - index * 10}백만원`,
    note: "비고",
  })),
  exportedAt: "2026-07-26 01:00",
};

describe("buildSlideHtml", () => {
  test("표지·핵심결과·근거 3장으로 나눈다", () => {
    const html = buildSlideHtml(base);
    expect(html.match(/class="slide"/g)).toHaveLength(3);
    expect(html).toContain("카드매출 순위");
    expect(html).toContain("상위 8개 지역");
    expect(html).toContain("산식 및 해석 기준");
  });

  test("가로 A4로 인쇄되도록 페이지를 설정한다", () => {
    const html = buildSlideHtml(base);
    expect(html).toContain("@page { size: A4 landscape");
    expect(html).toContain("page-break-after: always");
  });

  test("표지 요약을 명사형으로 정규화한다", () => {
    const html = buildSlideHtml(base);
    expect(html).toContain("진주시 천전동.");
    expect(html).not.toContain("입니다.");
  });

  test("모든 장에 출처와 기준월을 남긴다", () => {
    const html = buildSlideHtml(base);
    expect(html.match(/NH · 카드소비 · 기준월 2025-12/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test("표시 상한이 아니라 실제 대상 건수를 밝힌다", () => {
    const html = buildSlideHtml({ ...base, rows: base.rows.slice(0, 30), totalCount: 305 });
    expect(html).toContain("대상 행정동 305개 중 상위 8개");
  });

  test("HTML 특수문자가 마크업을 깨뜨리지 않는다", () => {
    const html = buildSlideHtml({
      ...base,
      rows: [{ rank: 1, name: "<b>동", valueLabel: "1 & 2", note: '"비고"' }],
    });
    expect(html).toContain("&lt;b&gt;동");
    expect(html).toContain("1 &amp; 2");
    expect(html).not.toContain("<b>동");
  });

  test("순위가 없으면 빈 행을 지어내지 않는다", () => {
    const html = buildSlideHtml({ ...base, rows: [] });
    expect(html).toContain("표시할 순위 없음");
    expect(html).toContain("상위 0개 지역");
  });
});
