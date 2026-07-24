import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LayerCubeSchema } from "@/lib/layers/types";

const ARTIFACT_PATH = path.join(process.cwd(), "public", "data", "layers", "skt-living.json");
const BOUNDARY_PATH = path.join(process.cwd(), "public", "data", "administrative-dong-20260701.geojson");

function loadArtifact() {
  const raw = readFileSync(ARTIFACT_PATH, "utf8");
  return JSON.parse(raw);
}

function loadBoundaryAdmCd2Set(): Set<string> {
  const raw = readFileSync(BOUNDARY_PATH, "utf8");
  const geojson = JSON.parse(raw) as { features: Array<{ properties: { adm_cd2: string } }> };
  return new Set(geojson.features.map((f) => f.properties.adm_cd2));
}

describe("skt-living artifact", () => {
  it("parses via LayerCubeSchema", () => {
    const cube = loadArtifact();
    expect(() => LayerCubeSchema.parse(cube)).not.toThrow();
  });

  it("has 305 cells and 12 months", () => {
    const cube = loadArtifact();
    expect(cube.cells).toHaveLength(305);
    expect(cube.months).toHaveLength(12);
    expect(cube.layerId).toBe("skt-living");
    expect(cube.adminLevel).toBe("dong");
    expect(cube.referenceMonth).toBe("2025-12");
  });

  it("every cell code exists in the boundary adm_cd2 set", () => {
    const cube = loadArtifact();
    const boundaryCodes = loadBoundaryAdmCd2Set();
    for (const cell of cube.cells) {
      expect(boundaryCodes.has(cell.code)).toBe(true);
    }
  });

  it("every series has length 12 and living_total values are positive finite numbers", () => {
    const cube = loadArtifact();
    for (const cell of cube.cells) {
      expect(cell.series.living_total).toHaveLength(12);
      expect(cell.series.elderly_ratio).toHaveLength(12);
      for (const value of cell.series.living_total) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThan(0);
      }
    }
  });
});
