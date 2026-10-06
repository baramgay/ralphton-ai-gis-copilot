import { afterEach, beforeEach, expect, it, vi } from "vitest";
const recordUsage = vi.fn();
vi.mock("@/lib/analytics/server", () => ({ recordUsage: (...args: unknown[]) => recordUsage(...args) }));
import { POST } from "@/app/api/usage/events/route";
const batch = { visitorId: "550e8400-e29b-41d4-a716-446655440000", events: [{ id: "550e8400-e29b-41d4-a716-446655440001", kind: "analysis", datasets: ["medical"] }] };
const send = (body: unknown, origin = "https://gnbc.site") => POST(new Request("https://gnbc.site/api/usage/events", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body),
}));
beforeEach(() => { recordUsage.mockReset().mockResolvedValue({ ok: true }); });
afterEach(() => vi.unstubAllEnvs());
it("accepts a strict same-origin bounded batch", async () => {
  expect((await send(batch)).status).toBe(200);
  expect(recordUsage).toHaveBeenCalledWith(batch.visitorId, batch.events);
});
it.each([{ ...batch, query: "개인 질문" }, { ...batch, ip: "127.0.0.1" }, { ...batch, userAgent: "browser" },
  { ...batch, events: [{ ...batch.events[0], region: "진주시" }] },
  { ...batch, events: [{ ...batch.events[0], datasets: ["unknown-source"] }] },
  { ...batch, events: Array(21).fill(batch.events[0]) },
  { ...batch, events: [] },
  { ...batch, events: [{ ...batch.events[0], datasets: [] }] },
  ...["visit", "export", "share"].map((kind) => ({ ...batch, events: [{ ...batch.events[0], kind }] })),
])("rejects extra fields, unknown datasets and invalid batch size", async (body) => {
  expect((await send(body)).status).toBe(400);
  expect(recordUsage).not.toHaveBeenCalled();
});
it("rejects cross-origin submissions", async () => {
  expect((await send(batch, "https://attacker.example")).status).toBe(403);
  expect(recordUsage).not.toHaveBeenCalled();
});
it("requires the exact JSON media type and an origin", async () => {
  const wrongType = new Request("https://gnbc.site/api/usage/events", {
    method: "POST", headers: { origin: "https://gnbc.site", "content-type": "application/jsonp" }, body: JSON.stringify(batch),
  });
  expect((await POST(wrongType)).status).toBe(415);
  const missingOrigin = new Request("https://gnbc.site/api/usage/events", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(batch),
  });
  expect((await POST(missingOrigin)).status).toBe(403);
  expect(recordUsage).not.toHaveBeenCalled();
});
it("bounds payload bytes before parsing", async () => {
  const response = await send({ padding: "x".repeat(17_000) });
  expect(response.status).toBe(413);
  expect(recordUsage).not.toHaveBeenCalled();
});
it("does not report unavailable persistence as successful tracking", async () => {
  recordUsage.mockResolvedValue({ ok: false });
  const response = await send(batch);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false });
});
