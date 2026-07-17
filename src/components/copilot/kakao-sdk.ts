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
const SDK_LOAD_TIMEOUT_MS = 15_000;

export function buildKakaoSdkUrl(appKey: string): string {
  const url = new URL("https://dapi.kakao.com/v2/maps/sdk.js");
  url.searchParams.set("appkey", appKey.trim());
  url.searchParams.set("autoload", "false");
  // clusterer is optional at runtime; keep libraries lean for reliability
  url.searchParams.set("libraries", "services,clusterer,drawing");
  return url.toString();
}

export function loadKakaoSdk(appKey: string): Promise<KakaoMapsNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Kakao Maps SDK는 브라우저에서만 로드할 수 있습니다."));
  }
  if (!appKey.trim()) {
    return Promise.reject(new Error("Kakao Maps 공개 앱 키가 없습니다."));
  }
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise<KakaoMapsNamespace>((resolve, reject) => {
    let settled = false;
    const succeed = (maps: KakaoMapsNamespace) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(maps);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      reject(error);
    };

    const finish = () => {
      const maps = window.kakao?.maps;
      if (!maps || typeof maps.load !== "function") {
        fail(new Error("Kakao Maps SDK 전역 객체를 찾지 못했습니다. 앱 키·도메인 등록을 확인하세요."));
        return;
      }
      try {
        maps.load(() => {
          // maps.load may call back before LatLng is attached in rare race; microtask help
          queueMicrotask(() => {
            if (typeof window.kakao?.maps?.LatLng !== "function") {
              fail(new Error("Kakao Maps 라이브러리 초기화가 완료되지 않았습니다."));
              return;
            }
            succeed(window.kakao!.maps);
          });
        });
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Kakao Maps 로드 중 오류가 발생했습니다."));
      }
    };

    const timeoutId = window.setTimeout(
      () => fail(new Error("Kakao Maps SDK 로드 시간 초과(15초). 네트워크·CSP·도메인을 확인하세요.")),
      SDK_LOAD_TIMEOUT_MS,
    );

    const existing = document.querySelector<HTMLScriptElement>("script[data-kakao-maps-sdk]");
    if (existing) {
      if (window.kakao?.maps?.LatLng) {
        succeed(window.kakao.maps);
        return;
      }
      if (window.kakao?.maps) {
        finish();
        return;
      }
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener(
        "error",
        () => fail(new Error("Kakao Maps SDK 스크립트 로드 실패")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.dataset.kakaoMapsSdk = "true";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.src = buildKakaoSdkUrl(appKey);
    script.addEventListener("load", finish, { once: true });
    script.addEventListener(
      "error",
      () => fail(new Error("Kakao Maps SDK 스크립트 로드 실패. 키/도메인/CSP를 확인하세요.")),
      { once: true },
    );
    document.head.append(script);
  }).catch((error) => {
    sdkPromise = null;
    throw error;
  });

  return sdkPromise;
}

export function resetKakaoSdkCache(): void {
  sdkPromise = null;
}
