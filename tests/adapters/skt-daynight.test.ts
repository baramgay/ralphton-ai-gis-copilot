import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { aggregateRows, finalizeDongStats, normalizeHour, toAdmCd2 } from "../../scripts/adapters/skt-daynight.mjs";

const COLUMNS = [
  "BASEDATE",
  "TIMEZN_CD",
  "ADMDONG_CD",
  "M00", "M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60", "M65", "M70", "M75", "M80",
  "F00", "F10", "F15", "F20", "F25", "F30", "F35", "F40", "F45", "F50", "F55", "F60", "F65", "F70", "F75", "F80",
];
const BAND_COUNT = COLUMNS.length - 3; // 32

function row(hour: string, dong: string, bandValue: number, date = "20251201") {
  return [date, hour, dong, ...Array(BAND_COUNT).fill(bandValue)].join("|");
}

describe("skt-daynight adapter", () => {
  it("joins ADMDONG_CD to adm_cd2 and normalizes single-digit hours", () => {
    expect(toAdmCd2("48170320")).toBe("4817032000");
    expect(normalizeHour("9")).toBe("09");
    expect(normalizeHour("09")).toBe("09");
  });

  it("averages day (09-18) and night (22-05) buckets per hour-row and derives the ratio", () => {
    const lines = [
      // day: two rows at 10 and 5 → mean sumBands = (32*10 + 32*5)/2 = 240
      row("10", "48170320", 10),
      row("14", "48170320", 5),
      // night: two rows at 2 and 4 → mean = (32*2 + 32*4)/2 = 96
      row("23", "48170320", 2),
      row("03", "48170320", 4),
      // 19-21 is neither bucket and must be ignored entirely
      row("20", "48170320", 1000),
    ];

    const stats = finalizeDongStats(aggregateRows(lines, COLUMNS));
    const entry = stats.get("48170320");

    expect(entry.day_population).toBeCloseTo(240, 6);
    expect(entry.night_population).toBeCloseTo(96, 6);
    expect(entry.day_night_ratio).toBeCloseTo((240 / 96) * 100, 6); // 250%
  });

  it("returns a null ratio when the dong has no night population", () => {
    const stats = finalizeDongStats(aggregateRows([row("10", "48170320", 5)], COLUMNS));
    const entry = stats.get("48170320");
    expect(entry.day_population).toBeCloseTo(32 * 5, 6);
    expect(entry.night_population).toBeNull();
    expect(entry.day_night_ratio).toBeNull();
  });

  it("keeps dongs separate and ignores blank lines", () => {
    const stats = finalizeDongStats(
      aggregateRows(["", row("10", "48170320", 1), row("10", "48730250", 3), ""], COLUMNS),
    );
    expect(stats.size).toBe(2);
    expect(stats.get("48730250").day_population).toBeCloseTo(96, 6);
  });
});
