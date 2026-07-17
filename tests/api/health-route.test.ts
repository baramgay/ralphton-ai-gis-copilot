import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readPublishedSnapshotMeta: vi.fn(),
  readSyncStatus: vi.fn(),
  computeStaleness: vi.fn(),
}));

vi.mock("@/lib/supabase/public", () => ({
  readPublishedSnapshotMeta: mocks.readPublishedSnapshotMeta,
}));

vi.mock("@/lib/data/sync-status", () => ({
  readSyncStatus: mocks.readSyncStatus,
  computeStaleness: mocks.computeStaleness,
}));

import { GET } from "@/app/api/health/route";

describe("/api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.readPublishedSnapshotMeta.mockReset();
    mocks.readSyncStatus.mockReset();
    mocks.computeStaleness.mockReset();
  });

  it("exposes populationLive and syncOps without secrets", async () => {
    vi.stubEnv("DATA_GO_KR_SERVICE_KEY", "public-key");
    vi.stubEnv("LIVE_POPULATION_DISABLED", "");
    mocks.readPublishedSnapshotMeta.mockResolvedValueOnce(null);
    mocks.readSyncStatus.mockResolvedValueOnce({
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastStatus: "idle",
      lastFacilityCount: null,
      lastError: null,
      lastPublished: null,
      recommendedIntervalHours: 24,
    });
    mocks.computeStaleness.mockReturnValueOnce({
      stale: true,
      recommendSync: true,
      reason: "no live",
      hoursSincePublish: null,
      hoursSinceAttempt: null,
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.capabilities.populationLive).toBe(true);
    expect(body.capabilities.publicData).toBe(true);
    expect(body.capabilities.scopeBusanGyeongnam).toBe(true);
    expect(body.scope?.regions).toEqual(["부산광역시", "경상남도"]);
    expect(body.scope?.hiraSidoCd).toContain("210000");
    expect(body.syncOps.stale).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/public-key|serviceKey|apiKey/i);
  });
});
