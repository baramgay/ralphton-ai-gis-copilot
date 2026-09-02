import { describe, expect, test } from "vitest";

import { CROSS_CANDIDATE_LAYERS } from "@/lib/layers/catalog";
import { buildCatalogRagChunks, layerChunkId, metricChunkId } from "@/lib/rag/catalog-chunks";
import { RAG_CORPUS } from "@/lib/rag/corpus";
import { retrieveRagChunks } from "@/lib/rag/retrieve";

const ALL_METRICS = CROSS_CANDIDATE_LAYERS.flatMap((layer) =>
  layer.metrics.map((metric) => ({ layer, metric })),
);

describe("catalog RAG coverage", () => {
  test("every layer and metric in the catalog has a chunk", () => {
    const ids = new Set(RAG_CORPUS.map((chunk) => chunk.id));
    const missing: string[] = [];

    for (const layer of CROSS_CANDIDATE_LAYERS) {
      if (!ids.has(layerChunkId(layer.id))) missing.push(layerChunkId(layer.id));
      for (const metric of layer.metrics) {
        const id = metricChunkId(layer.id, metric.key);
        if (!ids.has(id)) missing.push(id);
      }
    }

    expect(missing).toEqual([]);
  });

  test("corpus ids stay unique after merging curated and generated chunks", () => {
    const ids = RAG_CORPUS.map((chunk) => chunk.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("the private-data layers that carry the main feature are covered", () => {
    const covered = RAG_CORPUS.filter((chunk) => chunk.tags.includes("catalog"));
    const providers = new Set(
      covered.flatMap((chunk) => chunk.tags.filter((tag) => ["SKT", "NH", "KCB"].includes(tag))),
    );

    expect([...providers].sort()).toEqual(["KCB", "NH", "SKT"]);
    expect(covered.length).toBeGreaterThanOrEqual(ALL_METRICS.length);
  });

  test.each(ALL_METRICS.map(({ layer, metric }) => [layer.id, metric.key, metric.triggers[0]] as const))(
    "retrieval reaches %s/%s from its own wording (%s)",
    (layerId, metricKey, trigger) => {
      /*
       * 지표 하나하나가 자기 낱말로 검색되는지 본다. 코퍼스에 있다는 것과 찾힌다는 것은
       * 다르다 — 손으로 쓴 코퍼스가 이 검사를 통과한 적은 한 번도 없다(민간 지표가
       * 아예 없었으므로).
       */
      const hits = retrieveRagChunks({ query: trigger, limit: 5 });
      const ids = hits.map((hit) => hit.chunk.id);

      expect(ids).toContain(metricChunkId(layerId, metricKey));
    },
  );

  test("generated chunks never claim the admin unit a grid layer cannot answer", () => {
    const grid = CROSS_CANDIDATE_LAYERS.find((layer) => layer.geometry === "grid");
    expect(grid).toBeDefined();

    const chunks = buildCatalogRagChunks([grid!]);
    expect(chunks.length).toBeGreaterThan(1);

    for (const chunk of chunks) {
      expect(chunk.body).toContain("500m 격자 칸");
      expect(chunk.body).not.toContain("답하는 단위는 행정동이다");
    }
  });
});
