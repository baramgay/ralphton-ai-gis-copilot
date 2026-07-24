import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SKT_LIVING_LAYER } from "@/lib/layers/catalog";
import { layerCubeToAnalysisView } from "@/lib/layers/to-analysis-view";
import type { LayerCube } from "@/lib/layers/types";

const ARTIFACT_PATH = path.join(process.cwd(), "public", "data", "layers", "skt-living.json");

function loadCube(): LayerCube {
  return JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as LayerCube;
}

const metrics = SKT_LIVING_LAYER.metrics;
const livingTotal = metrics.find((m) => m.key === "living_total")!;

describe("layerCubeToAnalysisView - dong level", () => {
  const cube = loadCube();
  const { analysis, scores } = layerCubeToAnalysisView(cube, livingTotal, metrics, "dong");

  it("produces one ranked row per dong cell, sorted descending by value", () => {
    expect(analysis.ranked).toHaveLength(305);
    for (let i = 1; i < analysis.ranked.length; i++) {
      const prevScore = analysis.ranked[i - 1].mapScore;
      const nextScore = analysis.ranked[i].mapScore;
      expect(prevScore).toBeGreaterThanOrEqual(nextScore);
    }
  });

  it("rows carry a dong code, name, valueLabel, note and one metric descriptor", () => {
    const row = analysis.ranked[0];
    expect(row.code).toMatch(/^\d{10}$/);
    expect(row.name.length).toBeGreaterThan(0);
    expect(row.valueLabel).toMatch(/명$/);
    expect(row.note).toContain(livingTotal.label);
    expect(row.metrics).toHaveLength(1);
    expect(row.metrics[0]).toMatchObject({
      label: livingTotal.label,
      unit: livingTotal.unit,
      referenceMonth: cube.referenceMonth,
    });
  });

  it("mapScore is normalized to 0-100", () => {
    for (const row of analysis.ranked) {
      expect(row.mapScore).toBeGreaterThanOrEqual(0);
      expect(row.mapScore).toBeLessThanOrEqual(100);
    }
  });

  it("scores map is keyed by the same 10-digit dong codes as the cube cells, one per cell", () => {
    expect(scores.size).toBe(cube.cells.length);
    for (const cell of cube.cells) {
      expect(scores.has(cell.code)).toBe(true);
    }
  });

  it("is not a facility result and carries a legend/summary derived from the metric", () => {
    expect(analysis.isFacilityResult).toBe(false);
    expect(analysis.filteredFacilities).toHaveLength(0);
    expect(analysis.legendLabel).toBe(`${livingTotal.label} 분포`);
    expect(analysis.summary).toContain(cube.referenceMonth);
  });
});

describe("layerCubeToAnalysisView - sgg level", () => {
  const cube = loadCube();
  const { analysis, scores } = layerCubeToAnalysisView(cube, livingTotal, metrics, "sgg");

  it("aggregates ranked rows to 5-digit sgg codes, fewer rows than dong level", () => {
    expect(analysis.ranked.length).toBeGreaterThan(0);
    expect(analysis.ranked.length).toBeLessThan(305);
    for (const row of analysis.ranked) {
      expect(row.code).toMatch(/^\d{5}$/);
    }
  });

  it("scores map stays dong-keyed (10-digit) even at sgg admin level, one entry per dong cell", () => {
    expect(scores.size).toBe(cube.cells.length);
    for (const cell of cube.cells) {
      expect(scores.has(cell.code)).toBe(true);
      expect(cell.code).toMatch(/^\d{10}$/);
    }
  });

  it("every dong's sgg-derived score matches its sibling dongs in the same sgg", () => {
    const bySgg = new Map<string, string[]>();
    for (const cell of cube.cells) {
      const sgg = cell.code.slice(0, 5);
      const list = bySgg.get(sgg) ?? [];
      list.push(cell.code);
      bySgg.set(sgg, list);
    }
    for (const [, dongCodes] of bySgg) {
      if (dongCodes.length < 2) continue;
      const values = dongCodes.map((code) => scores.get(code));
      expect(new Set(values).size).toBe(1);
    }
  });
});
