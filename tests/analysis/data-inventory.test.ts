import { describe, expect, test } from "vitest";

import { DATA_INVENTORY, INVENTORY_TOTALS } from "@/lib/analysis/data-inventory";
import { CUBE_LAYERS, MEDICAL_LAYER } from "@/lib/layers/catalog";
import { USAGE_GUIDE } from "@/lib/analysis/usage-guide";

/*
 * 활용 데이터 목록은 「무엇을 썼는가」를 답하는 자리다. 목록이 카탈로그와 갈라지면
 * 화면에는 있는데 목록에는 없는 지표가 생기고, 그 지표로 낸 값은 출처 없이 보고서로 간다.
 * 그래서 **전수 대조**한다 — 개수만 세면 하나 빠지고 하나 늘었을 때 통과한다.
 */
describe("활용 데이터 목록", () => {
  const ALL = [...CUBE_LAYERS, MEDICAL_LAYER];

  test("카탈로그의 레이어를 하나도 빠뜨리지 않는다", () => {
    const listed = DATA_INVENTORY.flatMap((group) => group.layers.map((layer) => layer.id));
    expect([...listed].sort()).toEqual([...ALL.map((layer) => layer.id)].sort());
  });

  test("각 레이어의 지표를 전수 싣는다", () => {
    for (const layer of ALL) {
      const listed = DATA_INVENTORY.flatMap((group) => group.layers).find(
        (entry) => entry.id === layer.id,
      );
      expect(listed, `${layer.id} 가 목록에 없다`).toBeDefined();
      expect(listed!.metrics.map((metric) => metric.label)).toEqual(
        layer.metrics.map((metric) => metric.label),
      );
    }
  });

  test("합계는 실제로 센 값이다", () => {
    expect(INVENTORY_TOTALS.layers).toBe(ALL.length);
    expect(INVENTORY_TOTALS.metrics).toBe(
      ALL.reduce((sum, layer) => sum + layer.metrics.length, 0),
    );
  });

  /*
   * 500m 격자는 행정 단위가 아니다. 「행정동」이라고 적으면 격자 값을 행정동 지표와
   * 더하거나 나눌 수 있다고 읽게 된다.
   */
  test("격자 레이어를 행정동이라고 적지 않는다", () => {
    const grid = ALL.filter((layer) => layer.geometry === "grid");
    expect(grid.length).toBeGreaterThan(0);
    for (const layer of grid) {
      const listed = DATA_INVENTORY.flatMap((group) => group.layers).find(
        (entry) => entry.id === layer.id,
      );
      expect(listed!.unitLabel).toBe("500m 격자");
    }
  });

  /* 시군구까지만 제공되는 지표는 그렇다고 적혀야 한다. 읍면동 순위를 만들면 안 되는 값이다. */
  test("시군구 전용 지표에 표시가 붙는다", () => {
    const sggMetrics = ALL.flatMap((layer) =>
      layer.metrics.filter((metric) => metric.scope === "sgg").map((metric) => metric.label),
    );
    expect(sggMetrics.length).toBeGreaterThan(0);
    const flagged = DATA_INVENTORY.flatMap((group) =>
      group.layers.flatMap((layer) =>
        layer.metrics.filter((metric) => metric.sggOnly).map((metric) => metric.label),
      ),
    );
    expect([...flagged].sort()).toEqual([...sggMetrics].sort());
  });

  test("제공기관마다 그것이 무엇인지 한 줄이 있다", () => {
    for (const group of DATA_INVENTORY) {
      expect(group.note.length).toBeGreaterThan(10);
      expect(group.layers.length).toBeGreaterThan(0);
    }
  });
});

describe("활용 가이드", () => {
  test("번호가 1부터 빠짐없이 이어진다", () => {
    expect(USAGE_GUIDE.map((step) => step.order)).toEqual(
      USAGE_GUIDE.map((_, index) => index + 1),
    );
  });

  /*
   * 「어떻게」가 없으면 안내가 아니라 소개문이다. 여기 있던 예전 문구가 화면의 생김새만
   * 말하고 무엇을 눌러야 하는지는 말하지 않아 기능이 있는 줄도 모르는 채 남았다.
   */
  test("각 단계가 무엇을·어떻게를 함께 말한다", () => {
    for (const step of USAGE_GUIDE) {
      expect(step.what.length).toBeGreaterThan(10);
      expect(step.how.length).toBeGreaterThan(0);
      for (const line of step.how) expect(line.length).toBeGreaterThan(5);
    }
  });

  test("옛 이름을 쓰지 않는다", () => {
    const text = JSON.stringify(USAGE_GUIDE);
    expect(text).not.toMatch(/의료취약지수|구 비교|랄프톤/);
  });
});
