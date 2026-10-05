import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createServer } from "vite";

// Cross-check the published files against independent totals, rather than ranking output.
const snapshotURL = process.argv[2] ?? "https://gnbc.site/api/data/snapshot";
const root = process.cwd();
const server = await createServer({
  configFile: false,
  resolve: { alias: { "@": path.join(root, "src") } },
  server: { middlewareMode: true },
});
const failures = [];
let assertions = 0;
function check(condition, message) {
  assertions += 1;
  if (!condition) failures.push(message);
}
function closeTo(actual, expected, message, tolerance = 1e-8) {
  check(actual === expected || (typeof actual === "number" && Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected))), message);
}

try {
  const { CUBE_LAYERS, POPULATION_LAYER } = await server.ssrLoadModule("/src/lib/layers/catalog.ts");
  const { aggregateToSgg } = await server.ssrLoadModule("/src/lib/layers/aggregate.ts");
  const { populationCubeFromSnapshot } = await server.ssrLoadModule("/src/lib/layers/from-snapshot.ts");
  const { LayerCubeSchema } = await server.ssrLoadModule("/src/lib/layers/types.ts");
  const files = (await readdir("public/data/layers")).filter((name) => name.endsWith(".json")).sort();
  const layers = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join("public/data/layers", file), "utf8"));
    const parsed = LayerCubeSchema.safeParse(raw);
    check(parsed.success, `${file}: invalid cube`);
    if (!parsed.success) continue;
    const cube = parsed.data;
    check(new Set(cube.cells.map((cell) => cell.code)).size === cube.cells.length, `${file}: duplicate region codes`);
    check(new Set(cube.months).size === cube.months.length, `${file}: duplicate months`);
    check(cube.months.every((month, index) => index === 0 || month > cube.months[index - 1]), `${file}: unordered months`);
    let missing = 0;
    let measured = 0;
    for (const cell of cube.cells) {
      for (const [key, series] of Object.entries(cell.series)) {
        for (const value of series) {
          if (value === null) missing += 1;
          else {
            measured += 1;
            check(Number.isFinite(value), `${file}/${cell.code}/${key}: nonfinite value`);
          }
        }
      }
    }
    const descriptor = CUBE_LAYERS.find((layer) => layer.id === cube.layerId);
    if (descriptor && cube.adminLevel === "dong" && descriptor.geometry !== "grid") {
      const district = aggregateToSgg(cube, descriptor.metrics);
      for (const group of district.cells) {
        const members = cube.cells.filter((cell) => cell.code.startsWith(group.code));
        for (const metric of descriptor.metrics.filter((candidate) => candidate.aggregation === "sum")) {
          for (let index = 0; index < cube.months.length; index += 1) {
            const values = members.map((cell) => cell.series[metric.key]?.[index]);
            const expected = values.some((value) => value == null || !Number.isFinite(value))
              ? null
              : values.reduce((total, value) => total + value, 0);
            closeTo(group.series[metric.key]?.[index], expected, `${file}/${group.code}/${metric.key}/${cube.months[index]}: total mismatch`);
          }
        }
        // Published percentage formulas: independently sum their actual component amounts.
        const ratios = cube.layerId === "nh-demographics"
          ? [
              ["youth_share", "youth_sales", "personal_sales"],
              ["middle_share", "middle_sales", "personal_sales"],
              ["senior_share", "senior_sales", "personal_sales"],
              ["female_share", "female_sales", "personal_sales"],
              ["corporate_share", "corporate_sales", "total_sales"],
            ]
          : cube.layerId === "nh-hourly" ? [["night_share", "night_sales_exact", "total_sales"]] : [];
        for (const [key, numeratorKey, denominatorKey] of ratios) {
          for (let index = 0; index < cube.months.length; index += 1) {
            const numerators = members.map((cell) => cell.series[numeratorKey]?.[index]);
            const denominators = members.map((cell) => cell.series[denominatorKey]?.[index]);
            const complete = [...numerators, ...denominators].every((value) => value != null && Number.isFinite(value));
            const denominator = complete ? denominators.reduce((sum, value) => sum + value, 0) : 0;
            const expected = denominator > 0 ? numerators.reduce((sum, value) => sum + value, 0) / denominator * 100 : null;
            closeTo(group.series[key]?.[index], expected, `${file}/${group.code}/${key}/${cube.months[index]}: actual numerator / denominator mismatch`);
          }
        }
      }
    }
    layers.push({ file, regions: cube.cells.length, observations: measured, missing });
  }

  let snapshot;
  let publishedAt = null;
  if (/^https?:\/\//.test(snapshotURL)) {
    const response = await fetch(snapshotURL, { signal: AbortSignal.timeout(30_000) });
    assert(response.ok, `snapshot HTTP ${response.status}`);
    snapshot = await response.json();
    publishedAt = response.headers.get("x-published-at");
  } else {
    snapshot = JSON.parse(await readFile(snapshotURL, "utf8"));
  }
  const population = populationCubeFromSnapshot(snapshot);
  const districts = aggregateToSgg(population, POPULATION_LAYER.metrics);
  for (const group of districts.cells) {
    const members = snapshot.regions.filter((region) => region.adm_cd2.startsWith(group.code));
    const area = members.reduce((sum, region) => sum + region.areaSquareKm, 0);
    for (let index = 0; index < snapshot.months.length; index += 1) {
      const totalPopulation = members.reduce((sum, region) => sum + region.population[index], 0);
      const expected = area > 0 ? totalPopulation / area : null;
      closeTo(group.series.density[index], expected, `population/${group.code}/${snapshot.months[index]}: total population / total area mismatch`);
    }
  }

  const report = {
    checkedAt: new Date().toISOString(), snapshotURL,
    publishedAt,
    referenceMonth: snapshot.referenceMonth,
    assertions, layers, densityDistricts: districts.cells.length,
    failures,
  };
  await mkdir("test-results", { recursive: true });
  await writeFile("test-results/nurimap-numerics.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ assertions, files: layers.length, densityDistricts: districts.cells.length, failures: failures.slice(0, 12), failureCount: failures.length }));
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await server.close();
}
