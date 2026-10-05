import { describe, expect, it } from "vitest";
import { cosine, createTextEmbeddings } from "@/lib/rag/embeddings";

const deps = { apiKey: "fixture", baseUrl: "https://example.com/v1" };
const respond = (data: unknown) => async () => Response.json({ data });

describe("embedding response validation", () => {
  it("restores vectors to their input indices", async () => {
    expect(await createTextEmbeddings({ ...deps, fetch: respond([
      { index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] },
    ]) }, ["first", "second"])).toEqual([[1, 0], [0, 1]]);
  });

  it.each([
    [{ index: 0, embedding: [1, 0] }, { index: 0, embedding: [0, 1] }],
    [{ index: 0, embedding: [1, 0] }, { index: 2, embedding: [0, 1] }],
    [{ index: 0, embedding: [1, 0] }, { index: 1, embedding: [1] }],
    [{ index: 0, embedding: [] }, { index: 1, embedding: [] }],
    [{ index: 0, embedding: [0, 0] }, { index: 1, embedding: [0, 1] }],
    [{ index: 0, embedding: [null, 1] }, { index: 1, embedding: [0, 1] }],
    [{ index: 0, embedding: ["1", 0] }, { index: 1, embedding: [0, 1] }],
    [{ embedding: [1, 0] }, { embedding: [0, 1] }],
  ].map((rows) => [rows]))("rejects invalid indices or vectors instead of corrupting similarity: %j", async (rows) => {
    expect(await createTextEmbeddings({ ...deps, fetch: respond(rows) }, ["first", "second"])).toBeNull();
  });

  it("batches corpus inputs within the provider's ten-input limit", async () => {
    const sizes: number[] = [];
    const vectors = await createTextEmbeddings({ ...deps, fetch: async (_url, init) => {
      const { input } = JSON.parse(init!.body as string) as { input: string[] };
      sizes.push(input.length);
      if (input.length > 10) return Response.json({}, { status: 400 });
      return Response.json({ data: input.map((text, index) => ({ index, embedding: [Number(text) + 1, 1] })) });
    } }, Array.from({ length: 23 }, (_, index) => String(index)));
    expect(sizes).toEqual([10, 10, 3]);
    expect(vectors).toHaveLength(23);
    expect(vectors?.[22]).toEqual([23, 1]);
  });

  it.each([
    [[1], [1, 2]], [[Number.NaN, 1], [1, 2]], [[Infinity, 1], [1, 2]], [[0, 0], [1, 2]],
  ])("returns zero for incompatible cosine vectors: %j", (left, right) => {
    expect(cosine(left, right)).toBe(0);
  });
});
