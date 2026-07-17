import { describe, expect, it } from "vitest";

import {
  computeStaleness,
  type SyncStatusRecord,
} from "@/lib/data/sync-status";

const base: SyncStatusRecord = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastStatus: "idle",
  lastFacilityCount: null,
  lastError: null,
  lastPublished: null,
  recommendedIntervalHours: 24,
};

describe("computeStaleness", () => {
  it("flags idle without published snapshot", () => {
    const result = computeStaleness(null, base, Date.parse("2026-07-17T00:00:00Z"));
    expect(result.stale).toBe(true);
    expect(result.recommendSync).toBe(true);
    expect(result.reason).toMatch(/스냅샷이 없습니다/);
  });

  it("flags publish older than recommended interval", () => {
    const now = Date.parse("2026-07-17T12:00:00Z");
    const publishedAt = new Date(now - 30 * 3600_000).toISOString();
    const result = computeStaleness(publishedAt, base, now);
    expect(result.stale).toBe(true);
    expect(result.recommendSync).toBe(true);
    expect(result.hoursSincePublish).toBeGreaterThan(24);
    expect(result.reason).toMatch(/경과/);
  });

  it("is fresh when published within interval", () => {
    const now = Date.parse("2026-07-17T12:00:00Z");
    const publishedAt = new Date(now - 2 * 3600_000).toISOString();
    const result = computeStaleness(
      publishedAt,
      { ...base, lastStatus: "facilities-live", lastSuccessAt: publishedAt },
      now,
    );
    expect(result.stale).toBe(false);
    expect(result.recommendSync).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("flags failed sync even if publish is recent", () => {
    const now = Date.parse("2026-07-17T12:00:00Z");
    const publishedAt = new Date(now - 1 * 3600_000).toISOString();
    const result = computeStaleness(
      publishedAt,
      {
        ...base,
        lastStatus: "failed",
        lastError: "upstream timeout",
        lastAttemptAt: publishedAt,
      },
      now,
    );
    expect(result.stale).toBe(true);
    expect(result.recommendSync).toBe(true);
    expect(result.reason).toMatch(/timeout|실패/);
  });
});
