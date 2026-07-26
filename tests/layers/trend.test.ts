import { describe, expect, test } from "vitest";

import { computeTrend, describeTrend, sliceRecent, sliceRecentMonths } from "@/lib/layers/trend";

describe("computeTrend", () => {
  test("꾸준히 오르는 계열은 증가로 본다", () => {
    const trend = computeTrend([100, 110, 120, 130]);
    expect(trend.direction).toBe("rising");
    expect(trend.changeRate).toBeCloseTo(30, 6);
    expect(trend.slope).toBeCloseTo(10, 6);
    expect(trend.first).toBe(100);
    expect(trend.last).toBe(130);
    expect(trend.points).toBe(4);
  });

  test("내려가는 계열은 감소로 본다", () => {
    const trend = computeTrend([200, 180, 150]);
    expect(trend.direction).toBe("falling");
    expect(trend.changeRate).toBeCloseTo(-25, 6);
    expect(trend.slope).toBeLessThan(0);
  });

  test("작은 흔들림은 추세가 아니라 보합으로 부른다", () => {
    // 월별 지표는 늘 소수점 수준으로 움직인다. ±3% 이내는 잡음으로 본다.
    expect(computeTrend([100, 101, 99, 102]).direction).toBe("flat");
    expect(computeTrend([100, 100, 100]).direction).toBe("flat");
  });

  test("결측월은 건너뛰되 간격은 유지한다", () => {
    // 0월 100, 3월 130 → 기울기는 10/월(구간 3)이지 30/월이 아니다.
    const trend = computeTrend([100, null, null, 130]);
    expect(trend.points).toBe(2);
    expect(trend.slope).toBeCloseTo(10, 6);
    expect(trend.changeRate).toBeCloseTo(30, 6);
  });

  test("관측이 1개 이하면 추세를 지어내지 않는다", () => {
    const one = computeTrend([null, 50, null]);
    expect(one.points).toBe(1);
    expect(one.changeRate).toBeNull();
    expect(one.slope).toBeNull();
    expect(one.direction).toBe("flat");

    const none = computeTrend([null, null]);
    expect(none.points).toBe(0);
    expect(none.first).toBeNull();
  });

  test("첫 값이 0이면 변화율 대신 기울기 부호로 방향을 정한다", () => {
    const trend = computeTrend([0, 5, 10]);
    expect(trend.changeRate).toBeNull();
    expect(trend.direction).toBe("rising");
  });

  test("음수 기준값에서도 변화율 부호가 뒤집히지 않는다", () => {
    // 순유입 같은 지표는 음수가 될 수 있다. -100 → -50은 개선(증가)이다.
    const trend = computeTrend([-100, -50]);
    expect(trend.changeRate).toBeCloseTo(50, 6);
    expect(trend.direction).toBe("rising");
  });
});

describe("describeTrend", () => {
  test("보고서에 옮길 수 있는 명사형 한 줄로 만든다", () => {
    const text = describeTrend(computeTrend([100, 130]), "카드매출", "백만원");
    expect(text).toContain("카드매출 증가");
    expect(text).toContain("100백만원 → 130백만원");
    expect(text).toContain("+30%");
    expect(text.endsWith("니다.")).toBe(false);
  });

  test("감소는 부호까지 그대로 드러낸다", () => {
    const text = describeTrend(computeTrend([200, 150]), "생활인구", "명");
    expect(text).toContain("생활인구 감소");
    expect(text).toContain("-25%");
  });

  test("관측이 모자라면 추세가 있는 것처럼 쓰지 않는다", () => {
    const text = describeTrend(computeTrend([null, 5]), "카드매출", "백만원");
    expect(text).toContain("추세 판단 불가");
    expect(text).toContain("1개월");
  });

  test("첫 값이 0이면 변화율을 지어내지 않고 이유를 밝힌다", () => {
    const text = describeTrend(computeTrend([0, 10]), "야간 매출", "백만원");
    expect(text).toContain("변화율 산출 불가");
  });
});

describe("sliceRecent", () => {
  test("최근 N개월만 잘라 준다", () => {
    expect(sliceRecent([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });

  test("기간을 안 주거나 계열보다 길면 전 기간을 그대로 쓴다", () => {
    const series = [1, 2, 3];
    expect(sliceRecent(series)).toEqual(series);
    expect(sliceRecent(series, 0)).toEqual(series);
    expect(sliceRecent(series, 10)).toEqual(series);
  });

  test("잘라낸 구간으로 계산하면 장기와 방향이 갈릴 수 있다", () => {
    // 진주시 정촌면 사례: 12개월로는 증가, 최근 3개월은 감소.
    const series = [100, 120, 140, 160, 150, 140];
    expect(computeTrend(series).direction).toBe("rising");
    expect(computeTrend(sliceRecent(series, 3)).direction).toBe("falling");
  });
});

describe("sliceRecentMonths", () => {
  const monthly = ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12"];
  const quarterly = ["2025-03", "2025-06", "2025-09", "2025-12"];

  test("월별 큐브는 최근 N개월이 곧 N개 관측이다", () => {
    const series = [1, 2, 3, 4, 5, 6];
    expect(sliceRecentMonths(series, monthly, 3)).toEqual([4, 5, 6]);
  });

  test("분기별 큐브에서 3개월을 고르면 관측이 하나뿐이다", () => {
    // 관측 개수로 자르면 3개 분기(9개월)를 보게 되어 화면 라벨과 어긋난다.
    const series = [10, 20, 30, 40];
    expect(sliceRecentMonths(series, quarterly, 3)).toEqual([40]);
    // 6개월이면 2개 분기가 들어와 추세를 낼 수 있다.
    expect(sliceRecentMonths(series, quarterly, 6)).toEqual([30, 40]);
  });

  test("연도를 넘는 구간도 제대로 센다", () => {
    const labels = ["2024-11", "2024-12", "2025-01", "2025-02"];
    expect(sliceRecentMonths([1, 2, 3, 4], labels, 3)).toEqual([2, 3, 4]);
  });

  test("기간을 안 주면 전 기간을 그대로 쓴다", () => {
    const series = [1, 2, 3];
    expect(sliceRecentMonths(series, ["2025-10", "2025-11", "2025-12"])).toEqual(series);
  });

  test("라벨 수가 맞지 않으면 관측 개수 기준으로 물러난다", () => {
    expect(sliceRecentMonths([1, 2, 3, 4], ["2025-11", "2025-12"], 2)).toEqual([3, 4]);
  });

  test("구간에 드는 관측이 없어도 최소 하나는 남긴다", () => {
    // 빈 배열을 돌려주면 호출부가 추세 대신 오류를 마주하게 된다.
    expect(sliceRecentMonths([1, 2, 3], ["2020-01", "2020-02", "2020-03"], 1)).toHaveLength(1);
  });
});
