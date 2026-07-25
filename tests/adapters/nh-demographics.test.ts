import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { ageGroupOf, aggregateRows, cleanDongCode, finalizeShares } from "../../scripts/adapters/nh-demographics.mjs";

// 0 dong | 1 개인/법인 | 2 date | 3 성별 | 4 연령구분 | 5-7 업종 | 8 농협건수 | 9 농협금액 | 10 전체건수 | 11 전체금액
function row(dong: string, entity: string, gender: string, band: string, amountAll: number) {
  return `${dong},${entity},20251209,${gender},${band},G,47,G47620,10,1000,20,${amountAll}`;
}

describe("nh-demographics adapter", () => {
  it("maps age band codes to policy groups, leaving under-20 and 법인 out", () => {
    expect(ageGroupOf("3.2529")).toBe("youth");
    expect(ageGroupOf("7.4549")).toBe("middle");
    expect(ageGroupOf("12.70대이상")).toBe("senior");
    expect(ageGroupOf("1.20대미만")).toBeNull();
    expect(ageGroupOf("법인")).toBeNull();
  });

  it("strips the BOM from the first dong code", () => {
    expect(cleanDongCode("﻿4812354000")).toBe("4812354000");
  });

  it("computes age shares against personal spend, not the corporate-inclusive total", () => {
    const acc = aggregateRows([
      row("4812354000", "개인", "남성", "3.2529", 300),
      row("4812354000", "개인", "여성", "7.4549", 500),
      row("4812354000", "개인", "여성", "12.70대이상", 200),
      row("4812354000", "법인", "법인", "법인", 1000), // 법인은 연령 구성비의 분모에서 빠진다
    ]);
    const shares = finalizeShares(acc.get("4812354000"));

    // personal = 1000 → 30 / 50 / 20 %
    expect(shares.youth_share).toBeCloseTo(30, 6);
    expect(shares.middle_share).toBeCloseTo(50, 6);
    expect(shares.senior_share).toBeCloseTo(20, 6);
    // 여성 = 500 + 200 = 700 → 70%
    expect(shares.female_share).toBeCloseTo(70, 6);
    // 법인 비중만 전체(개인+법인) 대비 → 1000 / 2000 = 50%
    expect(shares.corporate_share).toBeCloseTo(50, 6);
  });

  it("returns null shares when a dong has no personal spend", () => {
    const acc = aggregateRows([row("4812354000", "법인", "법인", "법인", 900)]);
    const shares = finalizeShares(acc.get("4812354000"));
    expect(shares.youth_share).toBeNull();
    expect(shares.female_share).toBeNull();
    expect(shares.corporate_share).toBeCloseTo(100, 6);
  });

  it("keeps dongs separate and ignores blank or malformed lines", () => {
    const acc = aggregateRows([
      "",
      row("48", "개인", "남성", "3.2529", 100),
      row("4812354000", "개인", "남성", "3.2529", 100),
      row("4888040000", "개인", "여성", "10.6064", 400),
    ]);
    expect(acc.size).toBe(2);
    expect(acc.get("4888040000").senior).toBe(400);
  });
});
