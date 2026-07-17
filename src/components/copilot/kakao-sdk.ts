/**
 * Kakao Maps JS SDK loader — 위키 정본 + 랄프톤 운영 함정 반영
 * [[method-kakao-maps-nextjs]] · [[nextjs-kakao-maps-react19]] · [[method-kakao-maps-nextjs-dynamic]]
 *
 * 함정 (2026-07-17 prod):
 * - libraries=services,clusterer 요청 시 bootstrap이 readyState=1에서
 *   후속 스크립트 체인 중단 → maps.load 콜백 미호출 → 15s 타임아웃 → DemoMap
 * - 해결: 기본은 코어(v3)만 로드. MarkerClusterer는 선택(없어도 plain marker).
 * - CSP script-src에 'unsafe-eval' 필요 (kakao.js eval)
 */
export type KakaoLatLng = object;

export type KakaoMapInstance = {
  setCenter(position: KakaoLatLng): void;
  setLevel?(level: number): void;
  relayout?(): void;
};

export type KakaoOverlay = {
  setMap(map: KakaoMapInstance | null): void;
};

export type KakaoMarker = KakaoOverlay;

export type KakaoMarkerClusterer = {
  addMarkers(markers: KakaoMarker[]): void;
  clear(): void;
};

export type KakaoMapsNamespace = {
  load(callback: () => void): void;
  LatLng: new (lat: number, lng: number) => KakaoLatLng;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoLatLng; level: number },
  ) => KakaoMapInstance;
  Polygon: new (options: {
    path: KakaoLatLng[] | KakaoLatLng[][];
    strokeWeight: number;
    strokeColor: string;
    strokeOpacity: number;
    fillColor: string;
    fillOpacity: number;
  }) => KakaoOverlay;
  Marker: new (options: { position: KakaoLatLng; title?: string }) => KakaoMarker;
  MarkerClusterer?: new (options: {
    map: KakaoMapInstance;
    averageCenter: boolean;
    minLevel: number;
  }) => KakaoMarkerClusterer;
  Circle: new (options: {
    center: KakaoLatLng;
    radius: number;
    strokeWeight: number;
    strokeColor: string;
    strokeOpacity: number;
    strokeStyle: string;
    fillColor: string;
    fillOpacity: number;
  }) => KakaoOverlay;
  event: {
    addListener(target: object, eventName: string, handler: () => void): void;
  };
  readyState?: number;
};

declare global {
  interface Window {
    kakao?: { maps: KakaoMapsNamespace };
  }
}

const SCRIPT_ID = "kakao-maps-sdk";
const CLUSTERER_SCRIPT_ID = "kakao-maps-clusterer";
/** Official clusterer bundle — load AFTER core SDK (never via libraries= param). */
export const KAKAO_CLUSTERER_URL =
  "https://t1.daumcdn.net/mapjsapi/js/libs/clusterer/1.1.1/clusterer.js";
const LOAD_TIMEOUT_MS = 12_000;

let readyPromise: Promise<KakaoMapsNamespace> | null = null;
let clustererPromise: Promise<boolean> | null = null;

/** Core map only — do not pass libraries= (services/clusterer chain can hang). */
export function buildKakaoSdkUrl(appKey: string): string {
  const url = new URL("https://dapi.kakao.com/v2/maps/sdk.js");
  url.searchParams.set("appkey", appKey.trim());
  url.searchParams.set("autoload", "false");
  return url.toString();
}

/**
 * 2-stage clusterer: inject clusterer.js only after core Map is ready.
 * Returns false on failure — callers fall back to plain markers.
 */
export function ensureMarkerClusterer(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (typeof window.kakao?.maps?.MarkerClusterer === "function") {
    return Promise.resolve(true);
  }
  if (clustererPromise) return clustererPromise;

  clustererPromise = new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (!ok) clustererPromise = null;
      resolve(ok);
    };

    const existing = document.getElementById(CLUSTERER_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (typeof window.kakao?.maps?.MarkerClusterer === "function") {
        done(true);
        return;
      }
      existing.addEventListener(
        "load",
        () => done(typeof window.kakao?.maps?.MarkerClusterer === "function"),
        { once: true },
      );
      existing.addEventListener("error", () => done(false), { once: true });
      window.setTimeout(
        () => done(typeof window.kakao?.maps?.MarkerClusterer === "function"),
        3_000,
      );
      return;
    }

    const script = document.createElement("script");
    script.id = CLUSTERER_SCRIPT_ID;
    script.async = true;
    script.charset = "UTF-8";
    script.src = KAKAO_CLUSTERER_URL;
    script.onload = () => done(typeof window.kakao?.maps?.MarkerClusterer === "function");
    script.onerror = () => done(false);
    document.head.appendChild(script);
    window.setTimeout(
      () => done(typeof window.kakao?.maps?.MarkerClusterer === "function"),
      4_000,
    );
  });

  return clustererPromise;
}

function isMapsReady(maps: KakaoMapsNamespace | undefined): boolean {
  return Boolean(
    maps && typeof maps.LatLng === "function" && typeof maps.Map === "function",
  );
}

function domainHint(): string {
  if (typeof location === "undefined") return "";
  return ` 현재 도메인(${location.origin})을 Kakao Developers → 앱 설정 → 플랫폼 → Web 에 등록했는지 확인하세요.`;
}

export function loadKakaoSdk(appKey: string): Promise<KakaoMapsNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Kakao Maps SDK는 브라우저에서만 로드할 수 있습니다."));
  }
  if (!appKey.trim()) {
    return Promise.reject(new Error("Kakao Maps 공개 앱 키가 없습니다."));
  }
  if (readyPromise) return readyPromise;

  readyPromise = new Promise<KakaoMapsNamespace>((resolve, reject) => {
    let settled = false;
    let pollId: number | undefined;

    const cleanup = () => {
      window.clearTimeout(timer);
      if (pollId !== undefined) window.clearInterval(pollId);
    };

    const finishOk = (maps: KakaoMapsNamespace) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(maps);
    };

    const finishErr = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      readyPromise = null;
      reject(error);
    };

    const timer = window.setTimeout(() => {
      // Last chance: core constructors ready even if maps.load hung
      if (isMapsReady(window.kakao?.maps)) {
        finishOk(window.kakao!.maps);
        return;
      }
      finishErr(
        new Error(
          `Kakao Maps SDK 로드 시간 초과.${domainHint()} 네트워크·CSP(eval)·도메인을 확인하세요.`,
        ),
      );
    }, LOAD_TIMEOUT_MS);

    // Poll: bootstrap can leave readyState=1 if library chain stalls; core Map is enough.
    pollId = window.setInterval(() => {
      if (isMapsReady(window.kakao?.maps)) {
        finishOk(window.kakao!.maps);
      }
    }, 120);

    const afterLoad = () => {
      const maps = window.kakao?.maps;
      if (!maps) {
        finishErr(
          new Error(
            `Kakao Maps SDK 전역 객체가 없습니다. JavaScript 키 또는 웹 도메인 등록 문제일 수 있습니다.${domainHint()}`,
          ),
        );
        return;
      }

      if (isMapsReady(maps)) {
        finishOk(maps);
        return;
      }

      if (typeof maps.load !== "function") {
        finishErr(
          new Error(
            `Kakao Maps load 함수가 없습니다.${domainHint()}`,
          ),
        );
        return;
      }

      try {
        maps.load(() => {
          const ready = window.kakao?.maps;
          if (ready && isMapsReady(ready)) {
            finishOk(ready);
            return;
          }
          // Keep polling until timeout — do not hard-fail mid-chain
        });
      } catch (error) {
        // Still allow poll/timeout paths
        console.warn("[kakao-sdk] maps.load threw", error);
      }
    };

    const existingMaps = window.kakao?.maps;

    if (existingMaps && isMapsReady(existingMaps)) {
      finishOk(existingMaps);
      return;
    }

    if (existingMaps && typeof existingMaps.load === "function") {
      afterLoad();
      return;
    }

    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === "1" || isMapsReady(window.kakao?.maps)) {
        afterLoad();
        return;
      }
      existing.addEventListener(
        "load",
        () => {
          existing.dataset.loaded = "1";
          afterLoad();
        },
        { once: true },
      );
      existing.addEventListener(
        "error",
        () =>
          finishErr(
            new Error(
              `Kakao Maps SDK 스크립트 로드 실패.${domainHint()} (401이면 키/도메인 불일치)`,
            ),
          ),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.charset = "UTF-8";
    script.src = buildKakaoSdkUrl(appKey);
    script.onload = () => {
      script.dataset.loaded = "1";
      afterLoad();
    };
    script.onerror = () => {
      finishErr(
        new Error(
          `Kakao Maps SDK 스크립트 로드 실패.${domainHint()} (401/ORB면 JavaScript 키·웹 도메인 등록을 확인하세요)`,
        ),
      );
    };
    document.head.appendChild(script);
  });

  return readyPromise;
}

export function resetKakaoSdkCache(): void {
  readyPromise = null;
  clustererPromise = null;
  if (typeof document === "undefined") return;
  document.getElementById(SCRIPT_ID)?.remove();
  document.getElementById(CLUSTERER_SCRIPT_ID)?.remove();
  document.querySelectorAll("script[data-kakao-maps-sdk]").forEach((node) => node.remove());
}
