import { describe, expect, test } from "vitest";

import { districtParentCity } from "@/lib/layers/independent-observations";
import { correlationView, outlierView } from "@/lib/layers/stats-view";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

const metric = (key: string, label: string, unit = "%"): MetricDef => ({
  key,
  label,
  unit,
  aggregation: "weightedAvg",
  formula: `${label} 산식`,
  limitation: "",
  triggers: [label],
});

/*
 * 실제 지역명 규칙을 그대로 쓴다. 창원은 「창원시 의창구」처럼 **시 + 구** 두 마디라,
 * 코드를 그대로 이름에 넣으면 다섯 구가 서로 다른 시로 보여 접기 검사가 헛돈다.
 */
const SGG_NAMES: Record<string, string> = {
  "48121": "창원시의창구",
  "48123": "창원시성산구",
  "48125": "창원시마산합포구",
  "48127": "창원시마산회원구",
  "48129": "창원시진해구",
  "48170": "진주시",
  "48220": "통영시",
  "48240": "사천시",
  "48250": "김해시",
  "48270": "밀양시",
  "48310": "거제시",
};

/** 시군구 하나에 행정동 여럿을 달아 준다. 시군구 지표의 복제 표본을 재현하려면 필요하다. */
function cube(layerId: string, key: string, bySgg: Record<string, number>, dongsPerSgg = 5): LayerCube {
  const cells = [];
  for (const [sgg, value] of Object.entries(bySgg)) {
    for (let i = 0; i < dongsPerSgg; i += 1) {
      cells.push({
        code: `${sgg}${String(i).padStart(5, "0")}`,
        name: `경상남도 ${SGG_NAMES[sgg] ?? `${sgg}시`} ${i}동`,
        point: { lat: 35 + i / 100, lng: 128 + i / 100 },
        areaKm2: 1,
        series: { [key]: [value] },
      });
    }
  }
  return { layerId, adminLevel: "dong", referenceMonth: "2025-12", months: ["2025-12"], cells };
}

const A = { "48170": 10, "48220": 20, "48240": 30, "48250": 40, "48270": 50, "48310": 60 };
/* 창원 5개 구는 KOSIS가 시 한 행만 주므로 값이 그대로 복제된다. */
const CHANGWON = { "48121": 90, "48123": 90, "48125": 90, "48127": 90, "48129": 90 };
const B = { "48170": 11, "48220": 19, "48240": 32, "48250": 38, "48270": 51, "48310": 59 };

const refA = (() => {
  const m = metric("a", "지표A");
  return { cube: cube("layer-a", "a", A), metric: m, metrics: [m] };
})();
const refB = (() => {
  const m = metric("b", "지표B");
  return { cube: cube("layer-b", "b", B), metric: m, metrics: [m] };
})();

const match = (unit: "dong" | "sgg") =>
  ({
    kind: "correlation" as const,
    a: { layerId: "layer-a", layerLabel: "A", provider: "KOSIS" as const, metricKey: "a", metricLabel: "지표A" },
    b: { layerId: "layer-b", layerLabel: "B", provider: "KOSIS" as const, metricKey: "b", metricLabel: "지표B" },
    adminLevel: unit,
    unit,
    regionFilters: [],
  });

describe("correlationView", () => {
  test("시군구 단위로 내면 표본은 시군구 수다", () => {
    const view = correlationView(match("sgg"), refA, refB);
    expect(view.notes.join(" ")).toContain("표본 6개 시군구");
  });

  test("행정동 단위로 내면 같은 값이 복제되어 표본이 부푼다 — 그래서 단위를 밝힌다", () => {
    /*
     * 이 검사는 "부풀어도 된다"가 아니라 **부푼다는 사실이 화면에 적힌다**를 못 박는다.
     * 시군구 지표는 리졸버가 sgg로 내려보내지만, 단위를 실어 나르지 않으면 30이라는
     * 표본 수만 남아 6개 시군을 30개 관측으로 읽게 된다.
     */
    const view = correlationView(match("dong"), refA, refB);
    expect(view.notes.join(" ")).toContain("표본 30개 행정동");
  });

  test("시군구로 냈으면 왜 그랬는지 적는다", () => {
    const view = correlationView(match("sgg"), refA, refB);
    expect(view.notes.join(" ")).toContain("행정동으로 계산하면 같은 값이 반복 집계되어");
  });

  test("상관은 인과가 아니라는 것을 답이 스스로 말한다", () => {
    const view = correlationView(match("sgg"), refA, refB);
    expect(view.notes.join(" ")).toContain("상관은 인과가 아닙니다");
  });

  test("원인을 물었으면 그 물음을 짚어 준다", () => {
    const view = correlationView(match("sgg"), refA, refB, { asksCausation: true });
    expect(view.notes.join(" ")).toContain("인과를 말하지 않습니다");
    expect(view.notes.join(" ")).toContain("제3의 요인");
  });

  test("계수 둘을 모두 싣는다", () => {
    const view = correlationView(match("sgg"), refA, refB);
    expect(view.notes.join(" ")).toMatch(/피어슨 r = /);
    expect(view.notes.join(" ")).toMatch(/스피어만 ρ = /);
  });

  test("한쪽이 모든 지역에서 같으면 관계를 말할 수 없다고 한다", () => {
    const flat = (() => {
      const m = metric("b", "지표B");
      return {
        cube: cube("layer-b", "b", { "48170": 7, "48220": 7, "48240": 7, "48250": 7, "48270": 7, "48310": 7 }),
        metric: m,
        metrics: [m],
      };
    })();
    const view = correlationView(match("sgg"), refA, flat);
    expect(view.summary).toContain("관계를 말할 수 없습니다");
  });
});

describe("outlierView", () => {
  const outlierMatch = {
    kind: "outlier" as const,
    ref: { layerId: "layer-a", layerLabel: "A", provider: "KOSIS" as const, metricKey: "a", metricLabel: "지표A" },
    adminLevel: "sgg" as const,
    unit: "sgg" as const,
    regionFilters: [],
  };

  test("크게 튄 시군구를 집는다", () => {
    const ref = (() => {
      const m = metric("a", "지표A");
      return {
        cube: cube("layer-a", "a", {
          "48170": 10, "48220": 11, "48240": 9, "48250": 12, "48270": 10, "48310": 11,
          "48330": 9, "48720": 13, "48730": 300,
        }),
        metric: m,
        metrics: [m],
      };
    })();
    const view = outlierView(outlierMatch, ref);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0].detail).toContain("위");
  });

  test("튀는 곳이 없으면 「자료가 없는 것이 아니다」를 밝힌다", () => {
    const ref = (() => {
      const m = metric("a", "지표A");
      return {
        cube: cube("layer-a", "a", { "48170": 10, "48220": 11, "48240": 9, "48250": 12, "48270": 10, "48310": 11 }),
        metric: m,
        metrics: [m],
      };
    })();
    const view = outlierView(outlierMatch, ref);
    expect(view.rows).toEqual([]);
    expect(view.summary).toContain("자료가 없는 것이 아닙니다");
  });

  test("평균이 아니라 중앙값 기준임을 밝힌다", () => {
    const ref = (() => {
      const m = metric("a", "지표A");
      return { cube: cube("layer-a", "a", A), metric: m, metrics: [m] };
    })();
    expect(outlierView(outlierMatch, ref).notes.join(" ")).toContain("중앙값절대편차(MAD)");
  });
});

describe("같은 값을 나눠 가진 구는 한 줄로 접는다", () => {
  /*
   * KOSIS는 창원시를 한 행으로 준다. 그 값이 5개 구에 복제되므로, 접지 않으면 값이 같은
   * 다섯 줄이 상위권을 통째로 차지한다(배포본 실측: 1~5위가 전부 창원). 값은 참이지만
   * 읽는 사람에게는 다섯 지역이 휩쓴 것으로 보인다 — 실은 한 도시다.
   */
  const withChangwon = (key: string, extra: Record<string, number>) => {
    const m = metric(key, key === "a" ? "지표A" : "지표B");
    return { cube: cube(`layer-${key}`, key, { ...extra, ...CHANGWON }), metric: m, metrics: [m] };
  };

  test("시군구 단위에서 창원 5개 구가 한 줄이 된다", () => {
    const view = correlationView(match("sgg"), withChangwon("a", A), withChangwon("b", B));
    const changwon = view.rows.filter((row) => row.name.includes("창원"));

    expect(changwon).toHaveLength(1);
    expect(changwon[0].sharedCount).toBe(5);
    expect(changwon[0].detail).toContain("5개 구 공통값");
  });

  test("접은 만큼 표본도 준다 — 복제된 값은 한 관측이다", () => {
    /*
     * 2026-09-04 외부 검증에서 뒤집힌 판정이다. 그전에는 "접기는 화면만 건드린다"며 계수를
     * 11칸으로 냈다. 실제 레이어로 재 보니 창원 5표가 스피어만을 0.07~0.15 부풀렸고
     * (빈집×화재 0.798 → 0.647), 하필 창원은 세 지표 모두에서 끝값이라 가장 세게 끄는
     * 자리에 있었다. 게다가 같은 화면이 18줄을 보여 주면서 표본만 22라고 적고 있었다.
     */
    const view = correlationView(match("sgg"), withChangwon("a", A), withChangwon("b", B));
    expect(view.notes.join(" ")).toContain("표본 7개 시군구");
    expect(view.notes.join(" ")).toContain("창원시 5개 구");
  });

  test("값이 다르면 접지 않는다 — 서로 다른 지역이다", () => {
    const differing = { "48121": 90, "48123": 91, "48125": 92, "48127": 93, "48129": 94 };
    const a = (() => {
      const m = metric("a", "지표A");
      return { cube: cube("layer-a", "a", { ...A, ...differing }), metric: m, metrics: [m] };
    })();
    const b = (() => {
      const m = metric("b", "지표B");
      return { cube: cube("layer-b", "b", { ...B, ...differing }), metric: m, metrics: [m] };
    })();
    const view = correlationView(match("sgg"), a, b);
    expect(view.rows.filter((row) => row.name.includes("창원"))).toHaveLength(5);
  });

  test("행정동 단위에서는 접지 않는다", () => {
    const view = correlationView(match("dong"), withChangwon("a", A), withChangwon("b", B));
    expect(view.rows.every((row) => (row.sharedCount ?? 1) === 1)).toBe(true);
  });

  test("결과 개수의 단위를 스스로 말한다 — 화면이 추측하면 「행정동」이라 적는다", () => {
    expect(correlationView(match("sgg"), refA, refB).unitWord).toBe("시군구");
    expect(correlationView(match("dong"), refA, refB).unitWord).toBe("행정동");
  });
});

describe("districtParentCity", () => {
  /*
   * ⚠️ 실제 이름에는 띄어쓰기가 없다 — 「창원시의창구」다. 공백으로 잘라 첫 마디를 쓰면
   * 다섯 구가 서로 다른 시가 되어 접기가 통째로 헛돈다(배포본에서 실제로 그랬다).
   *
   * 자치구가 **아닌** 이름에는 null을 준다. 시·군을 이름만 보고 묶으면 진주시의 두 동이
   * 우연히 같은 값을 가졌을 때 서로 다른 관측을 한 관측으로 접어 버린다.
   */
  test.each([
    ["창원시의창구", "창원시"],
    ["창원시마산합포구", "창원시"],
    ["창원시 진해구", "창원시"],
    ["경상남도 창원시성산구", "창원시"],
    ["진주시", null],
    ["의령군", null],
    ["경상남도 하동군", null],
    ["경상남도 진주시 상봉동", null],
  ])("%s → %s", (name, city) => {
    expect(districtParentCity(name)).toBe(city);
  });
});
