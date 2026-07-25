import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { aggregateRows, cleanDongCode, finalizeStats, normalizeHour } from "../../scripts/adapters/nh-hourly.mjs";

// 0 dong | 1 개인/법인 | 2 date | 3 시간대 | 4-6 업종 | 7 농협건수 | 8 농협금액 | 9 전체건수 | 10 전체금액
function row(dong: string, hour: string, amountAll: number) {
  return `${dong},개인,20251229,${hour},I,56,I56211,4,379000,16,${amountAll}`;
}

describe("nh-hourly adapter", () => {
  it("normalizes hours and strips the BOM", () => {
    expect(normalizeHour("9")).toBe("09");
    expect(normalizeHour("22")).toBe("22");
    expect(cleanDongCode("﻿4817075000")).toBe("4817075000");
  });

  it("splits sales into the same day/night windows the SKT day-night layer uses", () => {
    const acc = aggregateRows([
      row("4817075000", "10", 3_000_000), // day
      row("4817075000", "17", 1_000_000), // day
      row("4817075000", "23", 2_000_000), // night
      row("4817075000", "03", 1_000_000), // night (past midnight)
      row("4817075000", "20", 4_000_000), // neither bucket, but counts toward total
    ]);
    const stats = finalizeStats(acc.get("4817075000"));

    expect(stats.day_sales).toBeCloseTo(4, 6); // 백만원
    expect(stats.night_sales).toBeCloseTo(3, 6);
    // 야간 비중은 전체(19~21시 포함) 대비 → 3,000,000 / 11,000,000
    expect(stats.night_share).toBeCloseTo((3 / 11) * 100, 6);
  });

  it("returns a null night share when the dong has no sales at all", () => {
    const stats = finalizeStats({ day: 0, night: 0, total: 0 });
    expect(stats.night_share).toBeNull();
    expect(stats.day_sales).toBe(0);
  });

  it("keeps dongs separate and ignores blank or malformed rows", () => {
    const acc = aggregateRows(["", row("48", "10", 5), row("4817075000", "10", 1_000_000)]);
    expect(acc.size).toBe(1);
    expect(acc.get("4817075000").day).toBe(1_000_000);
  });
});
