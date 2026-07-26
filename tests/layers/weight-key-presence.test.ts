import fs from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { CUBE_LAYERS } from "@/lib/layers/catalog";
import { LayerCubeSchema } from "@/lib/layers/types";

/**
 * 가중평균 지표의 가중치 계열이 그 큐브 안에 실제로 있어야 한다.
 *
 * 없으면 aggregateToSgg가 가중치를 0으로 보고 0으로 나눠 **시군구 값이 통째로 null**이
 * 된다. 화면에는 오류가 아니라 "빈 결과"로 나오고, 읍면동 화면은 멀쩡해서 눈에 띄지
 * 않는다. 실제로 45개 지표 중 22개(NH 업종·업태·소비주체 전부, KCB 신용 전부)가
 * 시군구 단위에서 조용히 비어 있었다.
 *
 * 카탈로그의 weightKey와 어댑터가 내보내는 계열은 서로 다른 파일이라 어긋나기 쉽다.
 * 여기서 묶어 둔다.
 */
describe("가중치 계열 존재", () => {
  const cases = CUBE_LAYERS.flatMap((layer) =>
    layer.metrics
      .filter((metric) => metric.aggregation === "weightedAvg" && metric.weightKey)
      .map((metric) => [layer.id, metric.key, metric.weightKey!] as const),
  );

  test("검사할 대상이 실제로 있다", () => {
    expect(cases.length).toBeGreaterThan(20);
  });

  test.each(cases)("%s/%s — 가중치 '%s' 계열이 큐브에 있다", (layerId, metricKey, weightKey) => {
    const file = path.join(process.cwd(), "public", "data", "layers", `${layerId}.json`);
    if (!fs.existsSync(file)) return; // 원격 큐브가 없는 레이어(공공 인구)는 건너뛴다.
    const cube = LayerCubeSchema.parse(JSON.parse(fs.readFileSync(file, "utf-8")));
    const series = cube.cells[0]?.series ?? {};
    expect(
      weightKey in series,
      `${layerId}/${metricKey}의 가중치 '${weightKey}'가 큐브에 없다 → 시군구 값이 전부 null이 된다`,
    ).toBe(true);
  });
});
