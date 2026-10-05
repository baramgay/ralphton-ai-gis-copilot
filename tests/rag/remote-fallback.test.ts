import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rerankWithRemoteEmbeddings: vi.fn() }));
vi.mock("@/lib/rag/embed-cache", () => mocks);
import { retrieveRagChunksWithRemote } from "@/lib/rag/retrieve-remote";
import { retrieveRagChunks } from "@/lib/rag/retrieve";

const deps = { apiKey: "fixture", baseUrl: "https://example.com/v1" };
afterEach(() => { vi.useRealTimers(); mocks.rerankWithRemoteEmbeddings.mockReset(); });

it("does not call an embedding provider when there is no evidence", async () => {
  mocks.rerankWithRemoteEmbeddings.mockResolvedValueOnce(null);
  expect(await retrieveRagChunksWithRemote({ query: "qzxvbnm" }, deps)).toEqual({ hits: [], remote: false });
  expect(mocks.rerankWithRemoteEmbeddings).not.toHaveBeenCalled();
});

it("keeps local evidence on ordinary remote exceptions", async () => {
  mocks.rerankWithRemoteEmbeddings.mockRejectedValueOnce(new Error("upstream unavailable"));
  const options = { query: "병원 부족", limit: 4 };
  expect(await retrieveRagChunksWithRemote(options, deps)).toEqual({ hits: retrieveRagChunks(options), remote: false });
});

it("returns local evidence within two seconds when remote embedding stalls", async () => {
  vi.useFakeTimers();
  mocks.rerankWithRemoteEmbeddings.mockImplementationOnce(() => new Promise(() => {}));
  const options = { query: "병원 부족", limit: 4 };
  let settled = false;
  const pending = retrieveRagChunksWithRemote(options, deps).then((result) => { settled = true; return result; });
  await vi.advanceTimersByTimeAsync(2001);
  expect(settled).toBe(true);
  expect(await pending).toEqual({ hits: retrieveRagChunks(options), remote: false });
});
