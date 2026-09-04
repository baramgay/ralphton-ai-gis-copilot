import { describe, expect, test } from "vitest";

import {
  averageRanks,
  correlate,
  describeCorrelation,
  findOutliers,
  quantile,
} from "@/lib/analysis/statistics";

describe("averageRanks", () => {
  test("동점은 순위를 나눠 갖는다", () => {
    // 값 [10, 20, 20, 30] → 순위 1, (2+3)/2, (2+3)/2, 4
    expect(averageRanks([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  test("모두 같은 값이면 모두 같은 순위", () => {
    expect(averageRanks([5, 5, 5, 5])).toEqual([2.5, 2.5, 2.5, 2.5]);
  });

  test("순서가 뒤섞여 있어도 원래 자리로 돌려준다", () => {
    expect(averageRanks([30, 10, 20])).toEqual([3, 1, 2]);
  });
});

describe("correlate", () => {
  const rows = (pairs: Array<[number | null, number | null]>) =>
    pairs.map(([a, b], i) => ({ code: `c${i}`, a, b }));

  test("완전한 정비례는 1", () => {
    const r = correlate(rows([[1, 2], [2, 4], [3, 6], [4, 8]]), "sgg");
    expect(r.pearson).toBeCloseTo(1, 10);
    expect(r.spearman).toBeCloseTo(1, 10);
    expect(r.n).toBe(4);
  });

  test("완전한 반비례는 -1", () => {
    const r = correlate(rows([[1, 8], [2, 6], [3, 4], [4, 2]]), "sgg");
    expect(r.pearson).toBeCloseTo(-1, 10);
  });

  test("한쪽이라도 비면 그 관측을 빼고 뺀 수를 밝힌다", () => {
    const r = correlate(rows([[1, 2], [2, null], [3, 6], [null, 8], [4, 8]]), "sgg");
    expect(r.n).toBe(3);
    expect(r.dropped).toBe(2);
  });

  test("관측이 3개 미만이면 계수를 내지 않는다 — 0이 아니라 모른다", () => {
    const r = correlate(rows([[1, 2], [2, 4]]), "sgg");
    expect(r.pearson).toBeNull();
    expect(r.spearman).toBeNull();
    expect(r.n).toBe(2);
  });

  test("한쪽이 상수면 관계를 말할 수 없다", () => {
    const r = correlate(rows([[5, 1], [5, 2], [5, 3], [5, 4]]), "sgg");
    expect(r.pearson).toBeNull();
  });

  test("이상치 하나가 피어슨은 뒤집어도 스피어만은 버틴다", () => {
    /*
     * 앞 다섯은 깨끗한 반비례인데 마지막 한 곳만 양쪽 다 극단으로 크다. 피어슨은 그
     * 한 점에 끌려 양수로 돌아서고, 순위만 보는 스피어만은 음수를 지킨다. 둘을 함께
     * 내는 이유가 여기 있다 — 어긋나면 "한 곳이 끌고 있다"는 신호다.
     */
    const r = correlate(
      rows([[1, 10], [2, 9], [3, 8], [4, 7], [5, 6], [100, 100]]),
      "sgg",
    );
    expect(r.pearson).toBeGreaterThan(0.9);
    expect(r.spearman).toBeLessThan(0);
  });

  test("계수를 낸 단위를 그대로 실어 준다", () => {
    expect(correlate(rows([[1, 2], [2, 4], [3, 6]]), "dong").unit).toBe("dong");
    expect(correlate(rows([[1, 2], [2, 4], [3, 6]]), "sgg").unit).toBe("sgg");
  });
});

describe("describeCorrelation", () => {
  test.each([
    [0.02, "사실상 관계가 없습니다"],
    [-0.05, "사실상 관계가 없습니다"],
  ])("%s → 관계 없음", (r, expected) => {
    expect(describeCorrelation(r)).toBe(expected);
  });

  test("부호가 방향을 말한다", () => {
    expect(describeCorrelation(0.6)).toContain("같이 높아지는");
    expect(describeCorrelation(-0.6)).toContain("반대로 움직이는");
  });

  test("셀수록 세게 말한다", () => {
    expect(describeCorrelation(0.2)).toContain("약하게");
    expect(describeCorrelation(0.4)).toContain("뚜렷하게");
    expect(describeCorrelation(0.8)).toContain("강하게");
  });
});

describe("findOutliers", () => {
  const rows = (values: Array<number | null>) =>
    values.map((value, i) => ({ code: `c${i}`, name: `지역${i}`, value }));

  test("한 곳만 크게 튀면 그 곳을 집는다", () => {
    const result = findOutliers(rows([10, 11, 10, 12, 11, 10, 11, 200]));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe("지역7");
    expect(result.rows[0].side).toBe("high");
  });

  test("낮은 쪽으로 튄 것도 집는다", () => {
    const result = findOutliers(rows([100, 101, 100, 102, 101, 100, 101, 3]));
    expect(result.rows[0].side).toBe("low");
  });

  test("이상치가 평균을 밀어 올려도 가려지지 않는다", () => {
    /*
     * 평균±3표준편차였다면 200이 표준편차를 통째로 키워 자기가 정상 범위 안으로
     * 들어온다. 중앙값·MAD는 그 손아귀 밖이라 그대로 잡힌다.
     */
    const values = [10, 11, 9, 12, 10, 11, 9, 10, 200, 205];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    expect(Math.abs(200 - mean) / sd).toBeLessThan(3); // 평균 기준으로는 안 잡힌다

    expect(findOutliers(rows(values)).rows.map((r) => r.value).sort((a, b) => a - b)).toEqual([
      200, 205,
    ]);
  });

  test("값이 거의 한 점에 몰려 있으면 이상치를 말하지 않는다", () => {
    // MAD가 0이면 나눗셈이 무한대라 모든 지역이 이상치가 된다.
    const result = findOutliers(rows([7, 7, 7, 7, 7, 7, 9]));
    expect(result.mad).toBe(0);
    expect(result.rows).toEqual([]);
  });

  test("관측이 너무 적으면 판정하지 않는다", () => {
    expect(findOutliers(rows([1, 100, 2])).rows).toEqual([]);
  });

  test("빈 값은 세지 않는다", () => {
    const result = findOutliers(rows([10, null, 11, 10, 12, null, 11, 200]));
    expect(result.n).toBe(6);
  });

  test("많이 튄 순으로 준다", () => {
    const result = findOutliers(rows([10, 11, 9, 12, 10, 11, 9, 13, 60, 300]));
    expect(result.rows.map((r) => r.value)).toEqual([300, 60]);
  });
});

describe("quantile", () => {
  test("중앙값", () => {
    expect(quantile([1, 2, 3], 0.5)).toBe(2);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  test("한 개면 그 값", () => {
    expect(quantile([7], 0.5)).toBe(7);
  });
});
