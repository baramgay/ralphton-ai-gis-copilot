import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const rpc = vi.fn();
const from = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServiceSupabaseClient: () => ({ rpc, from }) }));
import { readUsageDaily, recordUsage } from "@/lib/analytics/server";
const visitorId = "550e8400-e29b-41d4-a716-446655440000";
const event = { id: "550e8400-e29b-41d4-a716-446655440001", kind: "analysis" as const, datasets: ["medical", "medical"] };
beforeEach(() => { vi.stubEnv("NURIMAP_ANALYTICS_ADMIN_SECRET", "analytics-test-only-secret"); rpc.mockReset().mockResolvedValue({ error: null }); });
afterEach(() => vi.unstubAllEnvs());
describe("server analytics minimization", () => {
  it("sends only day-scoped opaque IDs and unique allowed datasets to an atomic RPC", async () => {
    expect(await recordUsage(visitorId, [event], new Date("2026-10-05T15:00:00Z"))).toEqual({ ok: true });
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("nurimap_record_usage");
    expect(args.p_day).toBe("2026-10-06");
    expect(args.p_visitorhash).toMatch(/^[a-f0-9]{64}$/);
    expect(args.p_events[0].receipt_id).toMatch(/^[a-f0-9]{64}$/);
    expect(args.p_events[0].datasets).toEqual(["medical"]);
    expect(JSON.stringify(args)).not.toContain(visitorId);
    expect(JSON.stringify(args)).not.toContain(event.id);
    expect(Object.keys(args)).toEqual(["p_day", "p_visitorhash", "p_events"]);
  });
  it("keeps retries identical but unlinkable across KST days or ID purposes", async () => {
    await recordUsage(visitorId, [event], new Date("2026-10-05T14:59:00Z"));
    await recordUsage(visitorId, [event], new Date("2026-10-05T14:59:00Z"));
    await recordUsage(visitorId, [event], new Date("2026-10-05T15:00:00Z"));
    expect(rpc.mock.calls[0][1]).toEqual(rpc.mock.calls[1][1]);
    expect(rpc.mock.calls[0][1].p_visitorhash).not.toBe(rpc.mock.calls[2][1].p_visitorhash);
    expect(rpc.mock.calls[0][1].p_visitorhash).not.toBe(rpc.mock.calls[0][1].p_events[0].receipt_id);
  });
  it("does not claim success or use volatile local counters when configuration or DB is unavailable", async () => {
    vi.stubEnv("NURIMAP_ANALYTICS_ADMIN_SECRET", "");
    expect(await recordUsage(visitorId, [event])).toEqual({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
    vi.stubEnv("NURIMAP_ANALYTICS_ADMIN_SECRET", "configured");
    rpc.mockResolvedValue({ error: { message: "private upstream details" } });
    expect(await recordUsage(visitorId, [event])).toEqual({ ok: false });
  });
  it("reads sparse aggregate datasets and explicitly bounds the queried KST interval", async () => {
    const data = [{ day: "2026-10-06", visits: 1, visitors: 1, analyses: 0, exports: 0, shares: 0, datasets: {} }];
    const query = { select: vi.fn(), gte: vi.fn(), lte: vi.fn(), order: vi.fn(), limit: vi.fn() };
    query.select.mockReturnValue(query); query.gte.mockReturnValue(query); query.lte.mockReturnValue(query);
    query.order.mockReturnValue(query); query.limit.mockResolvedValue({ data, error: null }); from.mockReturnValue(query);
    expect(await readUsageDaily(30, new Date("2026-10-05T15:00:00Z"))).toEqual(data);
    expect(from).toHaveBeenCalledWith("nurimap_usage_daily");
    expect(query.gte).toHaveBeenCalledWith("day", "2026-09-07");
    expect(query.lte).toHaveBeenCalledWith("day", "2026-10-06");
    expect(query.limit).toHaveBeenCalledWith(366);
    query.limit.mockResolvedValue({ data: null, error: { message: "secret schema details" } });
    await expect(readUsageDaily()).rejects.toThrow("Usage analytics unavailable");
  });
});
