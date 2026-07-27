import { describe, expect, test } from "vitest";

import { buildMarkdownReport, toNounEnding, type ReportInput } from "@/lib/analysis/export-report";

const base: ReportInput = {
  title: "카드매출 순위",
  summary: "카드매출 기준 상위 3곳은 거창군 거창읍 · 진주시 충무공동 · 김해시 삼계동",
  referenceMonth: "2025-12",
  source: "NH · 카드소비",
  mode: "live",
  formulaNotes: ["카드매출 = 전체카드 이용금액 월 합계(전수화)", "가맹점 소재지 기준 상권 매출"],
  rows: Array.from({ length: 25 }, (_, index) => ({
    rank: index + 1,
    code: `48111${String(index + 1).padStart(5, "0")}`,
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

  test("주입된 서술식 요약도 명사형으로 바꿔 싣는다", () => {
    // 요약은 화면용 문장이라 "…입니다."로 끝난다. 그대로 실으면 결과보고 양식에 어긋난다.
    const md = buildMarkdownReport({
      ...base,
      summary: "카드매출 기준 상위 3곳은 거창군 거창읍 · 진주시 천전동 · 김해시 진영읍입니다.",
    });
    expect(md).toContain("- 카드매출 기준 상위 3곳은 거창군 거창읍 · 진주시 천전동 · 김해시 진영읍.");
    expect(md).not.toContain("입니다.");
  });

  test("toNounEnding은 알려진 종결어미만 바꾸고 나머지는 건드리지 않는다", () => {
    expect(toNounEnding("상위 3곳은 A입니다.")).toBe("상위 3곳은 A.");
    expect(toNounEnding("가장 두드러집니다.")).toBe("가장 두드러짐.");
    expect(toNounEnding("의료기관 3곳을 확인하세요.")).toBe("의료기관 3곳을 확인 필요.");
    expect(toNounEnding("표시할 순위가 없습니다.")).toBe("표시할 순위가 없음.");
    // 이미 명사형인 교차 해석문은 그대로 유지
    const cross = "격차 2.7표준편차.";
    expect(toNounEnding(cross)).toBe(cross);
  });

  test("표시 상한으로 잘린 결과는 rows 길이가 아니라 실제 모수를 보고한다", () => {
    // 교차분석은 상위 30개만 ranked에 담지만 실제 비교 대상은 305개다.
    const md = buildMarkdownReport({
      ...base,
      rows: base.rows.slice(0, 30),
      totalCount: 305,
    });
    expect(md).toContain("대상 행정동 305개 중 상위 10개 제시");
    expect(md).not.toContain("대상 행정동 30개");
  });

  test("지역명에 파이프가 있어도 표가 깨지지 않는다", () => {
    const md = buildMarkdownReport({
      ...base,
      rows: [{ rank: 1, code: "4811110000", name: "A|B동", valueLabel: "1|2", note: "n|m" }],
    });
    expect(md).toContain("| 1 | A\\|B동 | 1\\|2 | n\\|m |");
  });

  test("순위가 없으면 표를 지어내지 않는다", () => {
    const md = buildMarkdownReport({ ...base, rows: [] });
    expect(md).toContain("- 표시할 순위 없음");
    expect(md).not.toContain("| 순위 |");
  });
});

describe("표기 단위", () => {
  // 시군구까지만 있는 지표(KCB 전출)나 "시군구별" 질의는 결과가 22개 시군구다.
  // 그때도 "대상 행정동 22개"라고 쓰면 22개 읍면동을 본 것처럼 읽힌다.
  const sggRows = Array.from({ length: 22 }, (_, index) => ({
    rank: index + 1,
    code: `481${String(index + 10).padStart(2, "0")}`,
    name: `테스트시${index + 1}`,
    valueLabel: `${40000 - index * 100}명`,
    note: "비고",
  }));

  test("시군구 결과는 시군구라고 쓴다", () => {
    const md = buildMarkdownReport({ ...base, rows: sggRows, totalCount: 22 });
    expect(md).toContain("대상 시군구 22개");
    expect(md).not.toContain("대상 행정동");
  });

  test("행정동 결과는 그대로 행정동이다", () => {
    const md = buildMarkdownReport(base);
    expect(md).toContain("대상 행정동");
  });
});

describe("순위 방향 표기", () => {
  // 낮은 순 결과에 "상위"라고 쓰면 정반대로 읽힌다.
  const rows = (values: number[]) =>
    values.map((v, i) => ({
      rank: i + 1,
      code: `481110${String(i).padStart(4, "0")}`,
      name: `동${i + 1}`,
      valueLabel: `${v.toLocaleString("ko-KR")}명`,
      note: "비고",
    }));

  test("내림차순이면 상위", () => {
    const md = buildMarkdownReport({ ...base, rows: rows([500, 300, 100]), totalCount: 3 });
    expect(md).toContain("상위 3개");
    expect(md).not.toContain("하위");
  });

  test("오름차순이면 하위", () => {
    const md = buildMarkdownReport({ ...base, rows: rows([100, 300, 500]), totalCount: 3 });
    // 요약문(input.summary)에는 "상위"가 들어 있을 수 있으므로 표제·건수 문구만 본다.
    expect(md).toContain("하위 3개");
    expect(md).not.toContain("상위 3개");
  });

  test("두 곳뿐이면 방향을 읽지 않는다", () => {
    const md = buildMarkdownReport({ ...base, rows: rows([100, 300]), totalCount: 2 });
    expect(md).toContain("상위 2개");
  });
});

describe("격자 단위 표기", () => {
  test("격자 코드면 격자라고 쓴다", () => {
    // 격자 코드는 "gx_gy"라 자리수로 가릴 수 없어 "행정동코드"로 나가고 있었다.
    const gridRows = [
      { rank: 1, code: "2209_3388", name: "창원시의창구 팔룡동 500m격자 21", valueLabel: "567만원/월", note: "n" },
      { rank: 2, code: "2210_3388", name: "창원시성산구 성주동 500m격자 3", valueLabel: "547만원/월", note: "n" },
      { rank: 3, code: "2211_3389", name: "양산시 물금읍 500m격자 5", valueLabel: "538만원/월", note: "n" },
    ];
    const md = buildMarkdownReport({ ...base, rows: gridRows, totalCount: 1750 });
    expect(md).toContain("대상 격자 1,750개");
  });
});
