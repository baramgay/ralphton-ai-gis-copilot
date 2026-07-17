import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const syncMocks = vi.hoisted(() => ({
  runLiveSync: vi.fn(),
}));

vi.mock("@/lib/data/live-sync", () => ({
  runLiveSync: syncMocks.runLiveSync,
}));

import { POST } from "@/app/api/data/sync/route";

describe("/api/data/sync", () => {
  beforeEach(() => {
    vi.stubEnv("DATA_SYNC_SECRET", "test-secret");
    syncMocks.runLiveSync.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  it("runs sync with valid secret and omits credentials", async () => {
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
    expect(JSON.stringify(body)).not.toMatch(/test-secret|serviceKey|apiKey/i);
  });
});
