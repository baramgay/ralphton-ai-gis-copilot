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
    if (parentResult.error) return false;

    if (snapshot.regions.length > 0) {
      const regionResult = await client.from("region_metrics").upsert(
        snapshot.regions.map((region) => ({
          snapshot_id: parsed.data.id,
          adm_cd2: region.adm_cd2,
          adm_nm: region.adm_nm,
          series: region,
        })),
      );
      if (regionResult.error) return false;
    }

    if (snapshot.facilities.length > 0) {
      const facilityResult = await client.from("facilities").upsert(
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
      );
      if (facilityResult.error) return false;
    }

    return true;
  } catch {
    return false;
  }
}
