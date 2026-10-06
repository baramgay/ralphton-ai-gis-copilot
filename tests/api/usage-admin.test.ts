import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const readUsageDaily = vi.fn();
vi.mock("@/lib/analytics/server", () => ({ readUsageDaily: (...args: unknown[]) => readUsageDaily(...args) }));
import { GET } from "@/app/api/usage/stats/route";
import { POST, DELETE } from "@/app/api/usage/access/route";
import { ADMIN_COOKIE, issueAdminSession, validAdminSession } from "@/lib/analytics/auth";
import type { UsageDailyRow } from "@/lib/analytics/aggregate";

const secret = "usage-admin-api-test-secret-at-least-32-characters";
const now = new Date("2026-10-05T15:00:00.000Z");
const cookie = () => `${ADMIN_COOKIE}=${issueAdminSession(secret)}`;
const stats = (query = "", session: string | undefined = cookie()) => GET(new Request(`https://gnbc.site/api/usage/stats${query}`, {
  headers: session ? { cookie: session } : {},
}));
const access = (body: string, origin = "https://gnbc.site") => POST(new Request("https://gnbc.site/api/usage/access", {
  method: "POST", headers: { origin, "content-type": "application/json" }, body,
}));
const row = (day: string, patch: Partial<UsageDailyRow>): UsageDailyRow => ({
  day, visits: 0, visitors: 0, analyses: 0, exports: 0, shares: 0, datasets: {}, ...patch,
});

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv("NURIMAP_ANALYTICS_ADMIN_SECRET", secret);
  readUsageDaily.mockReset().mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("usage administrator statistics", () => {
  it("requires independent signed admin authentication before reading any usage data", async () => {
    for (const session of ["", "ralphton_access=valid-public-access", `${ADMIN_COOKIE}=${secret}`, `${ADMIN_COOKIE}=${issueAdminSession("wrong-secret")}`]) {
      expect((await stats("", session)).status).toBe(401);
    }
    expect(readUsageDaily).not.toHaveBeenCalled();
  });
  it("shows missing configuration or database/migration errors, never fabricated zero totals", async () => {
    vi.stubEnv("NURIMAP_ANALYTICS_ADMIN_SECRET", "");
    expect((await stats()).status).toBe(503);
    expect(readUsageDaily).not.toHaveBeenCalled();
    vi.stubEnv("NURIMAP_ANALYTICS_ADMIN_SECRET", secret);
    readUsageDaily.mockRejectedValue(new Error("private upstream migration details"));
    const response = await stats();
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).not.toHaveProperty("totals");
    expect(JSON.stringify(body)).not.toContain("private upstream");
  });
  it.each(["?period=year", "?days=0", "?days=366", "?period=DAY", "?days=31", "?query=private-text"])("rejects unsupported query %s", async (query) => {
    expect((await stats(query)).status).toBe(400);
    expect(readUsageDaily).not.toHaveBeenCalled();
  });
  it.each(["day", "week", "month"])("returns accurate %s counts, KST boundaries and sparse source labels", async (period) => {
    readUsageDaily.mockResolvedValue([
      row("2026-09-06", { visits: 99, visitors: 99 }),
      row("2026-10-04", { visits: 2, visitors: 2 }),
      row("2026-10-05", { visits: 3, visitors: 2, analyses: 2, datasets: { medical: 2, "skt-living": 2 } }),
      row("2026-10-06", { visits: 1, visitors: 1, analyses: 1, exports: 1, shares: 1, datasets: { medical: 1, "resident-vital": 1 } }),
      row("2026-10-07", { visits: 99, visitors: 99 }),
    ]);
    const response = await stats(`?period=${period}&days=30`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body.timezone).toBe("Asia/Seoul");
    expect(body.startDate).toBe("2026-09-07"); expect(body.endDate).toBe("2026-10-06");
    expect(body.totals).toMatchObject({ visits: 6, visitors: 5, analyses: 3, exports: 1, shares: 1 });
    expect(body.totals.datasets).toEqual({ medical: 3, "skt-living": 2, "resident-vital": 1 });
    expect(readUsageDaily).toHaveBeenCalledWith(30, now);
    expect(body.datasets).toEqual([
      { id: "medical", label: "의료기관", provider: "건강보험심사평가원", count: 3 },
      { id: "skt-living", label: "생활인구", provider: "SKT", count: 2 },
      { id: "resident-vital", label: "출생등록·사망말소", provider: "행정안전부", count: 1 },
    ]);
    if (period === "day") expect(body.series).toHaveLength(30);
    if (period === "week") {
      expect(body.series.find((item: { date: string }) => item.date === "2026-09-28").visitors).toBe(2);
      expect(body.series.find((item: { date: string }) => item.date === "2026-10-05").visitors).toBe(3);
    }
    if (period === "month") expect(body.series.map((item: { date: string; visitors: number }) => [item.date, item.visitors])).toEqual([["2026-09-01", 0], ["2026-10-01", 5]]);
  });
});

describe("usage administrator access and logout", () => {
  it("sets a short-lived HttpOnly signed cookie without returning the password", async () => {
    const response = await access(JSON.stringify({ password: secret }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const setCookie = response.headers.get("set-cookie")!;
    for (const attribute of ["HttpOnly", "Secure", "SameSite=strict", "Path=/api/usage", "Max-Age=43200"]) expect(setCookie).toContain(attribute);
    expect(setCookie).not.toContain(secret);
    const token = setCookie.split(";", 1)[0].slice(ADMIN_COOKIE.length + 1);
    expect(validAdminSession(token, secret)).toBe(true);
  });
  it("rejects a wrong password without setting a session cookie", async () => {
    const response = await access(JSON.stringify({ password: "wrong" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
  it("rejects foreign-origin login before password processing", async () => {
    const response = await access(JSON.stringify({ password: secret }), "https://attacker.example");
    expect(response.status).toBe(403); expect(response.headers.get("set-cookie")).toBeNull();
  });
  it.each(["{", JSON.stringify({ password: secret, extra: "unapproved" }), JSON.stringify({ password: "" })])("rejects malformed or extra-field login", async (body) => {
    expect((await access(body)).status).toBe(400);
  });
  it("bounds login bytes including multibyte input", async () => {
    expect((await access(JSON.stringify({ password: "한".repeat(1500) }))).status).toBe(413);
  });
  it("clears its independent admin cookie only on same-origin logout", async () => {
    const response = await DELETE(new Request("https://gnbc.site/api/usage/access", { method: "DELETE", headers: { origin: "https://gnbc.site", cookie: cookie() } }));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(`${ADMIN_COOKIE}=;`);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    const foreign = await DELETE(new Request("https://gnbc.site/api/usage/access", { method: "DELETE", headers: { origin: "https://attacker.example" } }));
    expect(foreign.status).toBe(403); expect(foreign.headers.get("set-cookie")).toBeNull();
  });
});
