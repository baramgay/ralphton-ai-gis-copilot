import type { BoundaryCollection, BoundaryFeature, LinearRing } from "@/components/copilot/types";
import { distanceInKilometers, type GeoPoint } from "@/lib/gis/metrics";

/**
 * 지도 위 **아무 지점**을 찍고 그 둘레를 읽는다.
 *
 * 지금까지 반경은 행정동의 대표지점에만 걸렸다. 그런데 현장에서 묻는 말은 "이 동의
 * 중심에서"가 아니라 "여기서"다 — 후보 부지, 사고 지점, 민원이 들어온 골목.
 *
 * ## 여기서 세지 않는 것
 *
 * 반경 안 **생활인구·소비·소득 합계는 내지 않는다.** 그 값들은 행정동 단위라, 원이
 * 동을 반으로 자르면 "면적의 절반이니 인구도 절반"이라고 가정해야 답이 나온다. 인구는
 * 고르게 퍼져 있지 않다 — 산이 절반인 읍에서 이 가정은 사람을 산에 올려놓는다.
 * 그럴듯한 숫자 하나가 "자료로는 말할 수 없다"보다 나쁘다.
 *
 * 그래서 이 도구가 세는 것은 **점으로 있는 자료(시설)뿐**이고, 면으로 있는 자료는
 * 걸치는 행정동의 **이름과 값을 따로따로** 보여 준다. 합계 자리는 비워 둔다.
 */

export type ProbePoint = GeoPoint;

/* ------------------------------------------------------------------ *
 * 점이 다각형 안에 있는가
 * ------------------------------------------------------------------ */

/**
 * 광선 교차법(ray casting).
 *
 * 경계선 위의 점은 판정이 갈릴 수 있다. 행정동 경계에 정확히 찍히는 일은 화면 클릭으로는
 * 사실상 없고, 갈리더라도 이웃한 두 동 중 하나가 되므로 답이 무너지지 않는다.
 */
function pointInRing(point: ProbePoint, ring: LinearRing): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const straddles = yi > point.lat !== yj > point.lat;
    if (!straddles) continue;
    const crossLng = ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (point.lng < crossLng) inside = !inside;
  }
  return inside;
}

/**
 * 첫 링은 바깥, 나머지는 구멍이다.
 *
 * 지금 쓰는 행정동 경계에는 구멍이 없지만(실측 305개 전부 링 1개), 구멍을 무시하도록
 * 짜 두면 나중에 경계 자료를 다시 받았을 때 **조용히 틀린 답**을 낸다 — 도넛 안쪽
 * 빈 곳을 찍어도 "이 동 안"이라고 답한다.
 */
function pointInPolygon(point: ProbePoint, rings: readonly LinearRing[]): boolean {
  if (rings.length === 0) return false;
  if (!pointInRing(point, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(point, rings[i])) return false;
  }
  return true;
}

export function pointInFeature(point: ProbePoint, feature: BoundaryFeature): boolean {
  const polygons =
    feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return polygons.some((rings) => pointInPolygon(point, rings));
}

export type ContainingRegion = { code: string; name: string };

/** 지점이 속한 행정동. 경남 밖이면 `null` — "자료 없음"이 아니라 "경계 밖"이다. */
export function findContainingRegion(
  point: ProbePoint,
  boundary: BoundaryCollection,
): ContainingRegion | null {
  for (const feature of boundary.features) {
    if (pointInFeature(point, feature)) {
      return { code: feature.properties.adm_cd2, name: feature.properties.adm_nm };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 지점에서 경계까지의 거리
 * ------------------------------------------------------------------ */

/**
 * 꼭짓점까지의 거리가 아니라 **변까지의 거리**를 잰다.
 *
 * 꼭짓점만 재면 긴 변이 지점 바로 옆을 지나가는데도 양 끝이 멀어 "안 걸친다"고 답한다.
 * 몇 km 규모에서는 위경도를 그 자리의 평면으로 펴서 재도 오차가 미터 아래다.
 */
function localScale(lat: number): { latScale: number; lngScale: number } {
  return { latScale: 110.574, lngScale: 111.32 * Math.cos((lat * Math.PI) / 180) };
}

function segmentDistanceKm(point: ProbePoint, a: readonly number[], b: readonly number[]): number {
  const { latScale, lngScale } = localScale(point.lat);
  // 지점을 원점으로 두면 "원점에서 선분까지"가 되어 식이 짧아진다.
  const ax = (a[0] - point.lng) * lngScale;
  const ay = (a[1] - point.lat) * latScale;
  const bx = (b[0] - point.lng) * lngScale;
  const by = (b[1] - point.lat) * latScale;
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(ax, ay);
  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function bboxOf(feature: BoundaryFeature): [number, number, number, number] {
  const polygons =
    feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (const [lng, lat] of ring) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** 지점에서 외곽 상자까지의 거리. 상자 안이면 0. 실제 경계까지 거리의 하한이다. */
function bboxDistanceKm(point: ProbePoint, box: [number, number, number, number]): number {
  const { latScale, lngScale } = localScale(point.lat);
  const dLng = Math.max(box[0] - point.lng, 0, point.lng - box[2]) * lngScale;
  const dLat = Math.max(box[1] - point.lat, 0, point.lat - box[3]) * latScale;
  return Math.hypot(dLng, dLat);
}

/**
 * 지점에서 이 행정동 경계까지의 최단 거리.
 *
 * 305개 동에 꼭짓점이 9만 개가 넘는다. 클릭 한 번에 전부를 훑지 않도록, 외곽 상자까지의
 * 거리가 이미 반경 밖인 동은 변 계산 없이 건너뛴다. 상자까지의 거리는 실제 경계까지
 * 거리보다 **작거나 같으므로**, 이 걸러내기가 걸쳐야 할 동을 빠뜨리지 않는다.
 */
function featureDistanceKm(point: ProbePoint, feature: BoundaryFeature, cutoffKm: number): number {
  if (bboxDistanceKm(point, bboxOf(feature)) > cutoffKm) return Number.POSITIVE_INFINITY;
  const polygons =
    feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let best = Number.POSITIVE_INFINITY;
  for (const rings of polygons) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i += 1) {
        const km = segmentDistanceKm(point, ring[i], ring[i + 1]);
        if (km < best) best = km;
      }
    }
  }
  return best;
}

/* ------------------------------------------------------------------ *
 * 반경 조회
 * ------------------------------------------------------------------ */

export type ProbeFacility = {
  id: string;
  name: string;
  type: string;
  lat: number;
  lng: number;
  distanceKm: number;
};

export type ProbeRegion = {
  code: string;
  name: string;
  /** 지점이 이 동 안에 있는가. */
  contains: boolean;
  /** 지점에서 이 동 경계까지의 거리(안이면 0). */
  distanceKm: number;
};

export type RadiusProbe = {
  point: ProbePoint;
  radiusKm: number;
  /** 경남 밖이면 null. */
  containing: ContainingRegion | null;
  facilities: ProbeFacility[];
  /** 종류별 개수. 많은 것부터. */
  byType: { type: string; count: number }[];
  nearest: ProbeFacility | null;
  /** 원에 걸치는 행정동. 지점이 속한 동이 맨 앞. */
  regions: ProbeRegion[];
  notes: string[];
};

type FacilityLike = { id: string; name: string; type: string; lat: number; lng: number };

const MAX_LISTED = 60;

export function probeRadius(input: {
  point: ProbePoint;
  radiusKm: number;
  boundary: BoundaryCollection;
  facilities: readonly FacilityLike[];
}): RadiusProbe {
  const { point, radiusKm, boundary, facilities } = input;
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    throw new RangeError("radiusKm must be a finite positive number.");
  }

  const within: ProbeFacility[] = [];
  let nearest: ProbeFacility | null = null;
  for (const facility of facilities) {
    const distanceKm = distanceInKilometers(point, facility);
    const entry = {
      id: facility.id,
      name: facility.name,
      type: facility.type,
      lat: facility.lat,
      lng: facility.lng,
      distanceKm,
    };
    if (nearest === null || distanceKm < nearest.distanceKm) nearest = entry;
    if (distanceKm <= radiusKm) within.push(entry);
  }
  within.sort((a, b) => a.distanceKm - b.distanceKm);

  const counts = new Map<string, number>();
  for (const facility of within) counts.set(facility.type, (counts.get(facility.type) ?? 0) + 1);
  const byType = [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, "ko-KR"));

  const containing = findContainingRegion(point, boundary);

  const regions: ProbeRegion[] = [];
  for (const feature of boundary.features) {
    const contains = feature.properties.adm_cd2 === containing?.code;
    if (contains) {
      regions.push({ code: feature.properties.adm_cd2, name: feature.properties.adm_nm, contains, distanceKm: 0 });
      continue;
    }
    const distanceKm = featureDistanceKm(point, feature, radiusKm);
    if (distanceKm <= radiusKm) {
      regions.push({ code: feature.properties.adm_cd2, name: feature.properties.adm_nm, contains: false, distanceKm });
    }
  }
  regions.sort((a, b) => Number(b.contains) - Number(a.contains) || a.distanceKm - b.distanceKm);

  const notes: string[] = [];
  if (containing === null) {
    notes.push("찍으신 지점이 경상남도 경계 밖입니다. 시설 거리는 그대로 계산되지만 행정동은 나오지 않습니다.");
  }
  notes.push(
    `반경 ${radiusKm}km · 시설 ${within.length.toLocaleString("ko-KR")}곳${within.length > MAX_LISTED ? ` (가까운 ${MAX_LISTED}곳만 표시)` : ""}`,
  );
  notes.push(
    "반경 안 인구·소비 합계는 내지 않습니다. 이 값들은 행정동 단위라 원이 동을 자르면 인구가 면적에 고르게 퍼져 있다고 가정해야 하는데, 실제로는 그렇지 않습니다. 걸치는 행정동의 값은 아래에 따로 보여 드립니다.",
  );
  notes.push("직선거리(하버사인) 기준입니다. 도로를 따라 가는 실제 이동거리는 이보다 깁니다.");

  return {
    point,
    radiusKm,
    containing,
    facilities: within.slice(0, MAX_LISTED),
    byType,
    nearest,
    regions,
    notes,
  };
}
