import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { aggregateLivingRows, finalizeDongStats, toAdmCd2 } from "../../scripts/adapters/skt-living.mjs";

const COLUMNS = [
  "BASEDATE",
  "TIMEZN_CD",
  "ADMDONG_CD",
  "M00", "M10", "M15", "M20", "M25", "M30", "M35", "M40", "M45", "M50", "M55", "M60", "M65", "M70", "M75", "M80",
  "F00", "F10", "F15", "F20", "F25", "F30", "F35", "F40", "F45", "F50", "F55", "F60", "F65", "F70", "F75", "F80",
];

// 32 numeric columns after ADMDONG_CD (16 M bands + 16 F bands).
function makeRow({ date, hour, dong, allBandsValue, elderlyBandsValue }: {
  date: string;
  hour: string;
  dong: string;
  allBandsValue: number;
  elderlyBandsValue: number;
}) {
  const numericColumns = COLUMNS.slice(3);
  const values = numericColumns.map((name) => {
    const isElderly = name === "M65" || name === "M70" || name === "M75" || name === "M80" ||
      name === "F65" || name === "F70" || name === "F75" || name === "F80";
    return isElderly ? elderlyBandsValue : allBandsValue;
  });
  return [date, hour, dong, ...values].join("|");
}

describe("skt-living adapter", () => {
  it("joins ADMDONG_CD to adm_cd2 by appending '00'", () => {
    expect(toAdmCd2("48170320")).toBe("4817032000");
  });

  it("computes living_total as the day×hour mean of the sumBands per dong", () => {
    // 2 dong x 2 days x 2 hours = 8 rows. Each numeric column has 32 columns,
    // 24 "regular" bands at 10 and 8 "elderly" bands at 5, so sumBands = 24*10 + 8*5 = 280 per row.
    const lines = [
      makeRow({ date: "20250101", hour: "00", dong: "48170320", allBandsValue: 10, elderlyBandsValue: 5 }),
      makeRow({ date: "20250101", hour: "01", dong: "48170320", allBandsValue: 10, elderlyBandsValue: 5 }),
      makeRow({ date: "20250102", hour: "00", dong: "48170320", allBandsValue: 10, elderlyBandsValue: 5 }),
      makeRow({ date: "20250102", hour: "01", dong: "48170320", allBandsValue: 20, elderlyBandsValue: 10 }),
      makeRow({ date: "20250101", hour: "00", dong: "48730250", allBandsValue: 1, elderlyBandsValue: 1 }),
      makeRow({ date: "20250101", hour: "01", dong: "48730250", allBandsValue: 1, elderlyBandsValue: 1 }),
      makeRow({ date: "20250102", hour: "00", dong: "48730250", allBandsValue: 1, elderlyBandsValue: 1 }),
      makeRow({ date: "20250102", hour: "01", dong: "48730250", allBandsValue: 1, elderlyBandsValue: 1 }),
    ];

    const acc = aggregateLivingRows(lines, COLUMNS);
    const stats = finalizeDongStats(acc);

    // dong 48170320: 3 rows with sumBands=280, 1 row with sumBands=24*20+8*10=560 -> mean = (280*3+560)/4 = 350
    const first = stats.get("48170320");
    expect(first).toBeDefined();
    expect(first!.living_total).toBeCloseTo(350, 6);
    // elderly: 3 rows elderly=8*5=40, 1 row elderly=8*10=80 -> total elderly=200, total sumBands=1400 -> ratio = 200/1400*100
    expect(first!.elderly_ratio).toBeCloseTo((200 / 1400) * 100, 6);

    // dong 48730250: all rows sumBands = 32 (24*1+8*1), elderly = 8
    const second = stats.get("48730250");
    expect(second).toBeDefined();
    expect(second!.living_total).toBeCloseTo(32, 6);
    expect(second!.elderly_ratio).toBeCloseTo((8 / 32) * 100, 6);
  });

  it("returns a null elderly_ratio when the dong has zero total population", () => {
    const zeroColumns = COLUMNS;
    const numericColumns = zeroColumns.slice(3);
    const zeroRow = ["20250101", "00", "48170320", ...numericColumns.map(() => 0)].join("|");
    const acc = aggregateLivingRows([zeroRow], zeroColumns);
    const stats = finalizeDongStats(acc);
    const entry = stats.get("48170320");
    expect(entry).toBeDefined();
    expect(entry!.living_total).toBe(0);
    expect(entry!.elderly_ratio).toBeNull();
  });

  it("ignores blank lines", () => {
    const acc = aggregateLivingRows(["", makeRow({ date: "20250101", hour: "00", dong: "48170320", allBandsValue: 1, elderlyBandsValue: 1 }), ""], COLUMNS);
    const stats = finalizeDongStats(acc);
    expect(stats.size).toBe(1);
  });
});
