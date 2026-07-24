import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { aggregateRows, cleanDongCode } from "../../scripts/adapters/nh-consumption.mjs";

// NH 유입지별카드매출: 11 fields, no header, comma-separated.
// 0 dong | 1 date | 2-4 업종 | 5 시도 | 6 시군구 | 7 농협건수 | 8 농협금액 | 9 전체건수 | 10 전체금액
function row(dong: string, txnAll: number, amountAll: number) {
  return `${dong},20250917,R,91,R91139,경남,양산시,3,1000,${txnAll},${amountAll}`;
}

describe("nh-consumption adapter", () => {
  it("strips a UTF-8 BOM and non-digits from the dong code", () => {
    expect(cleanDongCode("﻿4833025300")).toBe("4833025300");
    expect(cleanDongCode('"4812557000"')).toBe("4812557000");
  });

  it("sums 전체카드이용금액 and 건수 per dong across rows (days×categories)", () => {
    const lines = [
      row("4833025300", 70.47, 171477.277),
      row("4833025300", 29.53, 28522.723), // same dong, another category/day
      row("4812557000", 10, 5000),
    ];
    const acc = aggregateRows(lines);
    const a = acc.get("4833025300");
    expect(a.sales).toBeCloseTo(200000, 3); // 171477.277 + 28522.723
    expect(a.txns).toBeCloseTo(100, 3); // 70.47 + 29.53
    expect(acc.get("4812557000").sales).toBe(5000);
  });

  it("ignores blank lines and malformed dong codes", () => {
    const acc = aggregateRows(["", row("48", 1, 1), row("4833025300", 1, 100)]);
    expect(acc.size).toBe(1);
    expect(acc.get("4833025300").sales).toBe(100);
  });
});
