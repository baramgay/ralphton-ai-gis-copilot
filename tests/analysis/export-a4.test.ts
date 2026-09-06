import { describe, expect, test } from "vitest";

import { buildA4HtmlReport } from "@/lib/analysis/export-a4";
import type { ReportInput } from "@/lib/analysis/export-report";

const base: ReportInput = {
  title: "주민 만명당 화재 순위",
  summary: "주민 만명당 화재 기준 상위 3곳은 산청군·의령군·하동군입니다.",
  referenceMonth: "2025-12",
  source: "KOSIS 국가통계",
  mode: "live",
  formulaNotes: [
    "주민 만명당 화재 = 화재발생 건수 ÷ 주민등록인구 × 10,000",
    "창원시는 원자료가 시 단위라 5개 구가 같은 값을 갖는다(구별 자료가 아니다)",
  ],
  rows: Array.from({ length: 22 }, (_, i) => ({
    rank: i + 1,
    code: `481${String(i).padStart(2, "0")}`,
    name: `지역${i + 1}`,
    valueLabel: `${(40 - i).toFixed(1)}건/만명`,
    note: "비고",
  })),
  totalCount: 22,
  exportedAt: "2026-09-04",
};

const html = (over: Partial<ReportInput> = {}) => buildA4HtmlReport({ ...base, ...over });

describe("A4 인쇄 보고서", () => {
  test("A4 세로로 쪽을 잡는다", () => {
    expect(html()).toContain("size: A4 portrait");
  });

  test("표가 쪽을 넘어가도 둘째 쪽에 열 이름이 있다", () => {
    // 없으면 두 쪽째부터 무슨 열인지 알 수 없는 표가 된다.
    expect(html()).toContain("thead { display: table-header-group; }");
  });

  test("한 지역의 값이 쪽 경계에서 반으로 잘리지 않는다", () => {
    expect(html()).toContain("tr { break-inside: avoid; }");
  });

  test("인쇄본은 화면 테마를 따르지 않는다", () => {
    /*
     * 기본 화면이 어둡다. 그 색을 그대로 인쇄하면 토너를 붓거나(배경 인쇄 켬) 흰 글씨가
     * 흰 종이에 찍힌다(끔). 보고서는 늘 흰 바탕·검은 글씨다.
     */
    const out = html();
    expect(out).toContain("color-scheme: light");
    expect(out).toContain("background: #fff");
    expect(out).not.toContain("data-theme");
  });

  test("산식과 한계를 함께 싣는다", () => {
    const out = html();
    expect(out).toContain("화재발생 건수 ÷ 주민등록인구");
    expect(out).toContain("구별 자료가 아니다");
  });

  test("서술식을 개조식으로 바꾼다", () => {
    // 공공기관 결과보고는 명사형 종결이 원칙이다.
    expect(html()).not.toContain("하동군입니다");
  });

  test("표가 잘리면 모수를 밝힌다", () => {
    /*
     * 적지 않으면 20행이 전부인 줄 알고 "경남 20개 지역 중 1위"처럼 모수를 잘못 인용한다.
     */
    const out = html({ totalCount: 305 });
    expect(out).toContain("305개");
    expect(out).toContain("20개만 표에 수록");
  });

  test("잘리지 않았으면 잘렸다고 하지 않는다", () => {
    expect(html({ rows: base.rows.slice(0, 5), totalCount: 5 })).not.toContain("표에 수록");
  });

  test("단위는 한 행이 아니라 전체 행으로 가린다", () => {
    // 시군구 결과에 읍면동 코드가 하나 섞이면 「행정동」이 맞다.
    const mixed = [
      { rank: 1, code: "48170", name: "진주시", valueLabel: "1", note: "" },
      { rank: 2, code: "4817025000", name: "문산읍", valueLabel: "2", note: "" },
    ];
    expect(html({ rows: mixed, totalCount: 2 })).toContain("개 행정동");
    expect(html({ rows: [mixed[0]], totalCount: 1 })).toContain("개 시군구");
  });

  test("답하지 못했다는 경고가 각주에 그대로 실린다", () => {
    const out = html({ formulaNotes: ["⚠ 마지막 질의에는 답하지 못했습니다.", "산식"] });
    expect(out).toContain("답하지 못했습니다");
  });

  test("사용자 문자열을 HTML로 해석하지 않는다", () => {
    const out = html({ title: '<script>alert(1)</script>' });
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
  });

  test("자료 성격을 우리말로 적는다 — 보고서에 영문 상태값을 싣지 않는다", () => {
    expect(html({ mode: "live" })).toContain("실데이터");
    expect(html({ mode: "live" })).not.toMatch(/·\s*live\s*·/);
    expect(html({ mode: "demo" })).toContain("시연 데이터");
  });

  test("합성 인구 순위의 머리글이 실데이터라고 단정하지 않는다", () => {
    const out = html({
      title: "고령화율이 높은 지역",
      source: "supabase-cache",
      mode: "live",
      sourceNotes: [
        "인구·세대·출생·사망 값은 합성값이며 실제 주민등록 통계가 아닙니다.",
        "인구·세대 시계열은 검증된 기준 스냅샷을 유지합니다.",
      ],
      populationDerived: true,
    });
    expect(out).toContain("시설 실데이터");
    expect(out).not.toContain("supabase-cache");
    expect(out).not.toMatch(/·\s*live\s*·/);
    expect(out).toContain("인구·세대·출생·사망은 합성값이라 대외 수치로 인용하지 마세요.");
  });

  test("모르는 값은 지어내지 않고 그대로 적는다", () => {
    expect(html({ mode: "partial" })).toContain("partial");
  });

  test("파일 제목에 누리맵-보고서와 기준월이 실린다", () => {
    expect(html()).toContain("<title>누리맵-보고서-2025-12 — ");
  });

  test("printOnLoad면 열자마자 인쇄 대화상자를 연다", () => {
    expect(html()).not.toContain("window.print()");
    expect(buildA4HtmlReport(base, { printOnLoad: true })).toContain("window.print()");
  });
});
