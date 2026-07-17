import { describe, expect, test } from "vitest";

import { buildContentSecurityPolicy } from "../../next.config";

describe("content security policy", () => {
  test("does not allow eval in production", () => {
    expect(buildContentSecurityPolicy(true)).not.toContain("'unsafe-eval'");
  });

  test("allows the Kakao SDK hosts", () => {
    const policy = buildContentSecurityPolicy(true);
    expect(policy).toContain("https://dapi.kakao.com");
    expect(policy).toContain("https://t1.daumcdn.net");
    expect(policy).toContain("https://*.daumcdn.net");
    expect(policy).toContain("worker-src 'self' blob:");
  });
});
