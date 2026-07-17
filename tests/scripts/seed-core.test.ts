import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { featureCollection, point } from "@turf/helpers";
import { pointsWithinPolygon } from "@turf/points-within-polygon";
import { describe, expect, test } from "vitest";

import { DemoSnapshotSchema, FacilitySchema, type DemoSnapshot } from "@/lib/domain/schemas";

// @ts-expect-error Native ESM scripts intentionally have no TypeScript declaration file.
import { buildDemoMetadata, seedSnapshot } from "../../scripts/lib/seed-core.mjs";

type BoundaryFeature = {
  type: "Feature";
  properties: { adm_cd2: string; adm_nm: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown[] };
};

type BoundaryCollection = {
  type: "FeatureCollection";
  features: BoundaryFeature[];
};

const PROJECT_ROOT = process.cwd();
const BOUNDARY_PATH = path.join(
  PROJECT_ROOT,
  "public",
  "data",
  "busan-administrative-dong-20260701.geojson",
);
const SNAPSHOT_PATH = path.join(PROJECT_ROOT, "public", "data", "demo-snapshot.json");
const METADATA_PATH = path.join(PROJECT_ROOT, "public", "data", "demo-metadata.json");

describe("seedSnapshot", () => {
  test("is deterministic for the same boundary and seed", async () => {
    const boundary = JSON.parse(await readFile(BOUNDARY_PATH, "utf8"));

    const first = seedSnapshot(boundary, 20260701);
    const second = seedSnapshot(boundary, 20260701);

    expect(first).toEqual(second);
  });

  test("produces all boundary regions with 13 months each", async () => {
    const boundary = JSON.parse(await readFile(BOUNDARY_PATH, "utf8"));

    const snapshot: DemoSnapshot = seedSnapshot(boundary, 20260701);

    expect(snapshot.regions).toHaveLength(boundary.features.length);
    expect(snapshot.regions.length).toBeGreaterThanOrEqual(500);
    expect(snapshot.months).toHaveLength(13);
    expect(snapshot.regions[0].population).toHaveLength(13);
    expect(snapshot.regions[0].households).toHaveLength(13);
  });

  test("produces 13 consecutive calendar months ending at the reference month", async () => {
    const boundary = JSON.parse(await readFile(BOUNDARY_PATH, "utf8"));

    const snapshot: DemoSnapshot = seedSnapshot(boundary, 20260701);

    expect(snapshot.months).toEqual([
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
    expect(snapshot.months.at(-1)).toBe(snapshot.referenceMonth);
    expect(snapshot.regions.every((region) => region.months.join() === snapshot.months.join())).toBe(true);
  });

  test("places at least one facility inside every administrative dong", async () => {
    const boundary = JSON.parse(await readFile(BOUNDARY_PATH, "utf8")) as BoundaryCollection;

    const snapshot: DemoSnapshot = seedSnapshot(boundary, 20260701);
    const codes = new Set(snapshot.facilities.map((facility) => facility.adm_cd2));
    const features = new Map(
      boundary.features.map((feature) => [feature.properties.adm_cd2, feature]),
    );

    expect(snapshot.facilities.length).toBeGreaterThanOrEqual(boundary.features.length);
    expect(codes.size).toBe(boundary.features.length);

    for (const facility of snapshot.facilities) {
      const declaredRegion = features.get(facility.adm_cd2);
      if (!declaredRegion) {
        throw new Error(`행정동을 찾을 수 없습니다: ${facility.adm_cd2}`);
      }
      const matches = pointsWithinPolygon(
        featureCollection([point([facility.lng, facility.lat])]),
        declaredRegion as unknown as Parameters<typeof pointsWithinPolygon>[1],
      );
      expect(matches.features, `${facility.id} must be inside ${facility.adm_cd2}`).toHaveLength(1);
    }
  });

  test("stores an internal representative point and positive area for every region", async () => {
    const boundary = JSON.parse(await readFile(BOUNDARY_PATH, "utf8")) as BoundaryCollection;
    const snapshot = seedSnapshot(boundary, 20260701) as DemoSnapshot;
    const features = new Map(
      boundary.features.map((feature) => [feature.properties.adm_cd2, feature]),
    );

    for (const region of snapshot.regions) {
      const spatialRegion = region as typeof region & {
        representativePoint: { lat: number; lng: number };
        areaSquareKm: number;
      };
      const declaredRegion = features.get(region.adm_cd2);
      if (!declaredRegion) {
        throw new Error(`행정동을 찾을 수 없습니다: ${region.adm_cd2}`);
      }
      const matches = pointsWithinPolygon(
        featureCollection([
          point([spatialRegion.representativePoint.lng, spatialRegion.representativePoint.lat]),
        ]),
        declaredRegion as unknown as Parameters<typeof pointsWithinPolygon>[1],
      );
      expect(spatialRegion.areaSquareKm).toBeGreaterThan(0);
      expect(matches.features, `${region.adm_cd2} representative point`).toHaveLength(1);
    }
  });

  test("includes all required facility types", async () => {
    const boundary = JSON.parse(await readFile(BOUNDARY_PATH, "utf8"));

    const snapshot: DemoSnapshot = seedSnapshot(boundary, 20260701);
    const types = new Set(snapshot.facilities.map((facility) => facility.type));

    for (const type of ["종합병원", "병원", "요양병원", "의원", "치과의원", "한의원", "보건소", "약국"] as const) {
      expect(types.has(type)).toBe(true);
    }
  });

  test("has intentionally null specialties and hours to test null handling", async () => {
    const boundary = JSON.parse(await readFile(BOUNDARY_PATH, "utf8"));

    const snapshot: DemoSnapshot = seedSnapshot(boundary, 20260701);
    const nullSpecialties = snapshot.facilities.filter((facility) => facility.specialties === null);
    const nullHours = snapshot.facilities.filter((facility) => facility.hours === null);

    expect(nullSpecialties.length).toBeGreaterThan(0);
    expect(nullHours.length).toBeGreaterThan(0);
  });

  test("output passes the DemoSnapshot schema", async () => {
    const boundary = JSON.parse(await readFile(BOUNDARY_PATH, "utf8"));

    const snapshot: DemoSnapshot = seedSnapshot(boundary, 20260701);

    expect(() => DemoSnapshotSchema.parse(snapshot)).not.toThrow();
  });
});

describe("buildDemoMetadata", () => {
  test("records the SHA-256 of the serialized snapshot bytes", () => {
    const snapshot = {
      mode: "demo",
      referenceMonth: "2026-06",
      months: ["2025-06", "2026-06"],
      regions: [],
      facilities: [],
      sourceNotes: ["note"],
    };
    const generatedAt = "2026-07-16T07:00:00.000Z";

    const metadata = buildDemoMetadata(snapshot, { versionSeed: 20260701, generatedAt });
    const expectedSha256 = createHash("sha256")
      .update(new TextEncoder().encode(JSON.stringify(snapshot)))
      .digest("hex");

    expect(metadata.sha256).toBe(expectedSha256);
    expect(metadata.mode).toBe("demo");
    expect(metadata.versionSeed).toBe(20260701);
    expect(metadata.referenceMonth).toBe("2026-06");
    expect(metadata.generatedAt).toBe(generatedAt);
    expect(metadata.regionCount).toBe(0);
    expect(metadata.facilityCount).toBe(0);
  });
});

describe("generated demo artifact", () => {
  test("demo-snapshot.json is valid and contains busan+gyeongnam regions", async () => {
    const bytes = await readFile(SNAPSHOT_PATH);
    const snapshot = JSON.parse(bytes.toString("utf8"));

    expect(() => DemoSnapshotSchema.parse(snapshot)).not.toThrow();
    expect(snapshot.regions.length).toBeGreaterThanOrEqual(500);
    expect(snapshot.mode).toBe("demo");
  });

  test("demo-metadata.json sha256 matches the demo-snapshot.json bytes", async () => {
    const metadata = JSON.parse(await readFile(METADATA_PATH, "utf8"));
    const snapshotBytes = await readFile(SNAPSHOT_PATH);
    const expectedSha256 = createHash("sha256").update(snapshotBytes).digest("hex");

    expect(metadata.sha256).toBe(expectedSha256);
    expect(metadata.regionCount).toBeGreaterThanOrEqual(500);
  });

  test("every facility satisfies the Facility schema", async () => {
    const snapshot = JSON.parse(await readFile(SNAPSHOT_PATH, "utf8"));

    for (const facility of snapshot.facilities) {
      expect(() => FacilitySchema.parse(facility)).not.toThrow();
    }
  });
});
