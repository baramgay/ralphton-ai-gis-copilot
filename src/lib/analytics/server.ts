import { createHmac } from "node:crypto";
import { z } from "zod";
import { getServiceSupabaseClient } from "@/lib/supabase/server";
import { kstDay, usageStartDay, type UsageDailyRow } from "./aggregate";
import { UsageBatchSchema, USAGE_DATASETS, type UsageEvent } from "./catalog";

export async function recordUsage(visitorId: string, events: UsageEvent[], now = new Date()): Promise<{ ok: boolean }> {
  const secret = process.env.NURIMAP_ANALYTICS_ADMIN_SECRET?.trim();
  const client = getServiceSupabaseClient();
  const parsed = UsageBatchSchema.safeParse({ visitorId, events });
  if (!secret || !client || !parsed.success) return { ok: false };
  const day = kstDay(now);
  const hash = (purpose: "visitor" | "event", id: string) => createHmac("sha256", secret)
    .update(`nurimap-usage:${purpose}:${day}:${id}`).digest("hex");
  try {
    const { error } = await client.rpc("nurimap_record_usage", {
      p_day: day,
      p_visitorhash: hash("visitor", parsed.data.visitorId),
      p_events: parsed.data.events.map((event) => ({
        receipt_id: hash("event", event.id), kind: event.kind, datasets: [...new Set(event.datasets)],
      })),
    });
    return { ok: !error };
  } catch { return { ok: false }; }
}

const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const DailyRowSchema = z.object({
  day: z.string(), visits: counter, visitors: counter, analyses: counter, exports: counter, shares: counter,
  datasets: z.record(z.string().refine((id) => USAGE_DATASETS.some((item) => item.id === id)), counter),
}).strict();

/** Missing configuration, migration or DB errors remain visible to the administrator. */
export async function readUsageDaily(days: 30 | 90 | 365 = 365, now = new Date()): Promise<UsageDailyRow[]> {
  const client = getServiceSupabaseClient();
  if (!process.env.NURIMAP_ANALYTICS_ADMIN_SECRET?.trim() || !client) throw new Error("Usage analytics unavailable");
  const { data, error } = await client.from("nurimap_usage_daily")
    .select("day,visits,visitors,analyses,exports,shares,datasets")
    .gte("day", usageStartDay(days, now)).lte("day", kstDay(now)).order("day", { ascending: true }).limit(366);
  if (error) throw new Error("Usage analytics unavailable");
  const parsed = z.array(DailyRowSchema).safeParse(data);
  if (!parsed.success) throw new Error("Usage analytics data invalid");
  return parsed.data;
}
