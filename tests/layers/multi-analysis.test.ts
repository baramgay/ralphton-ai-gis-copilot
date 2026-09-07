import { describe, expect, test } from "vitest";

import { multiLayerView, type MultiOperand } from "@/lib/layers/multi-analysis";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

const metric = (key: string): MetricDef => ({
  key,
  label: key.toUpperCase(),
  unit: "",
  aggregation: "sum",
  formula: "f",
  limitation: "",
  triggers: [key],
});

const CODES = ["4811100000", "4811200000", "4811300000"];

function cube(id: string, key: string, values: number[], codes: string[] = CODES): LayerCube {
  return {
    layerId: id,
    adminLevel: "dong",
    referenceMonth: "2025-01",
    months: ["2025-01"],
    cells: codes.map((code, i) => ({
      code,
      name: `경상남도 동${i + 1}`,
      point: { lat: 35, lng: 128 },
      areaKm2: 1,
      series: { [key]: [values[i]] },
    })),
  };
}

const operand = (
  key: string,
  values: number[],
  direction: "high" | "low",
  codes: string[] = CODES,
): MultiOperand => ({
  cube: cube(`layer-${key}`, key, values, codes),
  metric: metric(key),
  metrics: [metric(key)],
  direction,
});

describe("multiLayerView", () => {
  test("세 지표를 모두 높은 쪽으로 물으면 셋 다 높은 곳이 1위", () => {
    const { ranked, comparable } = multiLayerView(
      [
        operand("a", [10, 20, 30], "high"),
        operand("b", [10, 20, 30], "high"),
        operand("c", [10, 20, 30], "high"),
      ],
      "dong",
    );
    expect(comparable).toBe(3);
    expect(ranked[0].code).toBe("4811300000");
    expect(ranked.at(-1)!.code).toBe("4811100000");
  });

  test("낮은 쪽으로 물은 지표는 부호가 뒤집힌다", () => {
    // 동1은 a·b가 가장 낮지만 c도 가장 낮다. c를 "낮은"으로 물으면 동1이 1위여야 한다.
    const { ranked } = multiLayerView(
      [
        operand("a", [10, 20, 30], "low"),
        operand("b", [10, 20, 30], "low"),
        operand("c", [10, 20, 30], "low"),
      ],
      "dong",
    );
    expect(ranked[0].code).toBe("4811100000");
  });

  test("방향이 섞이면 각 요구를 함께 만족하는 곳이 위로 온다", () => {
    // a 높고 · b 높고 · c 낮은 곳 → 동3(a=30, b=30, c=10)
    const { ranked } = multiLayerView(
      [
        operand("a", [10, 20, 30], "high"),
        operand("b", [10, 20, 30], "high"),
        operand("c", [30, 20, 10], "low"),
      ],
      "dong",
    );
    expect(ranked[0].code).toBe("4811300000");
    expect(ranked[0].composite).toBeGreaterThan(ranked[1].composite);
  });

  test("한 지표라도 값이 없는 지역은 빼고, 뺀 사실을 셀 수 있게 남긴다", () => {
    /*
     * 없는 값을 0으로 채우면 그 지역이 최하위인 것처럼 보인다. 이 도구는 추정하지 않는다.
     * 대신 몇 곳이 비교 가능했는지(comparable)와 전체(total)를 함께 준다 — 화면이 그 차이를
     * 밝힐 수 있어야 "다 본 것"으로 오해하지 않는다.
     */
    const short = ["4811100000", "4811200000"];
    const { ranked, comparable, total } = multiLayerView(
      [
        operand("a", [10, 20, 30], "high"),
        operand("b", [10, 20], "high", short),
        operand("c", [10, 20, 30], "high"),
      ],
      "dong",
    );
    expect(comparable).toBe(2);
    expect(total).toBe(3);
    expect(ranked.map((row) => row.code)).not.toContain("4811300000");
  });

  test("지표별 원값과 z를 순서대로 돌려준다", () => {
    const { ranked } = multiLayerView(
      [
        operand("a", [10, 20, 30], "high"),
        operand("b", [30, 20, 10], "high"),
        operand("c", [10, 20, 30], "high"),
      ],
      "dong",
    );
    const top = ranked[0];
    expect(top.values).toHaveLength(3);
    expect(top.z).toHaveLength(3);
    // composite는 부호 맞춘 z의 합이다.
    const expected = top.z.reduce((sum, value) => sum + value, 0);
    expect(top.composite).toBeCloseTo(expected, 10);
  });

  test("지도 점수는 0~100으로 펼쳐진다", () => {
    const { ranked, scores } = multiLayerView(
      [
        operand("a", [10, 20, 30], "high"),
        operand("b", [10, 20, 30], "high"),
        operand("c", [10, 20, 30], "high"),
      ],
      "dong",
    );
    expect(scores.get(ranked[0].code)).toBeCloseTo(100, 6);
    expect(scores.get(ranked.at(-1)!.code)).toBeCloseTo(0, 6);
  });

  test("피연산자가 없으면 빈 결과", () => {
    const result = multiLayerView([], "dong");
    expect(result.ranked).toEqual([]);
    expect(result.comparable).toBe(0);
  });
});

describe("시군구 복제 표준화", () => {
  /*
   * trend-cross와 같은 규칙. 복제 4곳을 덜어낸 실행과 합성값이 같아야 한다.
   */
  const guCodes = ["48121", "48123", "48125", "48127", "48129"];
  const guNames = ["의창구", "성산구", "마산합포구", "마산회원구", "진해구"];
  function sggOperand(key: string, guValue: number, others: Record<string, number>): MultiOperand {
    const cells = guCodes.map((prefix, i) => ({
      code: `${prefix}00000`,
      name: `경상남도 창원시${guNames[i]}`,
      point: { lat: 35, lng: 128 },
      areaKm2: 1,
      series: { [key]: [guValue] },
    }));
    for (const [code, value] of Object.entries(others)) {
      cells.push({
        code,
        name: `경상남도 시 ${code}`,
        point: { lat: 35, lng: 128 },
        areaKm2: 1,
        series: { [key]: [value] },
      });
    }
    const m = metric(key);
    return {
      cube: { layerId: `layer-${key}`, adminLevel: "dong", referenceMonth: "2025-01", months: ["2025-01"], cells },
      metric: m,
      metrics: [m],
      direction: "high",
    };
  }

  test("창원 5개 구를 1곳으로 세어 표준화한다", () => {
    const full = multiLayerView(
      [
        sggOperand("a", 10, { "4817000000": 30, "4822000000": 50 }),
        sggOperand("b", 20, { "4817000000": 40, "4822000000": 60 }),
        sggOperand("c", 30, { "4817000000": 50, "4822000000": 70 }),
      ],
      "sgg",
    );
    const dropGu = (operand: MultiOperand): MultiOperand => ({
      ...operand,
      cube: {
        ...operand.cube,
        cells: operand.cube.cells.filter(
          (cell) => cell.code === "4812100000" || !cell.code.startsWith("4812"),
        ),
      },
    });
    const reduced = multiLayerView(
      [
        dropGu(sggOperand("a", 10, { "4817000000": 30, "4822000000": 50 })),
        dropGu(sggOperand("b", 20, { "4817000000": 40, "4822000000": 60 })),
        dropGu(sggOperand("c", 30, { "4817000000": 50, "4822000000": 70 })),
      ],
      "sgg",
    );
    const byCode = new Map(reduced.ranked.map((row) => [row.code, row.composite]));
    for (const row of full.ranked) {
      if (byCode.has(row.code)) {
        expect(row.composite).toBeCloseTo(byCode.get(row.code)!, 9);
      }
    }
    expect(full.ranked).toHaveLength(7);
    expect(reduced.ranked).toHaveLength(3);
  });
});
