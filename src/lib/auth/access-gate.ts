/**
 * 접근 게이트 판정.
 *
 * 민간 원천 자료에는 "외부 유출 금지(도 담당자 인가)" 표기가 있다. 동단위 집계가 협약
 * 범위를 벗어난다면 공개 URL 노출을 막아야 하는데, 그 판단은 데이터 소관 부서의 몫이라
 * 코드가 임의로 정할 수 없다.
 *
 * 그래서 게이트를 만들어 두되 기본은 꺼 둔다. 환경변수 RALPHTON_ACCESS_PASSWORD를 넣는
 * 순간 켜지고, 없으면 지금과 똑같이 동작한다. 담당 확인이 늦어지더라도 결정만 서면 배포
 * 한 번으로 즉시 닫을 수 있다.
 */
export type GateDecision =
  | { kind: "allow" }
  | { kind: "challenge" }
  | { kind: "unauthorized" };

/** 인증이 필요 없는 경로 — 잠긴 화면 자체와 정적 자산은 열어 둬야 한다. */
const PUBLIC_PREFIXES = ["/_next/", "/favicon", "/icon", "/apple-icon", "/robots.txt"];
/**
 * 잠긴 상태에서도 열어 두는 경로.
 * - /api/access: 인증 자체를 처리한다. 막으면 비밀번호를 넣어도 들어갈 수 없다.
 * - /api/health: 잠긴 화면이 서비스 상태를 물어야 한다.
 */
const PUBLIC_PATHS = ["/api/access", "/api/health"];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * 두 문자열을 길이에 상관없이 일정 시간으로 비교한다. 짧은 비밀번호에서 앞자리부터
 * 맞춰 나가는 타이밍 공격을 막는다.
 */
export function safeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < length; i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

export type GateInput = {
  /** 설정된 비밀번호. 비어 있으면 게이트를 켜지 않는다. */
  password: string | undefined;
  pathname: string;
  /** 브라우저가 보낸 인증 쿠키 값. */
  cookieValue: string | undefined;
};

export function decideAccess({ password, pathname, cookieValue }: GateInput): GateDecision {
  const secret = password?.trim();
  // 비밀번호가 설정되지 않았다면 게이트는 존재하지 않는 것과 같다.
  if (!secret) return { kind: "allow" };
  if (isPublicPath(pathname)) return { kind: "allow" };
  if (cookieValue && safeEqual(cookieValue, secret)) return { kind: "allow" };
  // API는 리다이렉트 대신 401로 끊어야 클라이언트가 오작동하지 않는다.
  return pathname.startsWith("/api/") ? { kind: "unauthorized" } : { kind: "challenge" };
}

export const ACCESS_COOKIE = "ralphton_access";
