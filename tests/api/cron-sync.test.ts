import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runLiveSync: vi.fn(),
  writeSyncStatus: vi.fn(),
}));

vi.mock("@/lib/data/live-sync", () => ({
  runLiveSync: mocks.runLiveSync,
}));

vi.mock("@/lib/data/sync-status", () => ({
  writeSyncStatus: mocks.writeSyncStatus,
}));

import { GET } from "@/app/api/cron/sync/route";

describe("/api/cron/sync", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("DATA_SYNC_SECRET", "sync-secret");
    mocks.runLiveSync.mockReset();
    mocks.writeSyncStatus.mockReset();
    mocks.writeSyncStatus.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects unauthorized", async () => {
    const response = await GET(new Request("http://localhost/api/cron/sync"));
    expect(response.status).toBe(401);
  });

  it("accepts Vercel CRON_SECRET bearer and publishes", async () => {
    mocks.runLiveSync.mockResolvedValueOnce({
      status: "facilities-live",
      snapshot: {
        mode: "live",
        referenceMonth: "2026-06",
        months: [],
        regions: [],
        facilities: [],
        sourceNotes: [],
      },
      checksum: "b".repeat(64),
      facilityCount: 42,
      published: true,
      notes: ["cron ok"],
    });

    const response = await GET(
      new Request("http://localhost/api/cron/sync", {
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.source).toBe("cron");
    expect(body.facilityCount).toBe(42);
    expect(mocks.runLiveSync).toHaveBeenCalledWith({ publish: true });
    expect(JSON.stringify(body)).not.toMatch(/cron-secret|sync-secret/i);
  });
});
