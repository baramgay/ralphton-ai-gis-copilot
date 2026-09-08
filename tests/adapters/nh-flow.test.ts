import { describe, expect, test } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { resolveOriginCode } from "../../scripts/adapters/_nh-origin.mjs";
// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { accumulateMoney, emptyMoneyAcc, finalizeMoney, moneyRegionName, parseMoneyLine } from "../../scripts/adapters/nh-flow.mjs";

const NAMES = new Map([
  ["48250", "김해시"],
  ["48330", "양산시"],
  ["26110", "중구"],
  ["11140", "중구"],
  ["27110", "중구"],
]);

describe("nh-flow 출발지 판정", () => {
  test("이름+시도로 코드를 하나로 좁힌다", () => {
    expect(resolveOriginCode("부산", "중구", NAMES)).toBe("26110");
    expect(resolveOriginCode("서울", "중구", NAMES)).toBe("11140");
    expect(resolveOriginCode("경남", "김해시", NAMES)).toBe("48250");
  });

  test(" 하나로 안 좁혀지면 버린다", () => {
    // 시도 없이 「중구」만으로는 여섯 곳이라 찍을 수 없다.
    expect(resolveOriginCode("", "중구", NAMES)).toBeNull();
    // 세종은 하위 시군구가 없어 매핑표에 없다.
    expect(resolveOriginCode("세종", "", NAMES)).toBeNull();
    expect(resolveOriginCode("세종", "세종시", NAMES)).toBeNull();
    // 모르는 시도는 버린다.
    expect(resolveOriginCode("제주특별자치도", "제주시", NAMES)).toBeNull();
  });

  test("화면 이름은 경남 밖 상대에만 시도를 붙인다", () => {
    expect(moneyRegionName("48250", NAMES)).toBe("김해시");
    expect(moneyRegionName("26110", NAMES)).toBe("부산광역시 중구");
    expect(moneyRegionName("99999", NAMES)).toBeNull();
  });
});

describe("nh-flow 집계", () => {
  test("행 파싱: 점포 동·상대 코드·금액을 뽑는다", () => {
    const row = parseMoneyLine(
      "4825062000,20250118,G,47,G47122,경남,김해시,19,196180,62.236,642606.414",
      "202501",
      NAMES,
    );
    expect(row).toMatchObject({ base: "48250", partner: "48250", self: true });
    expect(row?.amount).toBeCloseTo(642606.414, 6);
  });

  test("다른 달 행은 버린다 — 분모(일수)가 어긋나기 때문이다", () => {
    expect(
      parseMoneyLine(
        "4825062000,20250218,G,47,G47122,경남,김해시,19,196180,62.236,642606.414",
        "202501",
        NAMES,
      ),
    ).toBeNull();
  });

  test("못 쓰는 행은 null이다", () => {
    expect(parseMoneyLine("", "202501", NAMES)).toBeNull();
    expect(parseMoneyLine("짧은,행", "202501", NAMES)).toBeNull();
    expect(
      parseMoneyLine("4825062000,20250118,G,47,G47122,경남,,19,196180,62.236,642606.414", "202501", NAMES),
    ).toBeNull();
  });

  test("관내는 값에서 빼되 날짜와 관내 합계는 남긴다", () => {
    const acc = emptyMoneyAcc();
    accumulateMoney(acc, { base: "48250", partner: "48250", date: "20250118", amount: 100_000_000, self: true });
    accumulateMoney(acc, { base: "48250", partner: "26110", date: "20250118", amount: 50_000_000, self: false });
    accumulateMoney(acc, null);
    expect(acc.dropped).toBe(1);
    expect(acc.dates.size).toBe(1);
    const { byBase, intra } = finalizeMoney(acc, NAMES);
    // 관외만 남는다. 단위는 백만원.
    expect(byBase.get("48250").total).toBeCloseTo(50, 5);
    expect(byBase.get("48250").top[0].code).toBe("26110");
    // 관내 합계는 분모용으로 따로 남는다.
    expect(intra.get("48250")).toBeCloseTo(100, 5);
  });

  test("일평균은 그 달 구분일수로 나눈다", () => {
    const acc = emptyMoneyAcc();
    accumulateMoney(acc, { base: "48250", partner: "26110", date: "20250101", amount: 31_000_000, self: false });
    accumulateMoney(acc, { base: "48250", partner: "26110", date: "20250131", amount: 31_000_000, self: false });
    const { byBase } = finalizeMoney(acc, NAMES);
    // 6200만원 ÷ 2일 ÷ 100만원 = 31백만원.
    expect(byBase.get("48250").total).toBeCloseTo(31, 5);
  });
});
