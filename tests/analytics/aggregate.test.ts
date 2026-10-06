import { describe, expect, it } from "vitest";
import { aggregateUsage, kstDay, type UsageDailyRow } from "@/lib/analytics/aggregate";

const row = (day: string, visitors: number, analyses = 0): UsageDailyRow => ({
  day, visitors, analyses, visits: visitors + 1, exports: 0, shares: 0,
  datasets: { "medical": analyses, "skt-living": analyses },
});

describe("privacy-minimal usage aggregation", () => {
  it("uses KST midnight instead of UTC day", () => {
    expect(kstDay(new Date("2026-10-05T14:59:59Z"))).toBe("2026-10-05");
    expect(kstDay(new Date("2026-10-05T15:00:00Z"))).toBe("2026-10-06");
  });
  it("fills missing days and includes only the selected inclusive interval", () => {
    const result = aggregateUsage([row("2026-09-06", 99), row("2026-10-05", 2, 1), row("2026-10-07", 99)],
      { period: "day", days: 30, now: new Date("2026-10-06T00:00:00Z") });
    expect(result.startDay).toBe("2026-09-07");
    expect(result.endDay).toBe("2026-10-06");
    expect(result.series).toHaveLength(30);
    expect(result.series.at(-1)?.visitors).toBe(0);
    expect(result.totals.visitors).toBe(2);
    expect(result.totals.datasets).toEqual({ medical: 1, "skt-living": 1 });
  });
  it("groups by Monday weeks and preserves visitor-days rather than inventing period unique people", () => {
    const result = aggregateUsage([row("2026-10-04", 2), row("2026-10-05", 2)],
      { period: "week", days: 30, now: new Date("2026-10-06T00:00:00Z") });
    expect(result.series.find((item) => item.day === "2026-09-28")?.visitors).toBe(2);
    expect(result.series.find((item) => item.day === "2026-10-05")?.visitors).toBe(2);
    expect(result.totals.visitors).toBe(4);
  });
  it("groups leap day and month boundaries without shifting the date", () => {
    const result = aggregateUsage([row("2024-02-29", 1), row("2024-03-01", 2)],
      { period: "month", days: 30, now: new Date("2024-03-01T00:00:00Z") });
    expect(result.series.map((item) => [item.day, item.visitors])).toEqual([["2024-02-01", 1], ["2024-03-01", 2]]);
  });
  it.each(["2026-02-30", "2026-13-01", "2026-1-01"])("rejects corrupt database dates %s", (day) => {
    expect(() => aggregateUsage([row(day, 1)], { period: "day", days: 30 })).toThrow();
  });
});
