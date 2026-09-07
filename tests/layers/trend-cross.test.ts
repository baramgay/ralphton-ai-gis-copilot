import { describe, expect, test } from "vitest";

import { trendCrossView } from "@/lib/layers/trend-cross";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

const metric = (key: string): MetricDef => ({
  key, label: key, unit: "명", aggregation: "sum", formula: "f", limitation: "", triggers: [key],
});

function cube(layerId: string, key: string, values: Record<string, number[]>): LayerCube {
  return {
    layerId,
    adminLevel: "dong",
    referenceMonth: "2025-03",
    months: ["2025-01", "2025-02", "2025-03"],
    cells: Object.entries(values).map(([code, series], i) => ({
      code,
      name: `경상남도 시 동${i + 1}`,
      point: { lat: 35, lng: 128 },
      areaKm2: 1,
      series: { [key]: series },
    })),
  };
}

describe("trendCrossView", () => {
  // 동1: 인구 늘고 소비 줄어듦(찾는 모양) · 동2: 둘 다 늘어남 · 동3: 인구 줄고 소비 늘어남
  const pop = cube("skt", "v", {
    "4811100000": [100, 110, 130],
    "4811200000": [100, 110, 130],
    "4811300000": [100, 90, 70],
  });
  const spend = cube("nh", "w", {
    "4811100000": [100, 90, 70],
    "4811200000": [100, 110, 130],
    "4811300000": [100, 110, 130],
  });
  const a = { cube: pop, metric: metric("v"), metrics: [metric("v")], direction: "rising" as const };
  const b = { cube: spend, metric: metric("w"), metrics: [metric("w")], direction: "falling" as const };

  test("두 요구를 모두 만족하는 곳이 1위다", () => {
    const result = trendCrossView(a, b, "dong");
    expect(result.ranked[0].code).toBe("4811100000");
    expect(result.ranked[0].rateA).toBeCloseTo(30, 5);
    expect(result.ranked[0].rateB).toBeCloseTo(-30, 5);
  });

  test("실제로 두 방향을 다 만족하는 지역 수를 센다", () => {
    // 인구 늘고 소비 준 곳은 동1뿐이다.
    expect(trendCrossView(a, b, "dong").matching).toBe(1);
  });

  test("한쪽만 만족하면 뒤로 밀린다", () => {
    const result = trendCrossView(a, b, "dong");
    expect(result.ranked[result.ranked.length - 1].code).toBe("4811300000");
  });

  test("지도 점수는 1위가 100에 가깝다", () => {
    const result = trendCrossView(a, b, "dong");
    expect(result.scores.get("4811100000")).toBeCloseTo(100, 5);
  });

  test("지역을 좁히면 그 안만 남는다", () => {
    const result = trendCrossView(a, b, "dong", undefined, ["동2"]);
    expect(result.ranked).toHaveLength(1);
    expect(result.ranked[0].code).toBe("4811200000");
  });

  test("추세를 낼 수 없으면 순위에 넣지 않는다", () => {
    const sparse = cube("nh", "w", { "4811100000": [0, 0, 0] });
    const result = trendCrossView(a, { ...b, cube: sparse }, "dong");
    expect(result.comparable).toBe(0);
  });
});

describe("시군구 복제 표준화", () => {
  /*
   * KOSIS는 창원시를 한 행으로 준다. 5개 구가 같은 값으로 들어오면 한 도시가
   * 5표를 갖는다 — 2지표 교차와 같은 함정이라 같은 규칙(독립 관측으로 표준화)으로 잡는다.
   * 검증: 복제 4곳을 덜어낸 실행과 합성값이 같아야 한다(첫 대표가 남으므로 기준 집합이 같다).
   */
  const guNames = ["의창구", "성산구", "마산합포구", "마산회원구", "진해구"];
  const guCodes = ["48121", "48123", "48125", "48127", "48129"];
  function sggCube(layerId: string, key: string, guSeries: number[], other: Record<string, number[]>): LayerCube {
    const cells = guCodes.map((prefix, i) => ({
      code: `${prefix}00000`,
      name: `경상남도 창원시${guNames[i]}`,
      point: { lat: 35, lng: 128 },
      areaKm2: 1,
      series: { [key]: guSeries },
    }));
    for (const [code, series] of Object.entries(other)) {
      cells.push({
        code,
        name: `경상남도 시 ${code}`,
        point: { lat: 35, lng: 128 },
        areaKm2: 1,
        series: { [key]: series },
      });
    }
    return {
      layerId,
      adminLevel: "dong",
      referenceMonth: "2025-03",
      months: ["2025-01", "2025-02", "2025-03"],
      cells,
    };
  }

  test("창원 5개 구를 1곳으로 세어 표준화한다", () => {
    const popFull = sggCube("skt", "v", [100, 110, 130], {
      "4817000000": [100, 100, 100],
      "4822000000": [100, 90, 80],
    });
    const spendFull = sggCube("nh", "w", [100, 90, 70], {
      "4817000000": [100, 100, 100],
      "4822000000": [100, 110, 120],
    });
    const full = trendCrossView(
      { cube: popFull, metric: metric("v"), metrics: [metric("v")], direction: "rising" },
      { cube: spendFull, metric: metric("w"), metrics: [metric("w")], direction: "falling" },
      "sgg",
    );
    const dropCell = (cube: LayerCube): LayerCube => ({
      ...cube,
      cells: cube.cells.filter((cell) => cell.code === "4812100000" || !cell.code.startsWith("4812")),
    });
    const reduced = trendCrossView(
      { cube: dropCell(popFull), metric: metric("v"), metrics: [metric("v")], direction: "rising" },
      { cube: dropCell(spendFull), metric: metric("w"), metrics: [metric("w")], direction: "falling" },
      "sgg",
    );
    const byCode = new Map(reduced.ranked.map((row) => [row.code, row.composite]));
    for (const row of full.ranked) {
      if (byCode.has(row.code)) {
        expect(row.composite).toBeCloseTo(byCode.get(row.code)!, 9);
      }
    }
    // 접히지 않았다면 창원 5표가 평균을 끌어 합성값이 달라진다.
    expect(full.ranked).toHaveLength(7);
    expect(reduced.ranked).toHaveLength(3);
  });
});
