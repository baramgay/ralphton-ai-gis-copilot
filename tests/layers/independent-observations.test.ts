import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { KOSIS_LAYERS } from "@/lib/layers/kosis-catalog";
import { correlationView, outlierView } from "@/lib/layers/stats-view";
import type { LayerCube, MetricDef } from "@/lib/layers/types";

/*
 * 지어낸 표본이 아니라 **배포되는 그 JSON**으로 잰다.
 *
 * 이 결함은 합성 데이터에서는 보이지 않았다. 창원 5개 구가 세 지표 모두에서 하필 끝값에
 * 있다는 것이 문제의 크기를 정하는데, 그건 실제 값을 넣어 봐야 나온다.
 */
function loadCube(layerId: string): LayerCube {
  return JSON.parse(
    readFileSync(join(process.cwd(), `public/data/layers/${layerId}.json`), "utf8"),
  ) as LayerCube;
}

function metricsOf(layerId: string): MetricDef[] {
  const layer = KOSIS_LAYERS.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error(`레이어 없음: ${layerId}`);
  return [...layer.metrics];
}

function refOf(layerId: string, metricKey: string) {
  const metrics = metricsOf(layerId);
  const metric = metrics.find((candidate) => candidate.key === metricKey);
  if (!metric) throw new Error(`지표 없음: ${layerId}.${metricKey}`);
  return { cube: loadCube(layerId), metric, metrics };
}

const axis = (layerId: string, layerLabel: string, metricKey: string, metricLabel: string) => ({
  layerId,
  layerLabel,
  provider: "KOSIS" as const,
  metricKey,
  metricLabel,
});

const correlationMatch = (
  a: ReturnType<typeof axis>,
  b: ReturnType<typeof axis>,
) => ({
  kind: "correlation" as const,
  a,
  b,
  adminLevel: "sgg" as const,
  unit: "sgg" as const,
  regionFilters: [],
});

const FISCAL = axis("kosis-finance", "재정", "fiscal_independence", "재정자립도");
const VACANT = axis("kosis-housing", "주거", "vacant", "빈집 비율");
const FIRE = axis("kosis-safety", "안전", "fire_rate", "화재 발생률");

describe("복제된 자치구는 한 관측으로 센다", () => {
  test("표본은 22가 아니라 18이다", () => {
    const view = correlationView(
      correlationMatch(FISCAL, VACANT),
      refOf("kosis-finance", "fiscal_independence"),
      refOf("kosis-housing", "vacant"),
    );
    expect(view.notes.join(" ")).toContain("표본 18개 시군구");
    expect(view.summary).toContain("18개 시군구");
  });

  /*
   * 이 검사가 결정타였다. 화면은 이미 창원을 한 줄로 접어 18줄을 보여 주면서 바로 밑에
   * 「표본 22개」라고 적고 있었다 — 같은 화면에서 표본이 18이기도 하고 22이기도 했다.
   * 보이는 줄 수와 센 수는 언제나 같아야 한다.
   */
  test.each([
    ["재정자립도 × 빈집", FISCAL, VACANT],
    ["재정자립도 × 화재", FISCAL, FIRE],
    ["빈집 × 화재", VACANT, FIRE],
  ])("%s: 보여 주는 줄 수와 표본 수가 같다", (_label, a, b) => {
    const view = correlationView(
      correlationMatch(a, b),
      refOf(a.layerId, a.metricKey),
      refOf(b.layerId, b.metricKey),
    );
    const stated = view.notes.join(" ").match(/표본 (\d+)개/);
    expect(stated).not.toBeNull();
    expect(Number(stated![1])).toBe(view.rows.length);
  });

  /*
   * 부풀림의 크기를 값으로 못 박는다. 「접었다」만 검사하면 접기가 헛돌아도(이름 띄어쓰기
   * 함정으로 실제 그런 적이 있다) 초록이 뜬다.
   */
  test.each([
    ["재정자립도 × 빈집", FISCAL, VACANT, -0.754],
    ["재정자립도 × 화재", FISCAL, FIRE, -0.845],
    ["빈집 × 화재", VACANT, FIRE, 0.647],
  ])("%s: 스피어만이 접기 전보다 내려온다", (_label, a, b, expected) => {
    const view = correlationView(
      correlationMatch(a, b),
      refOf(a.layerId, a.metricKey),
      refOf(b.layerId, b.metricKey),
    );
    const rho = Number(view.notes.join(" ").match(/스피어만 ρ = (-?[\d.]+)/)![1]);
    expect(rho).toBeCloseTo(expected as number, 2);
  });

  test("접은 사실과 이유를 화면에 적는다", () => {
    const view = correlationView(
      correlationMatch(FISCAL, VACANT),
      refOf("kosis-finance", "fiscal_independence"),
      refOf("kosis-housing", "vacant"),
    );
    const notes = view.notes.join(" ");
    expect(notes).toContain("창원시 5개 구");
    expect(notes).toContain("1곳으로 셌습니다");
  });

  /*
   * 축마다 최신 시점을 따로 집는다. 재정자립도는 2024-12가 최신이고 화재는 2025-12라,
   * 이 상관은 한 해 어긋난 두 값의 상관이다 — 계수를 못 내는 문제가 아니라 무엇과 무엇을
   * 견줬는지 화면이 말하지 않던 문제다.
   */
  test("기준 시점이 다르면 다르다고 적는다", () => {
    const view = correlationView(
      correlationMatch(FISCAL, FIRE),
      refOf("kosis-finance", "fiscal_independence"),
      refOf("kosis-safety", "fire_rate"),
    );
    expect(view.notes.join(" ")).toContain("기준 시점이 다릅니다");
    expect(view.notes.join(" ")).toContain("2024-12");
    expect(view.notes.join(" ")).toContain("2025-12");
  });

  /*
   * 중복은 이상치 판정을 **양쪽으로** 뒤집는다. 재정자립도에서는 창원 5표가 중앙값을
   * 자기 쪽으로 끌어 창원 스스로를 정상으로 만들었다(22점: 이상치 없음).
   */
  test("재정자립도 이상치 — 접기 전에는 창원이 스스로를 숨겼다", () => {
    const view = outlierView(
      {
        kind: "outlier" as const,
        ref: FISCAL,
        adminLevel: "sgg" as const,
        unit: "sgg" as const,
        regionFilters: [],
      },
      refOf("kosis-finance", "fiscal_independence"),
    );
    expect(view.notes.join(" ")).toContain("표본 18개 시군구");
    expect(view.rows.map((row) => row.name).join(" ")).toContain("창원시");
  });

  /*
   * 뺑소니율은 함양군 11개 읍면만 2024-12가 최신이다. 한 순위 안에 두 시점이 섞여 있고
   * 화면은 그 말을 하지 않았다.
   */
  test("한 지표 안에서 시점이 갈리면 그것도 적는다", () => {
    const view = outlierView(
      {
        kind: "outlier" as const,
        ref: axis("kosis-safety", "안전", "hitrun_rate", "뺑소니율"),
        adminLevel: "sgg" as const,
        unit: "sgg" as const,
        regionFilters: [],
      },
      refOf("kosis-safety", "hitrun_rate"),
    );
    expect(view.notes.join(" ")).toContain("최신 시점이 다릅니다");
    expect(view.notes.join(" ")).toContain("2024-12");
  });
});
