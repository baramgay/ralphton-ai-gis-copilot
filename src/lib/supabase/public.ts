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

export async function readPublishedSnapshot(
  mode: "demo" | "live",
): Promise<PublishedSnapshot | null> {
  const client = getPublicSupabaseClient();

  if (!client) {
    return null;
  }

  try {
    const { data, error } = await client
      .from("data_snapshots")
      .select("payload")
      .eq("is_published", true)
      .eq("mode", mode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return null;
    }

    const parsed = CachedSnapshotSchema.safeParse(data.payload);
    return parsed.success ? parsed.data : null;
  } catch {
    // The cache is optional. Transport and provider errors must leave the
    // bundled demo path available without leaking provider details.
    return null;
  }
}
