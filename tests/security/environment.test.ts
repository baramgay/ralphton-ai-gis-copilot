import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const expectedKeys = [
  "DATA_GO_KR_SERVICE_KEY",
  "KAKAO_REST_API_KEY",
  "NEXT_PUBLIC_KAKAO_MAP_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "QWEN_API_KEY",
  "QWEN_BASE_URL",
  "QWEN_JSON_FALLBACK_MODEL",
  "QWEN_PRIMARY_MODEL",
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
    const allowedPublicDefaults = new Set(["qwen3.7-max", "qwen3.7-plus"]);
    const secretLikeValueFound = entries.some(
      ([, value]) => value.length > 0 && !allowedPublicDefaults.has(value),
    );

    expect(exampleKeys.sort()).toEqual(expectedKeys.sort());
    expect(secretLikeValueFound).toBe(false);
  });
});
