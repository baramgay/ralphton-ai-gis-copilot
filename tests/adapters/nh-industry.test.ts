import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { aggregateRows, cleanDongCode, finalizeShares, industryGroupOf } from "../../scripts/adapters/nh-industry.mjs";

// 0 dong | 1 date | 2 업종_대 | 3 중 | 4 소 | 5 시도 | 6 시군구 | 7 농협건수 | 8 농협금액 | 9 전체건수 | 10 전체금액
function row(dong: string, industry: string, amountAll: number) {
  return `${dong},20251209,${industry},47,${industry}47620,경남,양산시,10,1000,20,${amountAll}`;
}

describe("nh-industry adapter", () => {
  it("maps 표준산업분류 대분류 codes to policy groups, ignoring the rest", () => {
    expect(industryGroupOf("I")).toBe("food"); // 숙박 및 음식점업
    expect(industryGroupOf("G")).toBe("retail"); // 도매 및 소매업
    expect(industryGroupOf("Q")).toBe("health"); // 보건업
    expect(industryGroupOf("R")).toBe("leisure"); // 예술·스포츠·여가
    expect(industryGroupOf("P")).toBe("education"); // 교육
    expect(industryGroupOf("C")).toBeNull(); // 제조업은 상권 업종군이 아니다
  });

  it("strips the BOM from the first dong code", () => {
    expect(cleanDongCode("﻿4833025300")).toBe("4833025300");
  });

  it("computes each group's share against the dong's total card sales", () => {
    const acc = aggregateRows([
      row("4833025300", "G", 500),
      row("4833025300", "I", 300),
      row("4833025300", "Q", 100),
      row("4833025300", "C", 100), // 그룹 밖이지만 분모(total)에는 들어간다
    ]);
    const shares = finalizeShares(acc.get("4833025300"));

    expect(shares.retail_share).toBeCloseTo(50, 6);
    expect(shares.food_share).toBeCloseTo(30, 6);
    expect(shares.health_share).toBeCloseTo(10, 6);
    expect(shares.leisure_share).toBeCloseTo(0, 6);
    // 5개 업종군 합이 100%가 아닌 것이 정상 — 제조·건설 등은 그룹에 없다
    const sum =
      shares.retail_share + shares.food_share + shares.health_share + shares.leisure_share + shares.education_share;
    expect(sum).toBeCloseTo(90, 6);
  });

  it("returns null shares when a dong has no sales", () => {
    const shares = finalizeShares({ total: 0, food: 0, retail: 0, health: 0, leisure: 0, education: 0 });
    expect(shares.food_share).toBeNull();
    expect(shares.retail_share).toBeNull();
  });

  it("keeps dongs separate and ignores blank or malformed rows", () => {
    const acc = aggregateRows(["", row("48", "G", 100), row("4833025300", "G", 200)]);
    expect(acc.size).toBe(1);
    expect(acc.get("4833025300").retail).toBe(200);
  });
});
