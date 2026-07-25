import { describe, expect, test } from "vitest";

import { decideAccess, isPublicPath, safeEqual } from "@/lib/auth/access-gate";

describe("decideAccess", () => {
  test("비밀번호가 없으면 게이트는 아예 동작하지 않는다", () => {
    // 기본은 꺼진 상태 — 지금까지의 동작이 그대로 유지되어야 한다.
    expect(decideAccess({ password: undefined, pathname: "/", cookieValue: undefined })).toEqual({
      kind: "allow",
    });
    expect(decideAccess({ password: "   ", pathname: "/", cookieValue: undefined })).toEqual({
      kind: "allow",
    });
  });

  test("비밀번호가 설정되면 쿠키 없는 페이지 요청은 잠금 화면으로 보낸다", () => {
    expect(decideAccess({ password: "s3cret", pathname: "/", cookieValue: undefined })).toEqual({
      kind: "challenge",
    });
  });

  test("API는 리다이렉트가 아니라 401로 끊는다", () => {
    // 페이지처럼 리다이렉트하면 클라이언트가 HTML을 JSON으로 파싱해 오작동한다.
    expect(
      decideAccess({ password: "s3cret", pathname: "/api/data/snapshot", cookieValue: undefined }),
    ).toEqual({ kind: "unauthorized" });
  });

  test("올바른 쿠키를 가진 요청은 통과시킨다", () => {
    expect(decideAccess({ password: "s3cret", pathname: "/", cookieValue: "s3cret" })).toEqual({
      kind: "allow",
    });
  });

  test("틀린 쿠키는 통과시키지 않는다", () => {
    expect(decideAccess({ password: "s3cret", pathname: "/", cookieValue: "wrong" })).toEqual({
      kind: "challenge",
    });
    // 접두사만 맞아도 안 된다
    expect(decideAccess({ password: "s3cret", pathname: "/", cookieValue: "s3c" })).toEqual({
      kind: "challenge",
    });
  });

  test("인증 API를 막으면 로그인 자체가 불가능하므로 열어 둔다", () => {
    // 실제로 막아 두는 바람에 비밀번호를 넣어도 401이 나던 결함이 있었다.
    expect(
      decideAccess({ password: "s3cret", pathname: "/api/access", cookieValue: undefined }),
    ).toEqual({ kind: "allow" });
  });

  test("잠금 화면과 정적 자산, 상태 API는 잠긴 상태에서도 열려 있다", () => {
    for (const pathname of ["/_next/static/chunk.js", "/favicon.ico", "/api/health", "/api/access"]) {
      expect(
        decideAccess({ password: "s3cret", pathname, cookieValue: undefined }),
        `${pathname}는 잠긴 상태에서도 열려야 한다`,
      ).toEqual({ kind: "allow" });
    }
  });

  test("민간데이터 정적 큐브는 잠금 대상이다", () => {
    // 게이트를 켜는 이유가 바로 이 파일들이다. /_next/ 예외에 휩쓸리면 안 된다.
    expect(
      decideAccess({
        password: "s3cret",
        pathname: "/data/layers/kcb-credit.json",
        cookieValue: undefined,
      }),
    ).toEqual({ kind: "challenge" });
  });
});

describe("isPublicPath", () => {
  test("정적 자산 접두사를 알아본다", () => {
    expect(isPublicPath("/_next/static/a.js")).toBe(true);
    expect(isPublicPath("/favicon.ico")).toBe(true);
    expect(isPublicPath("/api/health")).toBe(true);
  });

  test("데이터 경로는 공개 목록에 없다", () => {
    expect(isPublicPath("/data/layers/kcb-credit.json")).toBe(false);
    expect(isPublicPath("/api/data/snapshot")).toBe(false);
  });
});

describe("safeEqual", () => {
  test("같은 값만 참으로 본다", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "ab")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
