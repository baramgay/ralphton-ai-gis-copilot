import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import { point, polygon, multiPolygon } from "@turf/helpers";

export type AssignableRegion = {
  adm_cd2: string;
  adm_nm: string;
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
};

export type LonLat = {
  lat: number;
  lng: number;
};

/**
 * Assign a WGS84 point to the first containing administrative dong.
 * Returns null when the point falls outside all provided regions.
 */
export function assignPointToRegion(
  location: LonLat,
  regions: readonly AssignableRegion[],
): AssignableRegion | null {
  if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
    return null;
  }

  const candidate = point([location.lng, location.lat]);

  for (const region of regions) {
    try {
      // Turf accepts Polygon and MultiPolygon features at runtime.
      const feature =
        region.geometry.type === "Polygon"
          ? polygon(region.geometry.coordinates as number[][][])
          : multiPolygon(region.geometry.coordinates as number[][][][]);

      if (booleanPointInPolygon(candidate, feature as never)) {
        return region;
      }
    } catch {
      // Skip invalid geometry rather than failing the whole sync batch.
    }
  }

  return null;
}
