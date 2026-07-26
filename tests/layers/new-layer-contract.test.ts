import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { CUBE_LAYERS, PRIVATE_LAYERS } from "@/lib/layers/catalog";
import { resolveLayerQuery } from "@/lib/layers/resolve-layer-query";
import { LayerCubeSchema } from "@/lib/layers/types";

/**
 * 민간데이터를 하나 더 붙일 때 지켜야 할 것들.
 *
 * 이 도구의 주 기능은 민간데이터를 자연어로 묻는 것이고, 데이터는 앞으로 계속 늘어난다.
 * 새 레이어를 붙일 때마다 같은 실수를 반복하지 않도록, 지금까지 실제로 겪은 결함을
 * 계약으로 바꿔 둔다. 카탈로그에 레이어를 추가하면 이 검사가 자동으로 따라붙는다.
 *
 * 실제로 겪은 것들:
 * - 지표명이 트리거에 없어 다른 레이어의 짧은 트리거에 먹혔다(1인 카드소비 → NH 카드소비)
 * - 가중치 계열을 큐브에 안 실어 시군구 값이 22개 지표 전부 null이 됐다
 * - 원자료가 시군구까지만 있는데 읍면동으로 줄을 세워 같은 값에 임의 순위가 붙었다
 * - 한계(limitation)를 비워 두면 화면에서 그 지표의 해석 주의사항이 사라진다
 */
function cubeFor(layerId: string) {
  const file = path.join(process.cwd(), "public", "data", "layers", `${layerId}.json`);
  if (!fs.existsSync(file)) return null;
  return LayerCubeSchema.parse(JSON.parse(fs.readFileSync(file, "utf-8")));
}

describe("새 레이어 계약", () => {
  test("민간 레이어가 실제로 등록돼 있다", () => {
    expect(PRIVATE_LAYERS.length).toBeGreaterThanOrEqual(11);
  });

  describe.each(CUBE_LAYERS.map((layer) => [layer.id, layer] as const))("%s", (layerId, layer) => {
    test("지표마다 산식·한계·트리거가 채워져 있다", () => {
      for (const metric of layer.metrics) {
        expect(metric.formula.trim(), `${layerId}/${metric.key} 산식 비어 있음`).not.toBe("");
        expect(metric.triggers.length, `${layerId}/${metric.key} 트리거 없음`).toBeGreaterThan(0);
        // 한계는 "없음"을 명시적으로 적을 수 있게 빈 문자열을 허용하되, 민간데이터는
        // 해석 주의가 반드시 있으므로 비워 둘 수 없다.
        if (layer.provider !== "공공") {
          expect(metric.limitation.trim(), `${layerId}/${metric.key} 한계 비어 있음`).not.toBe("");
        }
      }
    });

    test("지표명을 그대로 물으면 자기 지표로 온다", () => {
      for (const metric of layer.metrics) {
        const hit = resolveLayerQuery(`${metric.label} 높은 지역`, CUBE_LAYERS);
        expect({ layerId: hit?.layerId, metricKey: hit?.metricKey }).toEqual({
          layerId,
          metricKey: metric.key,
        });
      }
    });

    test("큐브가 있다면 지표·가중치 계열이 모두 들어 있다", () => {
      const cube = cubeFor(layerId);
      if (!cube) return;
      const series = cube.cells[0]?.series ?? {};
      for (const metric of layer.metrics) {
        expect(metric.key in series, `${layerId}/${metric.key} 계열 없음`).toBe(true);
        if (metric.weightKey) {
          expect(
            metric.weightKey in series,
            `${layerId}/${metric.key} 가중치 '${metric.weightKey}' 계열 없음 → 시군구 값이 null이 된다`,
          ).toBe(true);
        }
      }
    });

    test("큐브가 있다면 기준월이 관측 구간 안에 있다", () => {
      const cube = cubeFor(layerId);
      if (!cube) return;
      expect(cube.months).toContain(cube.referenceMonth);
      expect(cube.cells.length).toBeGreaterThan(0);
      for (const cell of cube.cells) {
        for (const [key, values] of Object.entries(cell.series)) {
          expect(values.length, `${layerId} ${cell.code} ${key} 길이 불일치`).toBe(
            cube.months.length,
          );
        }
      }
    });
  });
});
