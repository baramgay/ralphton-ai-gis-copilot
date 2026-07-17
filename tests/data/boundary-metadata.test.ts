import { describe, expect, it } from "vitest";

import { parseBoundaryMetadata } from "@/lib/data/boundary-metadata";

describe("boundary page metadata", () => {
  it("accepts a validated version and checksum for the server-rendered shell", () => {
    expect(parseBoundaryMetadata({
      version: "20260701",
      sha256: "a".repeat(64),
      featureCount: 206,
    })).toMatchObject({ version: "20260701", sha256: "a".repeat(64), featureCount: 206 });
  });

  it("rejects stale-looking or malformed metadata instead of silently hardcoding a version", () => {
    expect(() => parseBoundaryMetadata({
      version: "latest",
      sha256: "not-a-checksum",
      featureCount: 0,
    })).toThrow();
  });
});
