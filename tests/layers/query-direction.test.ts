import { describe, expect, test } from "vitest";

import { CUBE_LAYERS } from "@/lib/layers/catalog";
import { detectDirection, detectRegionFilter, detectRegionFilters, resolveLayerQuery } from "@/lib/layers/resolve-layer-query";
import { buildLayerView } from "@/lib/layers/select";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

/**
 * 낮은 쪽을 물었는데 높은 순으로 답하면 **정반대 답**이다. prod에서 "생활인구 적은 곳"에
 * 양산시 물금읍 97,787명을 1위로 내놓고 있었다. 정책 질의의 상당수가 "적은·낮은·부족한"
 * 이라 이 방향 판정은 라우팅만큼 중요하다.
 */
describe("detectDirection", () => {
  test.each([
    ["생활인구 적은 곳", "asc"],
    ["평균소득 낮은 동", "asc"],
    ["카드매출 적은 지역", "asc"],
    ["일자리 부족한 곳", "asc"],
    ["신용평점 하위 지역", "asc"],
    ["생활인구 많은 동", "desc"],
    ["평균소득 높은 동", "desc"],
    ["카드매출 상위", "desc"],
    ["생활인구", "desc"],
  ] as const)('"%s" → %s', (query, expected) => {
    expect(detectDirection(query)).toBe(expected);
  });

  test("둘 다 있으면 뒤에 오는 쪽을 따른다", () => {
    // "소득 낮고 소비 많은 곳"에서 정렬은 마지막 요구인 "많은"을 따른다.
    expect(detectDirection("소득 낮고 소비 많은 곳")).toBe("desc");
    expect(detectDirection("소비 많고 소득 낮은 곳")).toBe("asc");
  });
});

describe("resolveLayerQuery 방향", () => {
  test("낮은 질의는 asc를 싣는다", () => {
    expect(resolveLayerQuery("평균소득 낮은 동", CUBE_LAYERS)?.direction).toBe("asc");
    expect(resolveLayerQuery("평균소득 높은 동", CUBE_LAYERS)?.direction).toBe("desc");
  });
});

describe("buildLayerView 정렬", () => {
  const metric: MetricDef = {
    key: "v", label: "값", unit: "명", aggregation: "sum",
    formula: "f", limitation: "", triggers: ["값"],
  };
  const cube: LayerCube = {
    layerId: "t",
    adminLevel: "dong",
    referenceMonth: "2025-01",
    months: ["2025-01"],
    cells: [
      { code: "4811100000", name: "동1", point: { lat: 35, lng: 128 }, areaKm2: 1, series: { v: [10] } },
      { code: "4811200000", name: "동2", point: { lat: 35, lng: 128 }, areaKm2: 1, series: { v: [30] } },
      { code: "4811300000", name: "동3", point: { lat: 35, lng: 128 }, areaKm2: 1, series: { v: [20] } },
      { code: "4811400000", name: "동4", point: { lat: 35, lng: 128 }, areaKm2: 1, series: { v: [null] } },
    ],
  };

  test("기본은 큰 값부터", () => {
    const view = buildLayerView(cube, "v", "dong", 0, [metric]);
    expect(view.ranking.map((r) => r.value)).toEqual([30, 20, 10, null]);
  });

  test("asc는 작은 값부터", () => {
    const view = buildLayerView(cube, "v", "dong", 0, [metric], "asc");
    expect(view.ranking.map((r) => r.value)).toEqual([10, 20, 30, null]);
  });

  test("값 없는 지역은 방향과 무관하게 뒤에 둔다", () => {
    // 오름차순이라고 결측을 1위로 올리면 "가장 적은 곳"이 데이터 없는 곳이 된다.
    const view = buildLayerView(cube, "v", "dong", 0, [metric], "asc");
    expect(view.ranking[view.ranking.length - 1].value).toBeNull();
  });
});

describe("지역 한정", () => {
  // "창원 생활인구 많은 동"이라고 물었는데 경남 전체 1위인 양산시 물금읍을 답하고 있었다.
  test("시군구 이름을 알아본다", () => {
    // "창원"만 적으면 어느 구인지 알 수 없다. 5개 구 중 하나로 좁히지 말고 시 전체로 본다.
    expect(detectRegionFilter("창원 생활인구 많은 동")).toMatch(/^창원시/);
  });

  test("구 단위가 시 단위보다 먼저 잡힌다", () => {
    expect(detectRegionFilter("창원시 성산구 카드매출")).toBe("창원시 성산구");
    expect(detectRegionFilter("김해 카드매출 높은 곳")).toBe("김해시");
  });

  test("지역이 없으면 null", () => {
    expect(detectRegionFilter("카드매출 높은 곳")).toBeNull();
  });

  test("순위가 그 지역 안으로 좁혀진다", () => {
    const metric: MetricDef = {
      key: "v", label: "값", unit: "명", aggregation: "sum",
      formula: "f", limitation: "", triggers: ["값"],
    };
    const cube: LayerCube = {
      layerId: "t", adminLevel: "dong", referenceMonth: "2025-01", months: ["2025-01"],
      cells: [
        { code: "4812100000", name: "경상남도 창원시성산구 중앙동", point: { lat: 35, lng: 128 }, areaKm2: 1, series: { v: [10] } },
        { code: "4833000000", name: "경상남도 양산시 물금읍", point: { lat: 35, lng: 129 }, areaKm2: 1, series: { v: [99] } },
      ],
    };
    const all = buildLayerView(cube, "v", "dong", 0, [metric]);
    expect(all.ranking[0].name).toContain("물금읍");

    const scoped = buildLayerView(cube, "v", "dong", 0, [metric], "desc", ["창원시 성산구"]);
    expect(scoped.ranking).toHaveLength(1);
    expect(scoped.ranking[0].name).toContain("중앙동");
  });
});

describe("표기 흔들림", () => {
  // "생활 인구 많은 동"이 공공 총인구로 새고 있었다 — 공백 때문에 "생활인구"가 안 맞고
  // 더 짧은 "인구"가 잡혔다. 어디를 띄어 쓸지는 사람마다 다르다.
  test.each([
    ["생활 인구 많은 동", "skt-living", "living_total"],
    ["카드 매출 높은 지역", "nh-consumption", "card_sales"],
    ["평균 소득 높은 동", "kcb-credit", "avg_income"],
    ["신용 평점 높은 곳", "kcb-credit", "credit_score"],
    ["유입 인구 많은 동", "skt-mobility", "inflow_total"],
  ] as const)('"%s" → %s/%s', (query, layerId, metricKey) => {
    const match = resolveLayerQuery(query, CUBE_LAYERS);
    expect({ layerId: match?.layerId, metricKey: match?.metricKey }).toEqual({ layerId, metricKey });
  });

  test("붙여 쓴 질의도 그대로 된다", () => {
    expect(resolveLayerQuery("생활인구많은동", CUBE_LAYERS)?.layerId).toBe("skt-living");
  });
});

describe("읍면동 지정", () => {
  // "물금읍 생활인구"가 경남 전체 순위를 답하고 있었다. 읍면동이 시군구보다 좁으므로
  // 먼저 잡아야 "물금읍"이 "양산시"를 이긴다.
  const dongs = ["물금읍", "동읍", "진영읍", "장유3동"];

  test("읍면동 이름을 알아본다", () => {
    expect(detectRegionFilter("물금읍 생활인구", dongs)).toBe("물금읍");
    expect(detectRegionFilter("진영읍 카드매출 높은 곳", dongs)).toBe("진영읍");
  });

  test("시군구 바로 뒤에 읍면동이 붙으면 좁은 쪽만 남긴다", () => {
    // 둘 다 남기면 어느 하나라도 맞으면 통과라 양산 전체로 넓어진다.
    expect(detectRegionFilters("양산시 물금읍 생활인구", dongs)).toEqual(["물금읍"]);
  });

  test("떨어져 있는 두 지역은 둘 다 살린다", () => {
    expect(detectRegionFilters("창원과 김해의 생활인구", dongs)).toEqual(["창원시", "김해시"]);
  });

  test("목록에 없으면 시군구로 떨어진다", () => {
    expect(detectRegionFilter("양산 생활인구", dongs)).toBe("양산시");
  });

  test("읍면동 목록을 안 주면 예전처럼 시군구만 본다", () => {
    expect(detectRegionFilter("물금읍 생활인구")).toBeNull();
  });
});

describe("부정 표현", () => {
  // "카드매출이 없는 동"에 가장 많은 곳을 답하고 있었다 — 정반대다.
  test('"없는"은 가장 적은 쪽을 묻는다', () => {
    expect(detectDirection("카드매출이 없는 동")).toBe("asc");
    expect(detectDirection("일자리가 없는 지역")).toBe("asc");
  });
});

describe("상권", () => {
  test('"상권이 성장하는"은 카드매출로 간다', () => {
    // 공공 인구 증감률로 새고 있었다.
    expect(resolveLayerQuery("상권이 성장하는 읍면동", CUBE_LAYERS)?.layerId).toBe("nh-consumption");
  });

  test("더 구체적인 상권 표현은 그쪽이 이긴다", () => {
    expect(resolveLayerQuery("야간 상권 발달한 동", CUBE_LAYERS)?.layerId).toBe("nh-hourly");
    expect(resolveLayerQuery("카페 상권 발달한 동", CUBE_LAYERS)?.layerId).toBe("nh-storetype");
  });
});

describe("6차에서 나온 표현", () => {
  test.each([
    ["밤 늦게 장사되는 곳", "nh-hourly", "night_sales", "desc"],
    ["점심 시간 매출 높은 동", "nh-hourly", "day_sales", "desc"],
    ["학원가 형성된 동", "nh-industry", "education_share", "desc"],
    ["제일 잘 사는 동네", "kcb-credit", "avg_income", "desc"],
    ["가장 가난한 지역", "kcb-credit", "avg_income", "asc"],
    ["약국 없는 동", "nh-storetype", "medical_store_share", "asc"],
    ["술집 많은 동네", "nh-storetype", "pub_share", "desc"],
  ] as const)('"%s" → %s/%s (%s)', (query, layerId, metricKey, direction) => {
    const match = resolveLayerQuery(query, CUBE_LAYERS);
    expect({
      layerId: match?.layerId,
      metricKey: match?.metricKey,
      direction: match?.direction,
    }).toEqual({ layerId, metricKey, direction });
  });
});
