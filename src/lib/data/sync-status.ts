/**
 * Lightweight sync status store for ops UI (last attempt / success / staleness).
 * File-backed when writable; in-memory fallback for serverless.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type SyncStatusRecord = {
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastStatus: "demo-only" | "facilities-live" | "failed" | "idle" | string;
  lastFacilityCount: number | null;
  lastError: string | null;
  lastPublished: boolean | null;
  recommendedIntervalHours: number;
};

const DEFAULT: SyncStatusRecord = {
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastStatus: "idle",
  lastFacilityCount: null,
  lastError: null,
  lastPublished: null,
  recommendedIntervalHours: 24,
};

let memory: SyncStatusRecord = { ...DEFAULT };

function storePath(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "sync-status.json");
}

export async function readSyncStatus(): Promise<SyncStatusRecord> {
  try {
    const text = await readFile(storePath(), "utf8");
    const parsed = JSON.parse(text) as Partial<SyncStatusRecord>;
    memory = { ...DEFAULT, ...parsed };
    return memory;
  } catch {
    return { ...memory };
  }
}

export async function writeSyncStatus(
  patch: Partial<SyncStatusRecord>,
): Promise<SyncStatusRecord> {
  memory = { ...memory, ...patch };
  try {
    const dir = path.dirname(storePath());
    await mkdir(dir, { recursive: true });
    await writeFile(storePath(), JSON.stringify(memory, null, 2), "utf8");
  } catch {
    // Vercel serverless may be read-only — memory still works per instance
  }
  return memory;
}

export function computeStaleness(
  publishedAt: string | null | undefined,
  status: SyncStatusRecord,
  now = Date.now(),
): {
  stale: boolean;
  hoursSincePublish: number | null;
  hoursSinceAttempt: number | null;
  recommendSync: boolean;
  reason: string | null;
} {
  const intervalMs = Math.max(1, status.recommendedIntervalHours) * 3600_000;
  const publishMs = publishedAt ? Date.parse(publishedAt) : NaN;
  const attemptMs = status.lastAttemptAt ? Date.parse(status.lastAttemptAt) : NaN;
  const hoursSincePublish = Number.isFinite(publishMs)
    ? (now - publishMs) / 3600_000
    : null;
  const hoursSinceAttempt = Number.isFinite(attemptMs)
    ? (now - attemptMs) / 3600_000
    : null;

  if (!publishedAt && status.lastStatus === "idle") {
    return {
      stale: true,
      hoursSincePublish: null,
      hoursSinceAttempt,
      recommendSync: Boolean(status.lastStatus),
      reason: "게시된 live 스냅샷이 없습니다. 시설 동기화를 권장합니다.",
    };
  }

  if (hoursSincePublish !== null && hoursSincePublish * 3600_000 > intervalMs) {
    return {
      stale: true,
      hoursSincePublish,
      hoursSinceAttempt,
      recommendSync: true,
      reason: `마지막 게시 후 ${Math.floor(hoursSincePublish)}시간 경과 (권장 ${status.recommendedIntervalHours}시간).`,
    };
  }

  if (status.lastStatus === "failed") {
    return {
      stale: true,
      hoursSincePublish,
      hoursSinceAttempt,
      recommendSync: true,
      reason: status.lastError ?? "최근 동기화가 실패했습니다.",
    };
  }

  return {
    stale: false,
    hoursSincePublish,
    hoursSinceAttempt,
    recommendSync: false,
    reason: null,
  };
}
