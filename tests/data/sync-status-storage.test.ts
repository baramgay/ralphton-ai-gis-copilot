import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServiceSupabaseClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => mocks);
vi.mock("node:fs/promises", () => {
  const fs = {
    readFile: vi.fn().mockRejectedValue(new Error("offline")),
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
  return { ...fs, default: fs };
});

let stored: unknown = null;
beforeEach(() => {
  vi.resetModules();
  stored = null;
  mocks.getServiceSupabaseClient.mockReturnValue({ from: (table: string) => {
    expect(table).toBe("nurimap_sync_status");
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored, error: null }) }) }),
      upsert: async (row: unknown) => { stored = row; return { error: null }; },
    };
  } });
});
afterEach(() => vi.clearAllMocks());

it("shares persisted status with a fresh instance and preserves previous success", async () => {
  const first = await import("@/lib/data/sync-status");
  await first.writeSyncStatus({ lastSuccessAt: "2026-09-07T00:00:00Z", lastPublished: true });
  await first.writeSyncStatus({ lastAttemptAt: "2026-10-04T00:00:00Z", lastStatus: "running", lastPublished: false });
  vi.resetModules();
  const second = await import("@/lib/data/sync-status");
  expect((await second.readSyncStatus()).lastSuccessAt).toBe("2026-09-07T00:00:00Z");
  expect(await second.readSyncStatus()).toMatchObject({ lastStatus: "running", lastPublished: false });
  await second.writeSyncStatus({ lastStatus: "failed", lastPublished: false, lastSuccessAt: undefined });
  vi.resetModules();
  expect((await (await import("@/lib/data/sync-status")).readSyncStatus()).lastSuccessAt).toBe("2026-09-07T00:00:00Z");
});

it("falls back safely when the persistent store is unavailable", async () => {
  mocks.getServiceSupabaseClient.mockReturnValue(null);
  const { readSyncStatus, writeSyncStatus } = await import("@/lib/data/sync-status");
  await writeSyncStatus({ lastStatus: "failed", lastSuccessAt: undefined });
  expect((await readSyncStatus()).lastSuccessAt).toBeNull();
});
