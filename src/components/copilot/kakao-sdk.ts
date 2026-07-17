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
};

declare global {
  interface Window {
    kakao?: { maps: KakaoMapsNamespace };
  }
}

let sdkPromise: Promise<KakaoMapsNamespace> | null = null;
const SDK_LOAD_TIMEOUT_MS = 20_000;

export function buildKakaoSdkUrl(appKey: string, options?: { viaProxy?: boolean }): string {
  if (options?.viaProxy) {
    // Same-origin bootstrap avoids CORS/crossOrigin issues; secondary libs still come from daumcdn.
    const url = new URL("/api/kakao/sdk", typeof window !== "undefined" ? window.location.origin : "http://localhost");
    url.searchParams.set("libraries", "services,clusterer");
    return url.toString();
  }

  const url = new URL("https://dapi.kakao.com/v2/maps/sdk.js");
  url.searchParams.set("appkey", appKey.trim());
  url.searchParams.set("autoload", "false");
  url.searchParams.set("libraries", "services,clusterer");
  return url.toString();
}

function waitForMapsReady(timeoutMs: number): Promise<KakaoMapsNamespace> {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const maps = window.kakao?.maps;
      if (maps && typeof maps.LatLng === "function" && typeof maps.Map === "function") {
        resolve(maps);
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("Kakao Maps 객체가 준비되지 않았습니다. 웹 도메인 등록을 확인하세요."));
        return;
      }
      window.setTimeout(tick, 40);
    };
    tick();
  });
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Never set crossOrigin on Kakao SDK — it often fails the whole load.
    const existing = document.querySelector<HTMLScriptElement>(`script[data-kakao-maps-sdk="${src}"]`);
    if (existing) {
      if (window.kakao?.maps) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Kakao Maps SDK 스크립트 로드 실패")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.dataset.kakaoMapsSdk = src;
    script.async = true;
    script.src = src;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`Kakao Maps SDK 스크립트 로드 실패: ${src.includes("/api/kakao/sdk") ? "proxy" : "cdn"}`)),
      { once: true },
    );
    document.head.append(script);
  });
}

async function loadOnce(appKey: string, viaProxy: boolean): Promise<KakaoMapsNamespace> {
  const src = buildKakaoSdkUrl(appKey, { viaProxy });
  await injectScript(src);

  const maps = window.kakao?.maps;
  if (!maps || typeof maps.load !== "function") {
    throw new Error("Kakao Maps SDK 전역 객체가 없습니다. JavaScript 키와 웹 도메인 등록을 확인하세요.");
  }

  await new Promise<void>((resolve, reject) => {
    try {
      maps.load(() => resolve());
    } catch (error) {
      reject(error instanceof Error ? error : new Error("kakao.maps.load 실패"));
    }
  });

  return waitForMapsReady(8_000);
}

export function loadKakaoSdk(appKey: string): Promise<KakaoMapsNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Kakao Maps SDK는 브라우저에서만 로드할 수 있습니다."));
  }
  if (!appKey.trim()) {
    return Promise.reject(new Error("Kakao Maps 공개 앱 키가 없습니다."));
  }
  if (sdkPromise) return sdkPromise;

  sdkPromise = (async () => {
    const timeout = new Promise<never>((_, reject) => {
      window.setTimeout(
        () => reject(new Error("Kakao Maps SDK 로드 시간 초과. 네트워크·도메인·CSP를 확인하세요.")),
        SDK_LOAD_TIMEOUT_MS,
      );
    });

    const attempt = (async () => {
      try {
        // 1) Direct CDN (normal path)
        return await loadOnce(appKey, false);
      } catch (directError) {
        // 2) Same-origin proxy fallback
        try {
          return await loadOnce(appKey, true);
        } catch {
          throw directError instanceof Error
            ? directError
            : new Error("Kakao Maps SDK 스크립트 로드 실패. 키/도메인/CSP를 확인하세요.");
        }
      }
    })();

    return Promise.race([attempt, timeout]);
  })().catch((error) => {
    sdkPromise = null;
    throw error;
  });

  return sdkPromise;
}

export function resetKakaoSdkCache(): void {
  sdkPromise = null;
  if (typeof document !== "undefined") {
    document.querySelectorAll("script[data-kakao-maps-sdk]").forEach((node) => node.remove());
    // Do not delete window.kakao if partially loaded — hard reset only script tags.
  }
}
