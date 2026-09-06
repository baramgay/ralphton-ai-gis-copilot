import type { Facility } from "@/lib/domain/schemas";

/** 지도에 올리는 지점. 의료기관은 한 종류일 뿐이다. */
export type MapPoint = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  kind: string;
  adm_cd2: string;
};

export const MAP_POINT_CAP = 900;

export function facilityToMapPoint(facility: Facility): MapPoint {
  return {
    id: facility.id,
    name: facility.name,
    lat: facility.lat,
    lng: facility.lng,
    kind: facility.type,
    adm_cd2: facility.adm_cd2,
  };
}

export function capMapPoints<T>(
  items: readonly T[],
  cap: number = MAP_POINT_CAP,
): { shown: T[]; total: number; capped: boolean } {
  const total = items.length;
  const capped = total > cap;
  return {
    shown: capped ? items.slice(0, cap) : [...items],
    total,
    capped,
  };
}

export function mapPointCapNotice(shownCap: number, total: number): string | null {
  if (total <= shownCap) return null;
  return `지도 시설 ${shownCap.toLocaleString("ko-KR")}개 표시 · 전체 ${total.toLocaleString("ko-KR")}`;
}
