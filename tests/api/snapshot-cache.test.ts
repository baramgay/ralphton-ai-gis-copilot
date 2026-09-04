import { describe, expect, test } from "vitest";

import { SNAPSHOT_CACHE_CONTROL } from "@/app/api/data/snapshot/route";

/**
 * 스냅샷 응답의 캐시 지시자 계약.
 *
 * 값을 쪼갤 때 정규식을 쓰지 않는다. `max-age`를 찾는 패턴이 `s-maxage`에도 걸려
 * 조용히 엉뚱한 숫자를 읽는다 — 이 검사에서 확인해야 할 것이 바로 그 둘의 크기 비교라
 * 거기서 틀리면 검사가 통째로 무의미해진다.
 */
function directive(name: string): number | null {
  for (const part of SNAPSHOT_CACHE_CONTROL.split(",")) {
    const [key, value] = part.trim().split("=");
    if (key === name) return Number(value);
  }
  return null;
}

describe("스냅샷 캐시 계약", () => {
  test("지시자를 이름으로 정확히 가른다", () => {
    // max-age와 s-maxage를 섞어 읽으면 아래 비교가 통째로 무의미해진다.
    expect(directive("max-age")).not.toBe(directive("s-maxage"));
  });

  test("CDN 신선도(s-maxage)를 지정한다", () => {
    // 없으면 CDN이 60초마다 만료시키고 그 순간의 방문자가 콜드스타트를 그대로 기다린다.
    expect(directive("s-maxage")).toBeGreaterThanOrEqual(60);
  });

  test("max-age가 s-maxage보다 크다 — 아니면 preload가 무용지물이 된다", () => {
    /*
     * Vercel은 클라이언트에게 `s-maxage`·`stale-while-revalidate`를 지우고 `max-age`만
     * 남기면서, CDN에 머문 시간을 `Age`에 실어 준다. `max-age`가 `s-maxage`보다 작으면
     * CDN에 오래 머문 응답이 브라우저에 **도착하는 순간 이미 만료**된다(실측 `Age: 67`
     * vs `max-age=60`). 그러면 미리 받아 둔 것을 곧이어 부르는 fetch가 쓰지 못하고
     * 313KB를 한 번 더 내려받는다 — 미리 받는 이유가 사라진다.
     */
    const maxAge = directive("max-age");
    const sMaxAge = directive("s-maxage");
    expect(maxAge).not.toBeNull();
    expect(sMaxAge).not.toBeNull();
    expect(maxAge as number).toBeGreaterThan(sMaxAge as number);
  });

  test("낡은 응답을 즉시 주고 뒤에서 갱신한다", () => {
    expect(directive("stale-while-revalidate")).toBeGreaterThan(0);
  });
});
