/**
 * Server-only Kakao Local REST helpers.
 * Never import from client components.
 */

const KAKAO_LOCAL_ORIGIN = "https://dapi.kakao.com";
const DEFAULT_TIMEOUT_MS = 10_000;

export class KakaoRestError extends Error {
  constructor(message = "카카오 위치 서비스를 사용할 수 없습니다.") {
    super(message);
    this.name = "KakaoRestError";
  }
}

export type KakaoPlace = {
  id: string;
  name: string;
  categoryName: string;
  categoryGroupCode: string | null;
  phone: string | null;
  address: string | null;
  roadAddress: string | null;
  lat: number;
  lng: number;
  distanceMeters: number | null;
  placeUrl: string | null;
};

export type KakaoAddressHit = {
  addressName: string;
  region1: string | null;
  region2: string | null;
  region3: string | null;
  lat: number;
  lng: number;
};

export type KakaoRestDeps = {
  apiKey?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

function requireKey(apiKey?: string): string {
  const key = apiKey?.trim() || process.env.KAKAO_REST_API_KEY?.trim();
  if (!key) {
    throw new KakaoRestError("카카오 REST API 키가 설정되지 않았습니다.");
  }
  return key;
}

async function kakaoGet<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  deps: KakaoRestDeps = {},
): Promise<T> {
  const key = requireKey(deps.apiKey);
  const fetchImpl = deps.fetch ?? fetch;
  const url = new URL(path, KAKAO_LOCAL_ORIGIN);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(name, String(value));
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url.toString(), {
      headers: {
        Authorization: `KakaoAK ${key}`,
        Accept: "application/json",
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new KakaoRestError();
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof KakaoRestError) throw error;
    throw new KakaoRestError();
  } finally {
    clearTimeout(timeout);
  }
}

type KakaoKeywordResponse = {
  documents?: Array<{
    id?: string;
    place_name?: string;
    category_name?: string;
    category_group_code?: string;
    phone?: string;
    address_name?: string;
    road_address_name?: string;
    y?: string;
    x?: string;
    distance?: string;
    place_url?: string;
  }>;
  meta?: { total_count?: number; is_end?: boolean };
};

type KakaoCategoryResponse = KakaoKeywordResponse;

type KakaoAddressResponse = {
  documents?: Array<{
    address_name?: string;
    y?: string;
    x?: string;
    address?: {
      region_1depth_name?: string;
      region_2depth_name?: string;
      region_3depth_name?: string;
    };
  }>;
};

type KakaoCoord2RegionResponse = {
  documents?: Array<{
    region_type?: string;
    address_name?: string;
    region_1depth_name?: string;
    region_2depth_name?: string;
    region_3depth_name?: string;
    x?: string;
    y?: string;
  }>;
};

function mapPlace(doc: NonNullable<KakaoKeywordResponse["documents"]>[number]): KakaoPlace | null {
  const lat = Number(doc.y);
  const lng = Number(doc.x);
  if (!doc.id || !doc.place_name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  const distance = doc.distance ? Number(doc.distance) : null;
  return {
    id: doc.id,
    name: doc.place_name,
    categoryName: doc.category_name ?? "",
    categoryGroupCode: doc.category_group_code || null,
    phone: doc.phone || null,
    address: doc.address_name || null,
    roadAddress: doc.road_address_name || null,
    lat,
    lng,
    distanceMeters: Number.isFinite(distance as number) ? distance : null,
    placeUrl: doc.place_url || null,
  };
}

/** Keyword search around a coordinate (Gyeongnam-centered by default). */
export async function searchPlacesByKeyword(
  options: {
    query: string;
    lat?: number;
    lng?: number;
    radiusMeters?: number;
    page?: number;
    size?: number;
  },
  deps: KakaoRestDeps = {},
): Promise<KakaoPlace[]> {
  const query = options.query.trim();
  if (!query) return [];

  const data = await kakaoGet<KakaoKeywordResponse>(
    "/v2/local/search/keyword.json",
    {
      query,
      y: options.lat ?? 35.1796,
      x: options.lng ?? 129.0756,
      radius: options.radiusMeters ?? 5_000,
      page: options.page ?? 1,
      size: Math.min(options.size ?? 15, 15),
      sort: "distance",
    },
    deps,
  );

  return (data.documents ?? [])
    .map(mapPlace)
    .filter((place): place is KakaoPlace => place !== null);
}

/** Category code HP8=병원, PM9=약국 (Kakao Local category group). */
export async function searchPlacesByCategory(
  options: {
    categoryGroupCode: "HP8" | "PM9" | "CS2" | "SW8";
    lat?: number;
    lng?: number;
    radiusMeters?: number;
    page?: number;
    size?: number;
  },
  deps: KakaoRestDeps = {},
): Promise<KakaoPlace[]> {
  const data = await kakaoGet<KakaoCategoryResponse>(
    "/v2/local/search/category.json",
    {
      category_group_code: options.categoryGroupCode,
      y: options.lat ?? 35.1796,
      x: options.lng ?? 129.0756,
      radius: options.radiusMeters ?? 3_000,
      page: options.page ?? 1,
      size: Math.min(options.size ?? 15, 15),
      sort: "distance",
    },
    deps,
  );

  return (data.documents ?? [])
    .map(mapPlace)
    .filter((place): place is KakaoPlace => place !== null);
}

export async function searchAddress(
  query: string,
  deps: KakaoRestDeps = {},
): Promise<KakaoAddressHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const data = await kakaoGet<KakaoAddressResponse>(
    "/v2/local/search/address.json",
    { query: trimmed, size: 10 },
    deps,
  );

  return (data.documents ?? [])
    .map((doc) => {
      const lat = Number(doc.y);
      const lng = Number(doc.x);
      if (!doc.address_name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        addressName: doc.address_name,
        region1: doc.address?.region_1depth_name ?? null,
        region2: doc.address?.region_2depth_name ?? null,
        region3: doc.address?.region_3depth_name ?? null,
        lat,
        lng,
      } satisfies KakaoAddressHit;
    })
    .filter((hit): hit is KakaoAddressHit => hit !== null);
}

export async function coordToRegion(
  lat: number,
  lng: number,
  deps: KakaoRestDeps = {},
): Promise<KakaoAddressHit | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const data = await kakaoGet<KakaoCoord2RegionResponse>(
    "/v2/local/geo/coord2regioncode.json",
    { y: lat, x: lng },
    deps,
  );

  const preferred =
    data.documents?.find((doc) => doc.region_type === "H") ?? data.documents?.[0];
  if (!preferred?.address_name) return null;

  return {
    addressName: preferred.address_name,
    region1: preferred.region_1depth_name ?? null,
    region2: preferred.region_2depth_name ?? null,
    region3: preferred.region_3depth_name ?? null,
    lat,
    lng,
  };
}

export function isKakaoRestConfigured(): boolean {
  return Boolean(process.env.KAKAO_REST_API_KEY?.trim());
}
