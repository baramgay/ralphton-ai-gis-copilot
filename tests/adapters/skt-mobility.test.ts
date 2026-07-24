import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { aggregateRows, finalizeDailyMean, toAdmCd2 } from "../../scripts/adapters/skt-mobility.mjs";

const COLUMNS = [
  "BASE_DATE",
  "ADM_CD",
  "RSDN_SGG_CD",
  "M00", "M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60", "M65", "M70", "M75", "M80",
  "F00", "F10", "F15", "F20", "F25", "F30", "F35", "F40", "F45", "F50", "F55", "F60", "F65", "F70", "F75", "F80",
];

// 32 band columns after RSDN_SGG_CD (16 M + 16 F).
function makeRow({ date, dong, rsdn, bandValue }: { date: string; dong: string; rsdn: string; bandValue: number }) {
  const bands = COLUMNS.slice(3).map(() => bandValue);
  return [date, dong, rsdn, ...bands].join("|");
}

describe("skt-mobility adapter", () => {
  it("joins ADM_CD(8) to adm_cd2(10) by appending '00'", () => {
    expect(toAdmCd2("48121310")).toBe("4812131000");
  });

  it("daily mean = band-sum ÷ distinct days, summing across origin-sgg rows within a day", () => {
    // dong 48121310, 2 days. Day1: two origin rows (bandValue 1 → each row sumBands = 32),
    // Day2: one origin row (bandValue 2 → sumBands = 64).
    // total band-sum = 32 + 32 + 64 = 128; distinct days = 2 → daily mean = 64.
    const lines = [
      makeRow({ date: "20250101", dong: "48121310", rsdn: "52140", bandValue: 1 }),
      makeRow({ date: "20250101", dong: "48121310", rsdn: "48250", bandValue: 1 }),
      makeRow({ date: "20250102", dong: "48121310", rsdn: "52140", bandValue: 2 }),
      // control dong with a single day
      makeRow({ date: "20250101", dong: "48730250", rsdn: "48250", bandValue: 3 }),
    ];

    const acc = aggregateRows(lines, COLUMNS);
    const mean = finalizeDailyMean(acc);

    expect(mean.get("48121310")).toBeCloseTo(64, 6); // (32+32+64)/2 days
    expect(mean.get("48730250")).toBeCloseTo(96, 6); // 32*3 / 1 day
  });

  it("ignores blank lines and non-finite fields", () => {
    const acc = aggregateRows(
      ["", makeRow({ date: "20250101", dong: "48121310", rsdn: "52140", bandValue: 1 }), ""],
      COLUMNS,
    );
    const mean = finalizeDailyMean(acc);
    expect(mean.size).toBe(1);
    expect(mean.get("48121310")).toBeCloseTo(32, 6);
  });
});
