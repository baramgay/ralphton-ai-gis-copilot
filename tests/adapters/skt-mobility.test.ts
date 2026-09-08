import { describe, expect, it } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { aggregateRows, computeColumnIndices, finalizeDailyMean, isSameSgg, toAdmCd2 } from "../../scripts/adapters/skt-mobility.mjs";

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

  /*
   * 원자료는 출발지를 시군구까지만 준다. 그래서 그 동이 속한 시군구에 사는 사람의 체류가
   * 「유입」 행으로 같이 들어온다 — 2025-12 동 파일 실측으로 밴드합의 73.2%였다. 그대로
   * 더하면 「유입인구」라 적어 놓고 생활인구 총량을 세게 되고, 순위가 밖에서 오는 사람이
   * 아니라 도시 크기를 따라간다.
   */
  it("관내(같은 시군구 거주) 행은 유입·유출로 세지 않는다", () => {
    const lines = [
      // 48121310 동의 시군구는 48121. 같은 48121 거주자는 유입이 아니다.
      makeRow({ date: "20250101", dong: "48121310", rsdn: "48121", bandValue: 5 }),
      makeRow({ date: "20250101", dong: "48121310", rsdn: "48250", bandValue: 1 }),
    ];
    const mean = finalizeDailyMean(aggregateRows(lines, COLUMNS));
    expect(mean.get("48121310")).toBeCloseTo(32, 6); // 관외 1행(32)만
  });

  /*
   * 관내 행만 있는 날을 분모에서 빼면 일수가 줄어 일평균이 부풀려진다. 값은 빼되 날짜는
   * 남긴다.
   */
  it("관내만 있는 날도 분모(일수)에는 센다", () => {
    const lines = [
      makeRow({ date: "20250101", dong: "48121310", rsdn: "48250", bandValue: 1 }),
      makeRow({ date: "20250102", dong: "48121310", rsdn: "48121", bandValue: 9 }),
    ];
    const mean = finalizeDailyMean(aggregateRows(lines, COLUMNS));
    expect(mean.get("48121310")).toBeCloseTo(16, 6); // 32 ÷ 2일
  });

  it("유출 파일은 기준 동이 RSDN_ADM_CD, 상대가 SGG_CD다", () => {
    const outflowColumns = ["BASE_DATE", "RSDN_ADM_CD", "SGG_CD", ...COLUMNS.slice(3)];
    const indices = computeColumnIndices(outflowColumns);
    expect(indices.admIdx).toBe(1);
    expect(indices.partnerIdx).toBe(2);
  });

  it("창원의 구를 넘는 이동은 관외로 센다(원자료가 다른 코드로 준다)", () => {
    expect(isSameSgg("48121310", "48123")).toBe(false);
    expect(isSameSgg("48121310", "48121")).toBe(true);
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
