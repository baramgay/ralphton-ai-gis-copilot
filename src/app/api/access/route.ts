import { NextResponse } from "next/server";
import { z } from "zod";

import { ACCESS_COOKIE, safeEqual } from "@/lib/auth/access-gate";

const BodySchema = z.object({ password: z.string().min(1).max(200) }).strict();

/**
 * 접근 비밀번호 확인. 맞으면 인증 쿠키를 심는다.
 * 게이트가 꺼져 있으면(비밀번호 미설정) 인증할 것도 없으므로 그대로 통과 처리한다.
 */
export async function POST(request: Request) {
  const secret = process.env.RALPHTON_ACCESS_PASSWORD?.trim();
  if (!secret) {
    return NextResponse.json({ ok: true, notice: "접근 제한이 설정되어 있지 않습니다." });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, notice: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, notice: "비밀번호를 입력해 주세요." }, { status: 400 });
  }

  if (!safeEqual(parsed.data.password, secret)) {
    return NextResponse.json({ ok: false, notice: "비밀번호가 올바르지 않습니다." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, secret, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return response;
}
