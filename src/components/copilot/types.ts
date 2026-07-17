import type { AnalysisSnapshot, DemoSnapshot, Facility, RegionSeries } from "@/lib/domain/schemas";

export type Position = [number, number];
export type LinearRing = Position[];
export type PolygonCoordinates = LinearRing[];
export type MultiPolygonCoordinates = PolygonCoordinates[];

export type BoundaryFeature = {
  type: "Feature";
  properties: {
    adm_cd2: string;
    adm_nm: string;
    sggnm?: string;
  };
  geometry:
    | { type: "Polygon"; coordinates: PolygonCoordinates }
    | { type: "MultiPolygon"; coordinates: MultiPolygonCoordinates };
};

export type BoundaryCollection = {
  type: "FeatureCollection";
  features: BoundaryFeature[];
};

export type { AnalysisSnapshot, DemoSnapshot, Facility, RegionSeries };

