export type GeoPoint = {
  lat: number;
  lng: number;
};

export type RiskDirection = "higher-is-higher-risk" | "lower-is-higher-risk";

export type MedicalVulnerabilityInput = {
  supplyScarcityScore: number | null;
  elderlyDemandScore: number | null;
  nearestDistanceScore: number | null;
  noFacilityWithin2KmScore: number | null;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * @turf/distance와 같은 하버사인 계산을 GeoJSON 객체 없이 수행한다.
 *
 * 의료 취약 순위는 305개 행정동 × 4,272개 시설을 훑는데, turf는 호출마다 Feature 두 개를
 * 새로 만든다. 그 할당이 초기 화면 계산을 3초 넘게 붙잡고 있었다(prod 실측).
 * 수식·지구반지름·연산 순서를 turf와 똑같이 맞췄고, 두 결과가 일치하는지는 테스트로 잠갔다.
 */
export const EARTH_RADIUS_KM = 6371008.8 / 1e3;

function toRadians(degrees: number): number {
  return ((degrees % 360) * Math.PI) / 180;
}

export function distanceInKilometers(origin: GeoPoint, destination: GeoPoint): number {
  const dLat = toRadians(destination.lat - origin.lat);
  const dLon = toRadians(destination.lng - origin.lng);
  const lat1 = toRadians(origin.lat);
  const lat2 = toRadians(destination.lat);
  const a =
    Math.pow(Math.sin(dLat / 2), 2) +
    Math.pow(Math.sin(dLon / 2), 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * EARTH_RADIUS_KM;
}

export function nearestFacilityDistance<T extends GeoPoint>(origin: GeoPoint, facilities: readonly T[]): number | null {
  if (facilities.length === 0) {
    return null;
  }

  let nearest = Number.POSITIVE_INFINITY;

  for (const facility of facilities) {
    nearest = Math.min(nearest, distanceInKilometers(origin, facility));
  }

  return nearest;
}

export function countFacilitiesWithinRadius<T extends GeoPoint>(
  origin: GeoPoint,
  facilities: readonly T[],
  radiusKm: number,
): number {
  if (!Number.isFinite(radiusKm) || radiusKm < 0) {
    throw new RangeError("radiusKm must be a finite non-negative number.");
  }

  return facilities.reduce(
    (count, facility) => count + (distanceInKilometers(origin, facility) <= radiusKm ? 1 : 0),
    0,
  );
}

/**
 * 최근접 거리와 반경 내 개수를 한 번의 순회로 함께 낸다.
 *
 * 둘을 따로 부르면 같은 시설 목록을 두 번 훑는다. 행정동마다 반복되는 비용이라
 * 순회를 한 번으로 줄였다. 값은 각각을 따로 부른 것과 같아야 하고, 테스트가 그것을 지킨다.
 */
export function facilityAccessSummary<T extends GeoPoint>(
  origin: GeoPoint,
  facilities: readonly T[],
  radiusKm: number,
): { nearestKm: number | null; withinRadius: number } {
  if (!Number.isFinite(radiusKm) || radiusKm < 0) {
    throw new RangeError("radiusKm must be a finite non-negative number.");
  }

  let nearest = Number.POSITIVE_INFINITY;
  let withinRadius = 0;

  for (const facility of facilities) {
    const km = distanceInKilometers(origin, facility);
    if (km < nearest) nearest = km;
    if (km <= radiusKm) withinRadius += 1;
  }

  return { nearestKm: facilities.length === 0 ? null : nearest, withinRadius };
}

function percentile(sortedValues: readonly number[], percentileValue: number): number {
  const position = (sortedValues.length - 1) * percentileValue;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);

  if (lowerIndex === upperIndex) {
    return sortedValues[lowerIndex];
  }

  const fraction = position - lowerIndex;
  return sortedValues[lowerIndex] + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * fraction;
}

export function winsorizedMinMax(
  values: readonly (number | null)[],
  direction: RiskDirection = "higher-is-higher-risk",
): (number | null)[] {
  const finiteValues = values.filter((value): value is number => value !== null && Number.isFinite(value));

  if (finiteValues.length !== values.filter((value) => value !== null).length) {
    throw new TypeError("Normalization values must be finite numbers or null.");
  }

  if (finiteValues.length === 0) {
    return values.map(() => null);
  }

  const sortedValues = [...finiteValues].sort((left, right) => left - right);
  const lowerBound = percentile(sortedValues, 0.05);
  const upperBound = percentile(sortedValues, 0.95);
  const span = upperBound - lowerBound;

  return values.map((value) => {
    if (value === null) {
      return null;
    }

    if (span === 0) {
      return 0;
    }

    const normalized = ((clamp(value, lowerBound, upperBound) - lowerBound) / span) * 100;
    return direction === "lower-is-higher-risk" ? 100 - normalized : normalized;
  });
}

export function medicalVulnerabilityIndex(input: MedicalVulnerabilityInput): number | null {
  const components = [
    input.supplyScarcityScore,
    input.elderlyDemandScore,
    input.nearestDistanceScore,
    input.noFacilityWithin2KmScore,
  ];

  if (components.some((component) => component === null)) {
    return null;
  }

  const [supplyScarcity, elderlyDemand, nearestDistance, noFacilityWithin2Km] = components.map((component) =>
    clamp(component as number, 0, 100),
  );

  return clamp(
    supplyScarcity * 0.35 + elderlyDemand * 0.25 + nearestDistance * 0.25 + noFacilityWithin2Km * 0.15,
    0,
    100,
  );
}
