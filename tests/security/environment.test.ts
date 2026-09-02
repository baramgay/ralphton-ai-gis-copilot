import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const expectedKeys = [
  "CRON_ALERT_WEBHOOK",
  "CRON_SECRET",
  "DATA_GO_KR_SERVICE_KEY",
  "DATA_SYNC_SECRET",
  "HIRA_HOSP_SERVICE_KEY",
  "KAKAO_REST_API_KEY",
  "LIVE_POPULATION_DISABLED",
  "NEXT_PUBLIC_KAKAO_MAP_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_JSON_FALLBACK_MODEL",
  "DEEPSEEK_PRIMARY_MODEL",
  "EMBED_API_KEY",
  "EMBED_BASE_URL",
  "EMBED_MODEL",
  "RAG_REMOTE_EMBED",
  "SUPABASE_SERVICE_ROLE_KEY",
];

describe("environment example", () => {
  it("documents exactly the supported environment variables without secrets", async () => {
    const example = await readFile(resolve(process.cwd(), ".env.example"), "utf8");
    const entries = example
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");

        return [line.slice(0, separator), line.slice(separator + 1)] as const;
      });

    const exampleKeys = entries.map(([key]) => key);
    const allowedPublicDefaults = new Set(["deepseek-v4-flash", "deepseek-v4-pro"]);
    const secretLikeValueFound = entries.some(
      ([, value]) => value.length > 0 && !allowedPublicDefaults.has(value),
    );

    expect(exampleKeys.sort()).toEqual(expectedKeys.sort());
    expect(secretLikeValueFound).toBe(false);
    expect(Object.fromEntries(entries)).toMatchObject({
      DEEPSEEK_PRIMARY_MODEL: "deepseek-v4-flash",
      DEEPSEEK_JSON_FALLBACK_MODEL: "deepseek-v4-pro",
    });
  });
});
