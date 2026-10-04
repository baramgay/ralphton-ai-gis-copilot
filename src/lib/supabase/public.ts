import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { DemoSnapshot } from "@/lib/domain/schemas";
import type { LiveSnapshot } from "@/lib/data/normalize-public-data";
import { CachedSnapshotSchema } from "@/lib/supabase/types";

let publicClient: SupabaseClient | null = null;

export type PublishedSnapshot = DemoSnapshot | LiveSnapshot;

export function getPublicSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  if (!publicClient) {
    publicClient = createClient(url, key, {
      auth: { persistSession: false },
    });
  }

  return publicClient;
}

export function createPublicClient(): SupabaseClient {
  const client = getPublicSupabaseClient();

  if (!client) {
    throw new Error("Supabase public credentials are not configured.");
  }

  return client;
}

export type PublishedSnapshotMeta = {
  snapshot: PublishedSnapshot;
  createdAt: string | null;
  updatedAt: string | null;
  source: string | null;
  checksum: string | null;
};

/** Sync callers must distinguish an empty cache from an unreadable cache. */
export async function readPublishedSnapshotMetaOrThrow(
  mode: "demo" | "live",
): Promise<PublishedSnapshotMeta | null> {
  const client = getPublicSupabaseClient();

  if (!client) {
    throw new Error("게시 자료 저장소에 연결할 수 없습니다.");
  }

  try {
    const { data, error } = await client
      .from("data_snapshots")
      .select("payload, created_at, updated_at, source, checksum")
      .eq("is_published", true)
      .eq("mode", mode)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error("게시 자료를 읽지 못했습니다.");
    if (!data) return null;

    const parsed = CachedSnapshotSchema.safeParse(data.payload);
    if (!parsed.success) throw new Error("게시 자료를 검증하지 못했습니다.");
    return {
      snapshot: parsed.data,
      createdAt: typeof data.created_at === "string" ? data.created_at : null,
      updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
      source: typeof data.source === "string" ? data.source : null,
      checksum: typeof data.checksum === "string" ? data.checksum : null,
    };
  } catch {
    throw new Error("게시 자료를 읽거나 검증하지 못했습니다.");
  }
}

/** Public reads preserve the offline demo fallback. */
export async function readPublishedSnapshotMeta(
  mode: "demo" | "live",
): Promise<PublishedSnapshotMeta | null> {
  try {
    return await readPublishedSnapshotMetaOrThrow(mode);
  } catch {
    return null;
  }
}

export async function readPublishedSnapshot(
  mode: "demo" | "live",
): Promise<PublishedSnapshot | null> {
  const meta = await readPublishedSnapshotMeta(mode);
  return meta?.snapshot ?? null;
}
