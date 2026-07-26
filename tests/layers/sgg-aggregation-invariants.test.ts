import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { aggregateToSgg } from "@/lib/layers/aggregate";
import { CUBE_LAYERS } from "@/lib/layers/catalog";
import { resolveCrossQuery } from "@/lib/layers/resolve-cross-query";
import { resolveLayerQuery } from "@/lib/layers/resolve-layer-query";
import { resolveTrendQuery } from "@/lib/layers/resolve-trend-query";
import { LayerCubeSchema } from "@/lib/layers/types";
import type { LayerCube } from "@/lib/layers/types";

/**
 * 시군구 집계는 유닛테스트를 통과해도 조용히 틀릴 수 있다. 비중 지표를 실수로 더하거나
 * 가중치 키를 잘못 걸면 타입도 스키마도 통과하고, 화면에는 그럴듯한 숫자가 뜬다.
 *
 * 그래서 실제 큐브에 성질을 건다. 이때 기대값을 카탈로그의 `aggregation`에서 읽으면
 * 안 된다 — 그 값을 잘못 적은 것이 바로 잡으려는 결함이라, 구현과 기대가 함께 틀어져
 * 테스트가 통과해 버린다(실제로 그렇게 만들었다가 주입한 결함을 놓쳤다).
 *
 * 대신 **단위**로 판단한다. 단위는 그 지표가 더할 수 있는 양인지를 스스로 말해 준다.
 * - 명·세대·건·백만원 같은 외연량: 시군구 값 = 소속 읍면동 값의 합
 * - %·점·만원/월 같은 내포량: 시군구 값은 소속 읍면동 값의 최소~최대 **사이**.
 *   비율은 더해지지 않는다. 합계로 잘못 집계하면 즉시 범위를 벗어난다.
 */
/** 더할 수 있는 양의 단위. 나머지는 비율·평균이라 구성원 범위를 벗어날 수 없다. */
const EXTENSIVE_UNITS = new Set(["명", "세대", "건", "백만원"]);

/**
 * 원자료가 시군구까지만 제공해 같은 값을 소속 읍면동에 복제해 둔 지표(KCB 전출).
 * 더할 수 있는 단위지만 더하면 시군구 수만큼 부풀려진다. 이 경우엔 "복제되어 있는가"
 * 자체가 검사할 성질이다.
 */
const isSggScoped = (metric: { scope?: "sgg" }) => metric.scope === "sgg";

function loadCube(layerId: string): LayerCube | null {
  const file = path.join(process.cwd(), "public", "data", "layers", `${layerId}.json`);
  if (!fs.existsSync(file)) return null;
  return LayerCubeSchema.parse(JSON.parse(fs.readFileSync(file, "utf-8")));
}

const CUBES = CUBE_LAYERS.map((layer) => ({ layer, cube: loadCube(layer.id) })).filter(
  (entry): entry is { layer: (typeof CUBE_LAYERS)[number]; cube: LayerCube } => entry.cube !== null,
);

describe("시군구 집계 불변식", () => {
  test("검사할 큐브가 실제로 있다", () => {
    // 큐브 파일이 사라지면 아래 검사가 조용히 0건이 된다.
    expect(CUBES.length).toBeGreaterThanOrEqual(10);
  });

  test.each(CUBES.map(({ layer }) => layer.id))("%s — 합계는 합, 가중평균은 범위 안", (layerId) => {
    const { layer, cube } = CUBES.find((entry) => entry.layer.id === layerId)!;
    const metrics = [...layer.metrics];
    const sgg = aggregateToSgg(cube, metrics);

    // 읍면동을 시군구별로 묶어 둔다(앞 5자리).
    const byS = new Map<string, typeof cube.cells>();
    for (const cell of cube.cells) {
      const code = cell.code.slice(0, 5);
      byS.set(code, [...(byS.get(code) ?? []), cell]);
    }

    for (const metric of metrics) {
      for (const sggCell of sgg.cells) {
        const members = byS.get(sggCell.code) ?? [];
        for (let i = 0; i < cube.months.length; i += 1) {
          const got = sggCell.series[metric.key]?.[i];
          if (got == null) continue;
          const values = members
            .map((m) => m.series[metric.key]?.[i])
            .filter((v): v is number => v != null);
          if (values.length === 0) continue;

          if (isSggScoped(metric)) {
            // 소속 읍면동이 모두 같은 값을 들고 있어야 하고, 시군구 값도 그 값이어야 한다.
            const distinct = new Set(values);
            expect(
              distinct.size === 1,
              `${layerId}/${metric.key} ${sggCell.code} ${cube.months[i]}: 시군구 지표인데 읍면동 값이 ${distinct.size}종`,
            ).toBe(true);
            expect(got).toBe(values[0]);
          } else if (EXTENSIVE_UNITS.has(metric.unit)) {
            const expected = values.reduce((a, b) => a + b, 0);
            expect(
              Math.abs(got - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-9),
              `${layerId}/${metric.key} ${sggCell.code} ${cube.months[i]}: ${got} ≠ 합 ${expected}`,
            ).toBe(true);
          } else {
            const lo = Math.min(...values);
            const hi = Math.max(...values);
            const slack = Math.max(1e-6, (hi - lo) * 1e-9);
            expect(
              got >= lo - slack && got <= hi + slack,
              `${layerId}/${metric.key} ${sggCell.code} ${cube.months[i]}: 가중평균 ${got}이 구성원 범위 [${lo}, ${hi}] 밖`,
            ).toBe(true);
          }
        }
      }
    }
  });

  test.each(CUBES.map(({ layer }) => layer.id))("%s — 퍼센트 지표는 0~100 안", (layerId) => {
    const { layer, cube } = CUBES.find((entry) => entry.layer.id === layerId)!;
    for (const metric of layer.metrics) {
      if (metric.unit !== "%") continue;
      // 일자리 배율처럼 100을 넘는 것이 정상인 지표는 비중이 아니다.
      if (metric.key === "job_ratio" || metric.key === "day_night_ratio") continue;
      for (const cell of cube.cells) {
        for (const v of cell.series[metric.key] ?? []) {
          if (v == null) continue;
          expect(
            v >= 0 && v <= 100,
            `${layerId}/${metric.key} ${cell.code}: ${v}%는 0~100 밖`,
          ).toBe(true);
        }
      }
    }
  });
});

describe("시군구까지만 있는 지표는 시군구로 답한다", () => {
  test("읍면동으로 물어도 시군구 단위가 된다", () => {
    const match = resolveLayerQuery("전출 많은 동", CUBE_LAYERS);
    expect(match?.metricKey).toBe("move_out_sgg");
    // "동"이라고 물었지만 그 값은 시군구까지만 있으므로 읍면동 순위를 내면 안 된다.
    expect(match?.adminLevel).toBe("sgg");
  });

  test("추세 질의도 시군구로 본다", () => {
    const match = resolveTrendQuery("전출 늘어나는 지역", CUBE_LAYERS);
    expect(match?.metricKey).toBe("move_out_sgg");
    expect(match?.adminLevel).toBe("sgg");
  });

  test("교차 질의는 한쪽만 시군구 지표여도 시군구로 본다", () => {
    const match = resolveCrossQuery("전출 많고 소득 낮은 동", CUBE_LAYERS);
    expect(match).not.toBeNull();
    expect(match?.adminLevel).toBe("sgg");
  });

  test("읍면동까지 있는 지표는 그대로 읍면동이다", () => {
    expect(resolveLayerQuery("전입 많은 동", CUBE_LAYERS)?.adminLevel).toBe("dong");
    expect(resolveLayerQuery("생활인구 많은 동", CUBE_LAYERS)?.adminLevel).toBe("dong");
  });
});
