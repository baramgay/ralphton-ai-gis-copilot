import { describe, expect, test } from "vitest";

import { NL_LAYERS } from "@/lib/layers/catalog";
import { resolveCrossQuery } from "@/lib/layers/resolve-cross-query";
import { asksCausation, resolveStatsQuery } from "@/lib/layers/resolve-stats-query";

const resolve = (query: string) => resolveStatsQuery(query, NL_LAYERS, { adminLevelFallback: "dong" });

describe("상관 질의", () => {
  test("두 지표의 관계를 물으면 상관으로 간다", () => {
    const match = resolve("재정자립도와 빈집 비율의 상관관계");
    expect(match?.kind).toBe("correlation");
    if (match?.kind !== "correlation") return;
    expect([match.a.metricKey, match.b.metricKey].sort()).toEqual(
      ["fiscal_independence", "vacant"].sort(),
    );
  });

  test.each([
    "평균소득과 카드매출은 관계가 있나",
    "생활인구와 카드매출이 같이 움직이나",
    "노후주택 비율과 빈집 비율의 연관성",
  ])("관계를 묻는 말들: %s", (query) => {
    expect(resolve(query)?.kind).toBe("correlation");
  });

  test("시군구까지만 있는 지표가 끼면 시군구로 낸다", () => {
    /*
     * 읍면동 305칸으로 내면 같은 값이 14번 복제된 표본이라 n이 부풀고, 그 n으로
     * 「유의하다」고 말하면 거짓이 된다. 계수를 낸 단위는 답에 반드시 실려야 한다.
     */
    const match = resolve("재정자립도와 빈집 비율의 상관관계");
    expect(match?.unit).toBe("sgg");
  });

  test("둘 다 읍면동 지표면 읍면동으로 낸다", () => {
    const match = resolve("생활인구와 카드매출의 상관관계");
    expect(match?.unit).toBe("dong");
  });

  test("지표가 하나뿐이면 상관을 만들어 내지 않는다", () => {
    expect(resolve("빈집 비율의 상관관계")).toBeNull();
  });

  test("관계를 묻는 말이 없으면 통계 경로가 아니다", () => {
    expect(resolve("생활인구 많고 소득 낮은 동")).toBeNull();
  });
});

describe("교차분석과 갈라진다", () => {
  /*
   * 재료(지표 둘)가 같아서 반드시 먼저 갈라야 한다. 물음이 다르다 — 교차는
   * "둘 다 높은 곳이 어디냐", 상관은 "둘이 같이 움직이냐"다. 교차가 먼저 잡으면
   * 상관을 물은 사람이 순위표를 받는다.
   */
  test("상관 질의를 교차가 가로채지 않도록 통계가 먼저다", () => {
    const query = "생활인구와 카드매출의 상관관계";
    expect(resolve(query)?.kind).toBe("correlation");
    // 교차 리졸버도 이 문장을 잡을 수 있다 — 그래서 순서가 계약이다.
    expect(resolveCrossQuery(query, NL_LAYERS, { adminLevelFallback: "dong" })).not.toBeUndefined();
  });

  test("교차 질의는 통계로 새지 않는다", () => {
    expect(resolve("생활인구 많고 카드매출 높은 동")).toBeNull();
  });
});

describe("이상치 질의", () => {
  test.each([
    ["카드매출 이상치", "card_sales"],
    ["평균소득이 유별난 동", "avg_income"],
    ["빈집 비율이 특이한 시군구", "vacant"],
  ])("%s → 이상치", (query, metricKey) => {
    const match = resolve(query);
    expect(match?.kind).toBe("outlier");
    if (match?.kind !== "outlier") return;
    expect(match.ref.metricKey).toBe(metricKey);
  });

  test("지표를 못 찾으면 아무것도 돌려주지 않는다", () => {
    expect(resolve("이상치 알려줘")).toBeNull();
  });
});

describe("인과로 물었는지 안다", () => {
  /*
   * 상관은 인과가 아니다. 사용자가 원인을 물었다는 사실을 알면 답에서 그것을 짚어 줄 수
   * 있다 — 계수만 돌려주면 "그래서 원인이 맞다"로 읽힌다.
   */
  test.each(["빈집이 늘어난 원인이 재정자립도인가", "소득 때문에 소비가 낮은가", "인구가 영향을 주나"])(
    "인과를 묻는 말: %s",
    (query) => {
      expect(asksCausation(query)).toBe(true);
    },
  );

  test("관계만 물었으면 인과가 아니다", () => {
    expect(asksCausation("재정자립도와 빈집 비율의 상관관계")).toBe(false);
  });
});
