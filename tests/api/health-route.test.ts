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
  it("uses refresh time for freshness while retaining creation time and hides internal errors", async () => {
    mocks.readPublishedSnapshotMeta.mockResolvedValueOnce({
      createdAt: "2026-07-18T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z",
      source: "fixture", snapshot: { referenceMonth: "2026-06", mode: "live", facilities: [] },
    });
    mocks.readSyncStatus.mockResolvedValueOnce({ lastStatus: "failed", lastError: "https://upstream?serviceKey=private-key" });
    mocks.computeStaleness.mockReturnValueOnce({ stale: true, recommendSync: true, reason: "최근 동기화가 실패했습니다." });
    const body = await (await GET()).json();
    expect(mocks.computeStaleness).toHaveBeenCalledWith("2026-09-07T00:00:00Z", expect.any(Object));
    expect(body.publishedLive.createdAt).toBe("2026-07-18T00:00:00Z");
    expect(body.publishedLive.updatedAt).toBe("2026-09-07T00:00:00Z");
    expect(JSON.stringify(body)).not.toContain("private-key");
  });

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
    expect(body.capabilities.scopeGyeongnam).toBe(true);
    expect(body.scope?.regions).toEqual(["경상남도"]);
    expect(body.scope?.hiraSidoCd).toContain("380000");
    expect(body.scope?.hiraSidoCd).not.toContain("210000");
    expect(body.syncOps.stale).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/public-key|serviceKey|apiKey/i);
  });

  it("reports the serving build commit for deploy timing", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc123def456");
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

    expect(body.build.commitSha).toBe("abc123def456");
  });

  it("reports null commit when the build env is absent", async () => {
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

    expect(body.build.commitSha).toBeNull();
  });
});
