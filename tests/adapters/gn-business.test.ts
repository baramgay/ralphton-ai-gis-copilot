import { describe, expect, test } from "vitest";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { CORP_TYPES, accumulateBusiness, emptyAcc, isGyeongnamSgg, parseBusinessRow, yearLabel } from "../../scripts/adapters/gn-business.mjs";

describe("gn-business 어댑터", () => {
  test("행 파싱: 연·시군구·법인 여부를 뽑는다", () => {
    expect(
      parseBusinessRow(["2019-01-01", "4812100000", "x", "40", "주식회사", "5", "N", "1", "1", "0", "0"]),
    ).toEqual({ year: "2019", sgg5: "48121", corp: true });
    expect(
      parseBusinessRow(["2019-01-01", "4812100000", "x", "40", "개인기업", "5", "N", "1", "1", "0", "0"]),
    ).toEqual({ year: "2019", sgg5: "48121", corp: false });
  });

  test("쓸 수 없는 행은 null이다 (빈 코드·비경남·깨진 날짜·빈 형태)", () => {
    expect(parseBusinessRow(["2019-01-01", "", "x", "40", "주식회사", "5", "N", "1", "1", "0", "0"])).toBeNull();
    expect(parseBusinessRow(["2019-01-01", "1111000000", "x", "40", "주식회사", "5", "N", "1", "1", "0", "0"])).toBeNull();
    expect(parseBusinessRow(["날짜없음", "4812100000", "x", "40", "주식회사", "5", "N", "1", "1", "0", "0"])).toBeNull();
    expect(parseBusinessRow(["2019-01-01", "4812100000", "x", "40", "", "5", "N", "1", "1", "0", "0"])).toBeNull();
  });

  test("같은 시군구·연도로 묶어 세고 제외는 센다", () => {
    const acc = emptyAcc();
    accumulateBusiness(acc, { year: "2019", sgg5: "48121", corp: true });
    accumulateBusiness(acc, { year: "2019", sgg5: "48121", corp: false });
    accumulateBusiness(acc, null);
    expect(acc.cells.get("2019|48121")).toEqual({ count: 2, corp: 1 });
    expect(acc.skipped).toBe(1);
  });

  test("연 라벨은 연말(12월)이다", () => {
    expect(yearLabel("2019")).toBe("2019-12");
  });

  test("법인 집합이 비어 있지 않다", () => {
    expect(CORP_TYPES.has("주식회사")).toBe(true);
    expect(isGyeongnamSgg("4812100000")).toBe(true);
    expect(isGyeongnamSgg("1111000000")).toBe(false);
    expect(isGyeongnamSgg("48121")).toBe(false);
  });
});
