/**
 * 카탈로그에서 생성하는 RAG 청크.
 *
 * 손으로 쓴 코퍼스는 공공 의료·인구 도구만 담고 있었다. 이 도구의 주기능은
 * 민간데이터(SKT·NH·KCB) 자연어 질의인데, 13개 레이어 40여 지표가 검색 대상에
 * 하나도 없었다 — 규칙이 놓친 질의를 모델에게 넘겨도 모델이 참고할 지식이 없었다.
 *
 * 그래서 코퍼스의 그 절반을 `CROSS_CANDIDATE_LAYERS`에서 만든다. 카탈로그가
 * 앱·테스트의 단일 출처이므로, 레이어를 새로 붙이면 코퍼스도 같이 자란다.
 * (계약은 `tests/rag/catalog-coverage.test.ts`가 지킨다.)
 */
import { CROSS_CANDIDATE_LAYERS } from "@/lib/layers/catalog";
import type { LayerDescriptor, MetricDef } from "@/lib/layers/types";

import type { RagChunk } from "./corpus";

type CatalogLayer = Omit<LayerDescriptor, "months">;

/** 격자 레이어는 행정동이 아니라 500m 칸으로 답한다. 그 사실을 문장에 남긴다. */
function unitWord(layer: CatalogLayer): string {
  if (layer.geometry === "grid") return "500m 격자 칸";
  return layer.adminLevels.includes("dong") ? "행정동" : "시군구";
}

function scopeSentence(layer: CatalogLayer, metric: MetricDef): string {
  if (metric.scope === "sgg") {
    return "원자료가 시군구까지만 제공하므로 시군구 단위로만 답한다(읍면동으로 줄 세우면 같은 값이 반복된다).";
  }
  return `답하는 단위는 ${unitWord(layer)}이다.`;
}

export function metricChunkId(layerId: string, metricKey: string): string {
  return `metric-${layerId}-${metricKey}`;
}

export function layerChunkId(layerId: string): string {
  return `layer-${layerId}`;
}

function metricChunk(layer: CatalogLayer, metric: MetricDef): RagChunk {
  const body = [
    `${layer.label}(${layer.provider}) 레이어의 「${metric.label}」 지표. 단위 ${metric.unit || "무단위"}.`,
    `산식: ${metric.formula}.`,
    metric.limitation ? `한계: ${metric.limitation}.` : "",
    scopeSentence(layer, metric),
  ]
    .filter(Boolean)
    .join(" ");

  return {
    id: metricChunkId(layer.id, metric.key),
    title: `${layer.label} · ${metric.label}`,
    body,
    tags: ["catalog", "metric", layer.id, layer.provider, metric.key],
    keywords: [...new Set([metric.label, ...metric.triggers])],
  };
}

function layerChunk(layer: CatalogLayer): RagChunk {
  const metricLabels = layer.metrics.map((metric) => metric.label).join(" · ");
  const body = [
    `${layer.label} 레이어는 ${layer.provider} 제공 자료다. 지표 ${layer.metrics.length}종: ${metricLabels}.`,
    `출처 메모: ${layer.sourceNotes.join(" / ")}.`,
    `답하는 단위는 ${unitWord(layer)}이다.`,
  ].join(" ");

  return {
    id: layerChunkId(layer.id),
    title: `${layer.label} 레이어 (${layer.provider})`,
    body,
    tags: ["catalog", "layer", layer.id, layer.provider],
    keywords: [...new Set([layer.label, layer.provider])],
  };
}

/** 카탈로그 전체를 청크로 편다. 레이어 1개 + 그 지표 수만큼. */
export function buildCatalogRagChunks(
  layers: readonly CatalogLayer[] = CROSS_CANDIDATE_LAYERS,
): RagChunk[] {
  const chunks: RagChunk[] = [];

  for (const layer of layers) {
    chunks.push(layerChunk(layer));
    for (const metric of layer.metrics) {
      chunks.push(metricChunk(layer, metric));
    }
  }

  return chunks;
}

/** 청크 id에서 지표를 되찾는다. 모델이 고른 지표를 카탈로그로 확인할 때 쓴다. */
export function findCatalogMetric(
  layerId: string,
  metricKey: string,
  layers: readonly CatalogLayer[] = CROSS_CANDIDATE_LAYERS,
): { layer: CatalogLayer; metric: MetricDef } | null {
  const layer = layers.find((candidate) => candidate.id === layerId);
  if (!layer) return null;

  const metric = layer.metrics.find((candidate) => candidate.key === metricKey);
  if (!metric) return null;

  return { layer, metric };
}

/** 청크 목록에서 지표 후보만 골라낸다(레이어 청크·손으로 쓴 청크는 제외). */
export function catalogMetricsFromChunkIds(
  chunkIds: readonly string[],
  layers: readonly CatalogLayer[] = CROSS_CANDIDATE_LAYERS,
): Array<{ layer: CatalogLayer; metric: MetricDef }> {
  const found: Array<{ layer: CatalogLayer; metric: MetricDef }> = [];

  for (const id of chunkIds) {
    if (!id.startsWith("metric-")) continue;

    /*
     * id는 `metric-<layerId>-<metricKey>`인데 둘 다 하이픈을 품을 수 있어
     * 문자열을 자르는 것으로는 못 가른다(kcb-grid-500m). 카탈로그를 돌며 맞춰 본다.
     */
    for (const layer of layers) {
      for (const metric of layer.metrics) {
        if (id === metricChunkId(layer.id, metric.key)) {
          found.push({ layer, metric });
        }
      }
    }
  }

  return found;
}
