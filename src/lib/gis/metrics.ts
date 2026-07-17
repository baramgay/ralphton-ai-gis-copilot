import { distance } from "@turf/distance";
import { point } from "@turf/helpers";

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

function distanceInKilometers(origin: GeoPoint, destination: GeoPoint): number {
  return distance(point([origin.lng, origin.lat]), point([destination.lng, destination.lat]), {
    units: "kilometers",
  });
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
