import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ADMIN_COOKIE, ADMIN_SESSION_SECONDS, adminSecret, equalSecret, issueAdminSession, sameOrigin } from '@/lib/analytics/auth';

const headers = { 'Cache-Control': 'private, no-store' };
const BodySchema = z.object({ password: z.string().min(1).max(200) }).strict();
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ notice: '허용되지 않은 요청입니다.' }, { status: 403, headers });
  const secret = adminSecret();
  if (!secret) return NextResponse.json({ notice: '사용 통계 관리자 설정이 필요합니다.' }, { status: 503, headers });
  let body: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('body');
    let bytes = 0;
    let text = '';
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel(); return NextResponse.json({ notice: '요청 본문이 너무 큽니다.' }, { status: 413, headers }); }
      text += decoder.decode(value, { stream: true });
    }
    body = JSON.parse(text + decoder.decode());
  } catch { return NextResponse.json({ notice: '요청 형식이 올바르지 않습니다.' }, { status: 400, headers }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ notice: '관리자 비밀번호를 입력해 주세요.' }, { status: 400, headers });
  if (!equalSecret(parsed.data.password, secret)) return NextResponse.json({ notice: '비밀번호가 올바르지 않습니다.' }, { status: 401, headers });
  const response = NextResponse.json({ ok: true }, { headers });
  response.cookies.set(ADMIN_COOKIE, issueAdminSession(secret), { httpOnly: true, sameSite: 'strict', secure: new URL(request.url).protocol === 'https:', path: '/api/usage', maxAge: ADMIN_SESSION_SECONDS });
  return response;
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ notice: '허용되지 않은 요청입니다.' }, { status: 403, headers: headers });
  const response = NextResponse.json({ ok: true }, { headers });
  response.cookies.set(ADMIN_COOKIE, '', { httpOnly: true, sameSite: 'strict', secure: new URL(request.url).protocol === 'https:', path: '/api/usage', maxAge: 0 });
  return response;
}
