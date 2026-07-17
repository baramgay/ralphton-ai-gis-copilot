import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabaseMocks.createClient,
}));

async function readPublicSource(): Promise<string> {
  return readFile(path.join(process.cwd(), "src/lib/supabase/public.ts"), "utf8");
}

async function readServerSource(): Promise<string> {
  return readFile(path.join(process.cwd(), "src/lib/supabase/server.ts"), "utf8");
}

function emptySupabaseEnv() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
}

describe("server/client boundary", () => {
  beforeEach(() => {
    vi.resetModules();
    supabaseMocks.createClient.mockReset();
    emptySupabaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps service credentials and write helpers out of the public module", async () => {
    const publicSource = await readPublicSource();
    const serverSource = await readServerSource();

    expect(publicSource).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(publicSource).not.toContain("upsertSnapshotWithServiceRole");
    expect(serverSource).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(serverSource).toContain("upsertSnapshotWithServiceRole");
  });

  it("does not construct clients when credentials are missing", async () => {
    const { getPublicSupabaseClient } = await import("@/lib/supabase/public");
    const { getServiceSupabaseClient } = await import("@/lib/supabase/server");

    expect(getPublicSupabaseClient()).toBeNull();
    expect(getServiceSupabaseClient()).toBeNull();
    expect(supabaseMocks.createClient).not.toHaveBeenCalled();
  });

  it("creates the anon client with public credentials only", async () => {
    const client = { from: vi.fn() };
    supabaseMocks.createClient.mockReturnValue(client);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://public-project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-anon-value");

    const { getPublicSupabaseClient } = await import("@/lib/supabase/public");

    expect(getPublicSupabaseClient()).toBe(client);
    expect(getPublicSupabaseClient()).toBe(client);
    expect(supabaseMocks.createClient).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.createClient).toHaveBeenCalledWith(
      "https://public-project.supabase.co",
      "fixture-anon-value",
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false }),
      }),
    );
  });

  it("creates the service client with the service role key", async () => {
    const client = { from: vi.fn() };
    supabaseMocks.createClient.mockReturnValue(client);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://server-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-value");

    const { getServiceSupabaseClient } = await import("@/lib/supabase/server");

    expect(getServiceSupabaseClient()).toBe(client);
    expect(getServiceSupabaseClient()).toBe(client);
    expect(supabaseMocks.createClient).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.createClient).toHaveBeenCalledWith(
      "https://server-project.supabase.co",
      "fixture-service-value",
      expect.objectContaining({
        auth: expect.objectContaining({ persistSession: false, autoRefreshToken: false }),
      }),
    );
  });

  it("does not leak the service key in error messages", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://server-project.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "fixture-service-value");

    const { upsertSnapshotWithServiceRole } = await import("@/lib/supabase/server");

    const upsert = vi.fn().mockResolvedValue({
      error: new Error("fixture-service-value should not appear"),
    });
    supabaseMocks.createClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ upsert }),
    });

    const result = await upsertSnapshotWithServiceRole({
      id: "test",
      source: "test",
      checksum: "a".repeat(64),
      isPublished: false,
      snapshot: {
        mode: "demo",
        referenceMonth: "2026-01",
        months: ["2026-01"],
        regions: [],
        facilities: [],
        sourceNotes: ["test"],
      } as never,
    });

    expect(result).toBe(false);
  });
});
