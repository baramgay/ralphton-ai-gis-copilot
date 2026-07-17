import { describe, expect, test } from "vitest";

import { buildContentSecurityPolicy } from "../../next.config";

describe("content security policy", () => {
  test("allows unsafe-eval so Kakao Maps SDK can initialize", () => {
    // Kakao Maps main bundle calls eval("document.namespaces") — required in prod too.
    expect(buildContentSecurityPolicy(true)).toContain("'unsafe-eval'");
  });

  test("allows the Kakao SDK hosts", () => {
    const policy = buildContentSecurityPolicy(true);
    expect(policy).toContain("https://dapi.kakao.com");
    expect(policy).toContain("https://t1.daumcdn.net");
    expect(policy).toContain("https://*.daumcdn.net");
    expect(policy).toContain("worker-src 'self' blob:");
  });
});
