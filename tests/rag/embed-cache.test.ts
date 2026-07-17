import { beforeEach, describe, expect, it, vi } from "vitest";

const embedMocks = vi.hoisted(() => ({
  createTextEmbeddings: vi.fn(),
}));

vi.mock("@/lib/rag/embeddings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rag/embeddings")>(
    "@/lib/rag/embeddings",
  );
  return {
    ...actual,
    createTextEmbeddings: embedMocks.createTextEmbeddings,
  };
});

import { RAG_CORPUS } from "@/lib/rag/corpus";
import {
  ensureCorpusEmbeddings,
  getEmbedCacheMeta,
  rerankWithRemoteEmbeddings,
} from "@/lib/rag/embed-cache";

function unitVector(seed: number, dim = 8): number[] {
  const v = Array.from({ length: dim }, (_, i) => Math.sin(seed + i) + 0.1);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

describe("embed-cache", () => {
  beforeEach(() => {
    embedMocks.createTextEmbeddings.mockReset();
  });

  it("returns null when remote embed fails", async () => {
    embedMocks.createTextEmbeddings.mockResolvedValueOnce(null);
    const map = await ensureCorpusEmbeddings({
      apiKey: "k",
      baseUrl: "https://example.com/v1",
    });
    expect(map).toBeNull();
  });

  it("warms corpus vectors and exposes meta", async () => {
    embedMocks.createTextEmbeddings.mockImplementation(async (_deps, texts: string[]) =>
      texts.map((_, i) => unitVector(i + 1)),
    );

    const map = await ensureCorpusEmbeddings({
      apiKey: "k",
      baseUrl: "https://example.com/v1",
      model: "text-embedding-v3",
    });

    expect(map).not.toBeNull();
    expect(map!.size).toBe(RAG_CORPUS.length);
    expect(map!.has(RAG_CORPUS[0].id)).toBe(true);

    const meta = getEmbedCacheMeta();
    expect(meta.ready).toBe(true);
    expect(meta.model).toBe("text-embedding-v3");
    expect(meta.chunkCount).toBe(RAG_CORPUS.length);
  });

  it("reranks chunk ids with remote query embedding", async () => {
    embedMocks.createTextEmbeddings.mockImplementation(async (_deps, texts: string[]) =>
      texts.map((_, i) => unitVector(i === 0 && texts.length === 1 ? 99 : i + 1)),
    );

    await ensureCorpusEmbeddings({
      apiKey: "k",
      baseUrl: "https://example.com/v1",
    });

    const scores = await rerankWithRemoteEmbeddings(
      "의료 취약",
      [RAG_CORPUS[0].id, RAG_CORPUS[1].id],
      { apiKey: "k", baseUrl: "https://example.com/v1" },
    );

    expect(scores).not.toBeNull();
    expect(scores!.size).toBe(2);
    for (const score of scores!.values()) {
      expect(typeof score).toBe("number");
      expect(Number.isFinite(score)).toBe(true);
    }
  });
});
