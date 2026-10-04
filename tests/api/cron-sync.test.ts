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

import { GET, maxDuration } from "@/app/api/cron/sync/route";

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

  it("persists incomplete start and records an ordinary throw as failed without secrets", async () => {
    mocks.runLiveSync.mockRejectedValueOnce(new Error("private-key upstream"));
    const response = await GET(new Request("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer cron-secret" },
    }));
    expect(mocks.writeSyncStatus.mock.calls[0]?.[0]).toMatchObject({ lastStatus: "running", lastPublished: false });
    expect(mocks.writeSyncStatus.mock.calls.at(-1)?.[0]).toMatchObject({ lastStatus: "failed", lastPublished: false });
    expect(mocks.writeSyncStatus.mock.calls.at(-1)?.[0]).not.toHaveProperty("lastSuccessAt");
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private-key");
  });

  it("rejects a spoofed cron header when CRON_SECRET is missing", async () => {
    vi.stubEnv("CRON_SECRET", "");
    mocks.runLiveSync.mockResolvedValueOnce({ status: "failed", published: false, facilityCount: 0, snapshot: {}, notes: [] });
    const response = await GET(new Request("http://localhost/api/cron/sync", {
      headers: { "x-vercel-cron": "1" },
    }));
    expect(response.status).toBe(401);
    expect(mocks.runLiveSync).not.toHaveBeenCalled();
  });

  it.each(["failed", "demo-only", "facilities-live"])("does not record unpublished %s as success", async (status) => {
    mocks.runLiveSync.mockResolvedValueOnce({
      status, published: false, facilityCount: 42,
      snapshot: { referenceMonth: "2026-06" }, notes: ["internal secret upstream"],
    });
    const response = await GET(new Request("http://localhost/api/cron/sync", {
      headers: { authorization: "Bearer cron-secret" },
    }));
    expect((await response.json()).ok).toBe(false);
    const patch = mocks.writeSyncStatus.mock.calls.at(-1)?.[0];
    expect(patch).not.toHaveProperty("lastSuccessAt");
  });

  it("declares a 300s ceiling like the manual sync route", () => {
    // 상한 선언이 없으면 기본 60초로 잘려 백필 전에 죽는다.
    expect(maxDuration).toBe(300);
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
    expect(mocks.runLiveSync).toHaveBeenCalledWith({ publish: true, datasets: ["facilities"], baseFrom: "published" });
    expect(JSON.stringify(body)).not.toMatch(/cron-secret|sync-secret/i);
  });
});
