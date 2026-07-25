import { describe, expect, test } from "vitest";

import { buildMarkdownReport, type ReportInput } from "@/lib/analysis/export-report";

const base: ReportInput = {
  title: "카드매출 순위",
  summary: "카드매출 기준 상위 3곳은 거창군 거창읍 · 진주시 충무공동 · 김해시 삼계동",
  referenceMonth: "2025-12",
  source: "NH · 카드소비",
  mode: "live",
  formulaNotes: ["카드매출 = 전체카드 이용금액 월 합계(전수화)", "가맹점 소재지 기준 상권 매출"],
  rows: Array.from({ length: 25 }, (_, index) => ({
    rank: index + 1,
    name: `테스트동${index + 1}`,
    valueLabel: `${1000 - index * 10}백만원`,
    note: "비고",
  })),
  exportedAt: "2026-07-25 16:00",
};

describe("buildMarkdownReport", () => {
  test("헤더에 기준월·출처·데이터모드를 명시한다", () => {
    const md = buildMarkdownReport(base);
    expect(md).toContain("# 카드매출 순위");
    expect(md).toContain("- 기준월: 2025-12");
    expect(md).toContain("- 자료출처: NH · 카드소비");
    expect(md).toContain("- 데이터모드: live");
    expect(md).toContain("- 작성시각: 2026-07-25 16:00");
  });

  test("상위 N개만 표로 내며 전체 모수를 함께 밝힌다", () => {
    const md = buildMarkdownReport({ ...base, topCount: 5 });
    expect(md).toContain("## 상위 5개 지역");
    expect(md).toContain("대상 행정동 25개 중 상위 5개 제시");
    expect(md).toContain("| 5 | 테스트동5 |");
    expect(md).not.toContain("테스트동6");
  });

  test("산식·한계를 각주로 옮긴다", () => {
    const md = buildMarkdownReport(base);
    expect(md).toContain("## 산식 및 해석 기준");
    expect(md).toContain("- 카드매출 = 전체카드 이용금액 월 합계(전수화)");
    expect(md).toContain("- 가맹점 소재지 기준 상권 매출");
  });

  test("절대값 단독 해석을 경계하는 유의사항을 포함한다", () => {
    const md = buildMarkdownReport(base);
    expect(md).toContain("## 유의사항");
    expect(md).toContain("비율 지표와 병행 해석 필요");
  });

  test("보고서 표기 규칙: 본문 항목은 서술식이 아닌 명사형으로 종결", () => {
    const md = buildMarkdownReport(base);
    const bullets = md.split("\n").filter((line) => line.startsWith("- "));
    expect(bullets.length).toBeGreaterThan(0);
    for (const bullet of bullets) {
      expect(bullet.trimEnd().endsWith("니다.")).toBe(false);
      expect(bullet.trimEnd().endsWith("합니다")).toBe(false);
    }
  });

  test("지역명에 파이프가 있어도 표가 깨지지 않는다", () => {
    const md = buildMarkdownReport({
      ...base,
      rows: [{ rank: 1, name: "A|B동", valueLabel: "1|2", note: "n|m" }],
    });
    expect(md).toContain("| 1 | A\\|B동 | 1\\|2 | n\\|m |");
  });

  test("순위가 없으면 표를 지어내지 않는다", () => {
    const md = buildMarkdownReport({ ...base, rows: [] });
    expect(md).toContain("- 표시할 순위 없음");
    expect(md).not.toContain("| 순위 |");
  });
});
