import { beforeEach, describe, expect, it, vi } from "vitest";

const embedMocks = vi.hoisted(() => ({
  createTextEmbeddings: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return { ...actual, writeFile: embedMocks.writeFile, default: { ...actual, writeFile: embedMocks.writeFile } };
});

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
  resetEmbedCacheForTests,
} from "@/lib/rag/embed-cache";

function unitVector(seed: number, dim = 8): number[] {
  const v = Array.from({ length: dim }, (_, i) => Math.sin(seed + i) + 0.1);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

describe("embed-cache", () => {
  beforeEach(() => {
    embedMocks.createTextEmbeddings.mockReset();
    embedMocks.writeFile.mockReset();
    resetEmbedCacheForTests();
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
    expect(embedMocks.writeFile).not.toHaveBeenCalled();
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

  it("does not reuse vectors from another provider with the same model", async () => {
    embedMocks.createTextEmbeddings.mockImplementation(async (_deps, texts: string[]) =>
      texts.map((_, i) => unitVector(i + 1)),
    );
    await ensureCorpusEmbeddings({ apiKey: "k", baseUrl: "https://provider-a.example/v1", model: "shared-model" });
    await ensureCorpusEmbeddings({ apiKey: "k", baseUrl: "https://provider-b.example/v1", model: "shared-model" });
    expect(embedMocks.createTextEmbeddings).toHaveBeenCalledTimes(2);
  });

  it("rejects query vectors with a different dimension instead of reporting a remote rerank", async () => {
    embedMocks.createTextEmbeddings.mockImplementation(async (_deps, texts: string[]) =>
      texts.map(() => texts.length === 1 ? [1, 0, 0] : [1, 0]),
    );
    expect(await rerankWithRemoteEmbeddings("병원 부족", [RAG_CORPUS[0].id], {
      apiKey: "k", baseUrl: "https://example.com/v1",
    })).toBeNull();
  });

  it("invalidates vectors when the corpus text changes without changing its size", async () => {
    embedMocks.createTextEmbeddings.mockImplementation(async (_deps, texts: string[]) =>
      texts.map((_, i) => unitVector(i + 1)),
    );
    const deps = { apiKey: "k", baseUrl: "https://example.com/v1" };
    await ensureCorpusEmbeddings(deps);
    const original = RAG_CORPUS[0].body;
    try {
      RAG_CORPUS[0].body = `${original} Updated definition.`;
      await ensureCorpusEmbeddings(deps);
      expect(embedMocks.createTextEmbeddings).toHaveBeenCalledTimes(2);
    } finally {
      RAG_CORPUS[0].body = original;
    }
  });
});
