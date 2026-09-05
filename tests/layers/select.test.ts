import { describe, expect, it } from "vitest";
import { buildLayerView } from "@/lib/layers/select";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

const metrics: MetricDef[] = [
  { key: "pop", label: "인구", unit: "명", aggregation: "sum", formula: "f", limitation: "", triggers: [] },
  { key: "ratio", label: "고령비", unit: "%", aggregation: "weightedAvg", weightKey: "pop", formula: "f", limitation: "", triggers: [] },
];

const dongCube: LayerCube = {
  layerId: "population",
  adminLevel: "dong",
  referenceMonth: "2026-06",
  months: ["2026-06", "2026-07"],
  cells: [
    { code: "4812051000", name: "창원 동읍", point: { lat: 35.3, lng: 128.6 }, areaKm2: 10, series: { pop: [100, 110], ratio: [20, 22] } },
    { code: "4812052000", name: "창원 북면", point: { lat: 35.4, lng: 128.6 }, areaKm2: 30, series: { pop: [300, 310], ratio: [40, 42] } },
    { code: "4817051000", name: "진주 A동", point: { lat: 35.1, lng: 128.1 }, areaKm2: 5, series: { pop: [null, 60], ratio: [10, 12] } },
  ],
};

describe("buildLayerView - dong level", () => {
  it("builds a scores map keyed by dong code, excluding nulls", () => {
    const view = buildLayerView(dongCube, "pop", "dong", 0, metrics);
    expect(view.scores.get("4812051000")).toBe(100);
    expect(view.scores.get("4812052000")).toBe(300);
    expect(view.scores.has("4817051000")).toBe(false);
  });

  it("sorts ranking descending with nulls last", () => {
    const view = buildLayerView(dongCube, "pop", "dong", 0, metrics);
    expect(view.ranking.map((r) => r.code)).toEqual(["4812052000", "4812051000", "4817051000"]);
    expect(view.ranking[2].value).toBeNull();
  });

  it("indexes series by monthIndex", () => {
    const view = buildLayerView(dongCube, "pop", "dong", 1, metrics);
    expect(view.scores.get("4817051000")).toBe(60);
    expect(view.ranking[0]).toEqual({ code: "4812052000", name: "창원 북면", value: 310 });
  });

  it("treats a missing metric key as null", () => {
    const view = buildLayerView(dongCube, "missing", "dong", 0, metrics);
    expect(view.scores.size).toBe(0);
    expect(view.ranking.every((r) => r.value === null)).toBe(true);
  });
});

describe("buildLayerView - sgg level", () => {
  it("aggregates ranking rows via sum", () => {
    const view = buildLayerView(dongCube, "pop", "sgg", 0, metrics);
    const changwon = view.ranking.find((r) => r.code === "48120")!;
    expect(changwon.value).toBe(400); // 100 + 300
    const jinju = view.ranking.find((r) => r.code === "48170")!;
    /*
     * 결손은 0이 아니다. 전에는 null 구성원을 0으로 더해 「인구 0명인 시군구」를 만들었고,
     * 그 값이 순위 맨 아래에 그럴듯한 얼굴로 앉았다. 하나라도 비면 합계를 내지 않는다
     * (2026-09-04 외부 검증 — 실데이터에서 kcb-migration.move_in 등 4개 지표가 해당).
     */
    expect(jinju.value).toBeNull();
  });

  it("aggregates ranking rows via weightedAvg", () => {
    const view = buildLayerView(dongCube, "ratio", "sgg", 0, metrics);
    const changwon = view.ranking.find((r) => r.code === "48120")!;
    // (20*100 + 40*300) / (100+300) = 14000/400 = 35
    expect(changwon.value).toBe(35);
  });

  it("sorts sgg ranking descending with nulls last", () => {
    const view = buildLayerView(dongCube, "pop", "sgg", 0, metrics);
    expect(view.ranking[0].code).toBe("48120");
  });

  it("maps every dong to its parent sgg's aggregated value", () => {
    const view = buildLayerView(dongCube, "pop", "sgg", 0, metrics);
    expect(view.scores.get("4812051000")).toBe(400);
    expect(view.scores.get("4812052000")).toBe(400);
  });

  it("omits a dong whose sgg total cannot be summed (a member is null)", () => {
    const view = buildLayerView(dongCube, "pop", "sgg", 0, metrics);
    // 칠하지 않는다. 0으로 칠하면 「가장 적은 곳」이라는 거짓을 색으로 말하게 된다.
    expect(view.scores.has("4817051000")).toBe(false);
  });

  it("omits a dong's score when its parent sgg's weightedAvg is genuinely null", () => {
    const zeroWeightCube: LayerCube = {
      ...dongCube,
      cells: [
        { code: "4812051000", name: "창원 동읍", point: { lat: 35.3, lng: 128.6 }, areaKm2: 10, series: { pop: [0], ratio: [20] } },
      ],
    };
    const view = buildLayerView(zeroWeightCube, "ratio", "sgg", 0, metrics);
    expect(view.ranking[0].value).toBeNull();
    expect(view.scores.has("4812051000")).toBe(false);
  });
});
