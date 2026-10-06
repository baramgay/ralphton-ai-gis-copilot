import { describe, expect, test } from "vitest";

import { buildContentSecurityPolicy } from "../../next.config";

describe("content security policy", () => {
  test.each([true, false])("allows Kakao's current core script CDN in production=%s", (production) => {
    const directives = buildContentSecurityPolicy(production).split(";").map((value) => value.trim());
    for (const name of ["script-src", "script-src-elem"]) {
      const directive = directives.find((value) => value.startsWith(`${name} `));
      expect(directive?.split(/\s+/)).toContain("https://t1.kakaocdn.net");
    }
  });
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
