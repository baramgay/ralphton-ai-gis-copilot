import { CopilotApp } from "@/components/copilot/copilot-app";

const BOUNDARY_VERSION = "20260701";

/**
 * 첫 화면이 늦는 이유는 서버가 아니라 순서였다. TTFB 180ms · FCP 0.5초인데 내용이 보이는
 * 것은 2.2초 — 두 데이터(행정동 경계 1.1MB · 스냅샷 320KB)를 **JS가 다 실행된 뒤에야**
 * 요청하기 때문이다(실측 시작 시각 812ms). 브라우저에게 미리 알려 주면 JS를 받는 동안
 * 같이 받는다.
 *
 * URL은 클라이언트가 실제로 부르는 것과 **글자 하나까지 같아야** 한다 — 어긋나면 1.1MB를
 * 두 번 받는다. `mode=auto`는 `snapshotMode`의 초기값이고, 사용자가 시연 데이터로 바꾸면
 * 그때 다른 주소를 부르지만 그건 첫 화면 뒤의 일이다.
 * (같은 출처 fetch는 기본 credentials가 "same-origin"이므로 crossOrigin을 주지 않는다.
 *  주면 자격증명 모드가 어긋나 preload가 재사용되지 않고 그대로 두 번 받는다.)
 */
export default function Home() {
  return (
    <>
      <link
        rel="preload"
        as="fetch"
        href={`/data/administrative-dong-${BOUNDARY_VERSION}.geojson`}
      />
      <link rel="preload" as="fetch" href="/api/data/snapshot?mode=auto" />
      <CopilotApp
        boundaryVersion={BOUNDARY_VERSION}
        kakaoMapKey={process.env.NEXT_PUBLIC_KAKAO_MAP_KEY}
      />
    </>
  );
}
