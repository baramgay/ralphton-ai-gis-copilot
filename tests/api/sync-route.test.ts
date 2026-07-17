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
      reason: "게시된 live 스냅샷이 없습니다.",
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
    expect(JSON.stringify(body)).not.toMatch(/test-secret|serviceKey|apiKey/i);
  });
});
