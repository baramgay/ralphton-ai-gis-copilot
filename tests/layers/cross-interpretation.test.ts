import { describe, expect, test } from "vitest";

import type { CrossRow } from "@/lib/layers/cross-analysis";
import { buildCrossInterpretation, type CrossOperandInfo } from "@/lib/layers/cross-interpretation";

const A: CrossOperandInfo = { label: "총생활인구", unit: "명", provider: "SKT" };
const B: CrossOperandInfo = { label: "카드매출", unit: "백만원", provider: "NH" };

function row(name: string, composite: number, zA: number, zB: number, valueA = 1000, valueB = 50): CrossRow {
  return { code: "4812125000", name, composite, valueA, valueB, zA, zB };
}

describe("buildCrossInterpretation", () => {
  test("gap mode states which metric is high and which is short, with the standardized gap", () => {
    const ranked = [
      row("경상남도 창원시 의창구 동읍", 2.4, 1.8, -0.6, 42000, 120),
      row("경상남도 김해시 삼계동", 1.9, 1.5, -0.4),
      row("경상남도 양산시 물금읍", 1.5, 1.2, -0.3),
    ];
    const text = buildCrossInterpretation(ranked, A, B, "gap");

    expect(text).toContain("총생활인구(SKT) 대비 카드매출(NH)이 가장 부족한 곳");
    expect(text).toContain("창원시 의창구 동읍");
    // both operand values and their standing appear, plus the composite gap
    expect(text).toContain("42,000명");
    expect(text).toContain("120백만원");
    expect(text).toContain("2.4표준편차");
    // 보고서 표기: 명사형 종결
    expect(text.trim().endsWith("표준편차.")).toBe(true);
    // 경상남도 접두는 생략
    expect(text).not.toContain("경상남도");
  });

  test("both mode frames the result as jointly high rather than a shortfall", () => {
    const ranked = [row("경상남도 진주시 충무공동", 3.1, 1.7, 1.4, 411, 900)];
    const text = buildCrossInterpretation(ranked, A, B, "both");

    expect(text).toContain("함께 높은 곳");
    expect(text).not.toContain("부족한");
    expect(text).toContain("진주시 충무공동");
  });

  test("describes standing bands from the z-scores", () => {
    const high = buildCrossInterpretation([row("경상남도 A동", 2, 1.8, -1.5)], A, B, "gap");
    expect(high).toContain("매우 높음");
    expect(high).toContain("매우 낮음");

    const mid = buildCrossInterpretation([row("경상남도 B동", 0.1, 0.1, 0)], A, B, "gap");
    expect(mid).toContain("보통");
  });

  test("handles an empty result without inventing a ranking", () => {
    const text = buildCrossInterpretation([], A, B, "gap");
    expect(text).toContain("비교 불가");
    expect(text).toContain("총생활인구");
  });

  test("renders 데이터 없음 instead of a bogus number for null values", () => {
    const ranked: CrossRow[] = [
      { code: "4812125000", name: "경상남도 A동", composite: 1, valueA: null, valueB: 3, zA: 1, zB: 0 },
    ];
    const text = buildCrossInterpretation(ranked, A, B, "gap");
    expect(text).toContain("데이터 없음");
    expect(text).not.toContain("null");
  });
});
