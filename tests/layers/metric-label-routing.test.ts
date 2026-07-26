import { describe, expect, test } from "vitest";

import { CUBE_LAYERS } from "@/lib/layers/catalog";
import { resolveLayerQuery } from "@/lib/layers/resolve-layer-query";

/**
 * 지표명을 그대로 물으면 그 지표가 나와야 한다.
 *
 * 사용자가 화면에서 본 이름을 그대로 치는 것은 가장 흔한 질의 방식인데, 트리거 목록에
 * 정작 자기 이름이 빠져 있으면 다른 레이어의 짧은 트리거에 먹힌다. 실제로 이 검사가
 * 6건을 잡았다 — "1인 카드소비"가 NH "카드소비"로, 업태 "음식점 비중"이 업종군으로,
 * "음식·숙박 비중"·"여가·문화 비중"은 아예 매칭 없음.
 *
 * 카탈로그에 지표를 더할 때 트리거를 빠뜨리면 여기서 걸린다.
 */
describe("지표명 라우팅", () => {
  const cases = CUBE_LAYERS.flatMap((layer) =>
    layer.metrics.map((metric) => ({ layer, metric })),
  );

  test.each(cases.map(({ layer, metric }) => [layer.id, metric.key, metric.label] as const))(
    "%s/%s — \"%s\" 그대로 물으면 자기 지표로 간다",
    (layerId, metricKey, label) => {
      const hit = resolveLayerQuery(`${label} 높은 지역`, CUBE_LAYERS);
      expect(hit).not.toBeNull();
      expect({ layerId: hit?.layerId, metricKey: hit?.metricKey }).toEqual({ layerId, metricKey });
    },
  );
});
