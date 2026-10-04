/**
 * Lightweight sync status store for ops UI (last attempt / success / staleness).
 * Supabase is shared across instances; local storage is an offline fallback.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { getServiceSupabaseClient } from "@/lib/supabase/server";

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

const StatusSchema = z.object({
  lastAttemptAt: z.string().nullable(),
  lastSuccessAt: z.string().nullable(),
  lastStatus: z.string(),
  lastFacilityCount: z.number().nullable(),
  lastError: z.string().nullable(),
  lastPublished: z.boolean().nullable(),
  recommendedIntervalHours: z.number().positive(),
});

function storePath(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "sync-status.json");
}

export async function readSyncStatus(): Promise<SyncStatusRecord> {
  try {
    const client = getServiceSupabaseClient();
    if (client) {
      const { data, error } = await client.from("nurimap_sync_status")
        .select("payload").eq("id", "default").maybeSingle();
      const parsed = StatusSchema.safeParse(data?.payload);
      if (!error && parsed.success) {
        memory = parsed.data;
        return { ...memory };
      }
    }
  } catch {
    // Missing migration or unavailable database: retain offline operation.
  }
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
  const previous = await readSyncStatus();
  const definedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  memory = { ...previous, ...definedPatch };
  try {
    const client = getServiceSupabaseClient();
    if (client) {
      const { error } = await client.from("nurimap_sync_status").upsert({
        id: "default", payload: memory, updated_at: new Date().toISOString(),
      });
      if (!error) return { ...memory };
    }
  } catch {
    // Offline fallback below.
  }
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

  if (!Number.isFinite(publishMs)) {
    return {
      stale: true,
      hoursSincePublish: null,
      hoursSinceAttempt,
      recommendSync: Boolean(status.lastStatus),
      reason: "게시된 실측 자료가 없습니다. 시설 자료 갱신을 권장합니다.",
    };
  }

  if (status.lastStatus === "running" &&
      (!Number.isFinite(attemptMs) || now - attemptMs > 300_000)) {
    return {
      stale: true, hoursSincePublish, hoursSinceAttempt, recommendSync: true,
      reason: "최근 동기화가 실행 시간 내에 완료되지 않았습니다.",
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
      reason: "최근 동기화가 실패했습니다.",
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
