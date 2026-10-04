import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncMocks = vi.hoisted(() => ({
  runLiveSync: vi.fn(),
  readPublishedSnapshotMeta: vi.fn(),
  readSyncStatus: vi.fn(),
  writeSyncStatus: vi.fn(),
  computeStaleness: vi.fn(),
}));

vi.mock("@/lib/data/live-sync", () => ({
  runLiveSync: syncMocks.runLiveSync,
}));

vi.mock("@/lib/supabase/public", () => ({
  readPublishedSnapshotMeta: syncMocks.readPublishedSnapshotMeta,
}));

vi.mock("@/lib/data/sync-status", () => ({
  readSyncStatus: syncMocks.readSyncStatus,
  writeSyncStatus: syncMocks.writeSyncStatus,
  computeStaleness: syncMocks.computeStaleness,
}));

import { GET, POST } from "@/app/api/data/sync/route";

describe("/api/data/sync", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_SYNC_SECRET", "test-secret");
    syncMocks.runLiveSync.mockReset();
    syncMocks.readPublishedSnapshotMeta.mockReset();
    syncMocks.readSyncStatus.mockReset();
    syncMocks.writeSyncStatus.mockReset();
    syncMocks.computeStaleness.mockReset();
    syncMocks.writeSyncStatus.mockImplementation(async (patch) => patch);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("GET returns syncOps staleness without secrets", async () => {
    syncMocks.readPublishedSnapshotMeta.mockResolvedValueOnce(null);
    syncMocks.readSyncStatus.mockResolvedValueOnce({
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastStatus: "idle",
      lastFacilityCount: null,
      lastError: null,
      lastPublished: null,
      recommendedIntervalHours: 24,
    });
    syncMocks.computeStaleness.mockReturnValueOnce({
      stale: true,
      hoursSincePublish: null,
      hoursSinceAttempt: null,
      recommendSync: true,
      reason: "게시된 실측 자료가 없습니다.",
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.syncOps.stale).toBe(true);
    expect(body.syncOps.recommendSync).toBe(true);
    expect(body.publishedLive.available).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/test-secret|serviceKey|apiKey/i);
  });

  it("rejects missing secret", async () => {
    const response = await POST(
      new Request("http://localhost/api/data/sync", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
  });

  it("persists incomplete start and records an ordinary throw as failed", async () => {
    syncMocks.runLiveSync.mockRejectedValueOnce(new Error("private-key upstream"));
    const response = await POST(new Request("http://localhost/api/data/sync", {
      method: "POST", headers: { "x-sync-secret": "test-secret" }, body: "{}",
    }));
    expect(syncMocks.writeSyncStatus.mock.calls[0]?.[0]).toMatchObject({ lastStatus: "running", lastPublished: false });
    expect(syncMocks.writeSyncStatus.mock.calls.at(-1)?.[0]).toMatchObject({ lastStatus: "failed", lastPublished: false });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private-key");
  });

  it("reports a requested publication failure without advancing success", async () => {
    syncMocks.runLiveSync.mockResolvedValueOnce({
      status: "facilities-live", published: false, facilityCount: 42,
      snapshot: { mode: "live", referenceMonth: "2026-06" }, checksum: "a".repeat(64), notes: [],
    });
    const response = await POST(new Request("http://localhost/api/data/sync", {
      method: "POST", headers: { "x-sync-secret": "test-secret" }, body: "{}",
    }));
    expect((await response.json()).ok).toBe(false);
    expect(syncMocks.writeSyncStatus.mock.calls.at(-1)?.[0]).toMatchObject({ lastStatus: "failed", lastPublished: false });
    expect(syncMocks.writeSyncStatus.mock.calls.at(-1)?.[0]).not.toHaveProperty("lastSuccessAt");
  });

  it("runs sync with valid secret, records status, omits credentials", async () => {
    syncMocks.runLiveSync.mockResolvedValueOnce({
      status: "demo-only",
      snapshot: {
        mode: "demo",
        referenceMonth: "2026-06",
        months: [],
        regions: [],
        facilities: [],
        sourceNotes: [],
      },
      checksum: "a".repeat(64),
      facilityCount: 10,
      published: false,
      notes: ["ok"],
    });

    const response = await POST(
      new Request("http://localhost/api/data/sync", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-sync-secret": "test-secret",
        },
        body: JSON.stringify({ publish: false }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.facilityCount).toBe(10);
    expect(syncMocks.writeSyncStatus).toHaveBeenCalled();
    expect(syncMocks.writeSyncStatus.mock.calls.at(-1)?.[0]).not.toHaveProperty("lastSuccessAt");
    expect(JSON.stringify(body)).not.toMatch(/test-secret|serviceKey|apiKey/i);
  });
});
