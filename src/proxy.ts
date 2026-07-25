import { NextResponse, type NextRequest } from "next/server";

import { ACCESS_COOKIE, decideAccess } from "@/lib/auth/access-gate";

/**
 * 접근 게이트. RALPHTON_ACCESS_PASSWORD가 설정된 경우에만 동작하며, 없으면 모든 요청을
 * 그대로 통과시킨다(현재 배포는 이 상태).
 *
 * 민간 원천의 "외부 유출 금지" 표기 때문에 공개 노출을 닫아야 할 수 있는데, 그 판단은
 * 데이터 소관 부서의 몫이다. 결정이 서면 환경변수만 넣어 즉시 닫을 수 있도록 미리 둔다.
 */
export default function proxy(request: NextRequest) {
  const decision = decideAccess({
    password: process.env.RALPHTON_ACCESS_PASSWORD,
    pathname: request.nextUrl.pathname,
    cookieValue: request.cookies.get(ACCESS_COOKIE)?.value,
  });

  if (decision.kind === "allow") return NextResponse.next();

  if (decision.kind === "unauthorized") {
    return NextResponse.json(
      { error: "인증이 필요합니다.", notice: "접근 권한이 필요한 서비스입니다." },
      { status: 401 },
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  // 로그인 후 원래 보려던 곳으로 돌려보낸다.
  loginUrl.search = `?next=${encodeURIComponent(request.nextUrl.pathname)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // /login 자체는 게이트에서 제외해야 무한 리다이렉트가 나지 않는다.
  matcher: ["/((?!login).*)"],
};
