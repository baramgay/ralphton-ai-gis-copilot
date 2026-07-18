import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { LiveSnapshot } from "@/lib/data/normalize-public-data";
import type { DemoSnapshot } from "@/lib/domain/schemas";
import { SnapshotCacheWriteSchema } from "@/lib/supabase/types";

let serviceClient: SupabaseClient | null = null;

export type ServiceSnapshot = DemoSnapshot | LiveSnapshot;

export interface UpsertSnapshotInput {
  id: string;
  source: string;
  checksum: string;
  isPublished: boolean;
  snapshot: ServiceSnapshot;
}

/** Child table for facility rows — must not collide with eum-jido public.facilities. */
export const AI_GIS_FACILITIES_TABLE = "ai_gis_facilities";

const FACILITY_BATCH = 400;
const REGION_BATCH = 200;

export function getServiceSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    return null;
  }

  if (!serviceClient) {
    serviceClient = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  return serviceClient;
}

async function upsertInBatches<T>(
  client: SupabaseClient,
  table: string,
  rows: T[],
  batchSize: number,
): Promise<string | null> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const { error } = await client.from(table).upsert(chunk);
    if (error) {
      return error.message;
    }
  }
  return null;
}

/**
 * Publish snapshot for public read.
 * Parent `data_snapshots.payload` is required for the app.
 * Child tables are best-effort (failure does not block publish).
 */
export async function upsertSnapshotWithServiceRole(
  input: UpsertSnapshotInput,
): Promise<boolean> {
  const client = getServiceSupabaseClient();

  if (!client) {
    return false;
  }

  const parsed = SnapshotCacheWriteSchema.safeParse(input);
  if (!parsed.success) {
    return false;
  }

  const { snapshot } = parsed.data;

  try {
    const parentResult = await client.from("data_snapshots").upsert({
      id: parsed.data.id,
      source: parsed.data.source,
      checksum: parsed.data.checksum,
      is_published: parsed.data.isPublished,
      mode: snapshot.mode,
      reference_month: snapshot.referenceMonth,
      months: snapshot.months,
      source_notes: snapshot.sourceNotes,
      payload: snapshot,
      updated_at: new Date().toISOString(),
    });
    if (parentResult.error) {
      return false;
    }

    if (snapshot.regions.length > 0) {
      await upsertInBatches(
        client,
        "region_metrics",
        snapshot.regions.map((region) => ({
          snapshot_id: parsed.data.id,
          adm_cd2: region.adm_cd2,
          adm_nm: region.adm_nm,
          series: region,
        })),
        REGION_BATCH,
      );
    }

    if (snapshot.facilities.length > 0) {
      await upsertInBatches(
        client,
        AI_GIS_FACILITIES_TABLE,
        snapshot.facilities.map((facility) => ({
          snapshot_id: parsed.data.id,
          facility_id: facility.id,
          adm_cd2: facility.adm_cd2,
          name: facility.name,
          type: facility.type,
          lat: facility.lat,
          lng: facility.lng,
          specialties: facility.specialties,
          hours: facility.hours,
          address: facility.address ?? null,
          phone: facility.phone ?? null,
          payload: facility,
        })),
        FACILITY_BATCH,
      );
    }

    return true;
  } catch {
    return false;
  }
}
