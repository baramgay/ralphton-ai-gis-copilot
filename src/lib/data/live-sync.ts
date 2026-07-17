import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  facilitiesFromHiraRows,
  fetchHiraHospitalRows,
  resolveHiraServiceKey,
} from "@/lib/data/hira-hospitals";
import { fetchAndMergeRegionalPopulation } from "@/lib/data/population-live";
import type { AssignableRegion } from "@/lib/data/region-assignment";
import {
  AnalysisSnapshotSchema,
  type AnalysisSnapshot,
  type DemoSnapshot,
} from "@/lib/domain/schemas";
import {
  upsertSnapshotWithServiceRole,
  type UpsertSnapshotInput,
} from "@/lib/supabase/server";

const DEMO_SNAPSHOT_PATH = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "public",
  "data",
  "demo-snapshot.json",
);

const BoundaryFeatureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({
    adm_cd2: z.string().regex(/^\d{10}$/),
    adm_nm: z.string().min(1),
  }),
  geometry: z.union([
    z.object({
      type: z.literal("Polygon"),
      coordinates: z.array(z.array(z.array(z.number()))),
    }),
    z.object({
      type: z.literal("MultiPolygon"),
      coordinates: z.array(z.array(z.array(z.array(z.number())))),
    }),
  ]),
});

const BoundaryCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(BoundaryFeatureSchema).min(1),
});

export type LiveSyncStatus =
  | "demo-only"
  | "facilities-live"
  | "hybrid-live"
  | "failed";

export interface LiveSyncResult {
  status: LiveSyncStatus;
  snapshot: AnalysisSnapshot;
  checksum: string;
  facilityCount: number;
  published: boolean;
  notes: string[];
  populationUpdated?: number;
}

export interface LiveSyncOptions {
  serviceKey?: string;
  /** HIRA hospital key (defaults to HIRA_HOSP_SERVICE_KEY / DATA_GO_KR_SERVICE_KEY). */
  hiraServiceKey?: string;
  boundaryVersion?: string;
  publish?: boolean;
  /** Attempt partial population merge (default true when service key present). */
  includePopulation?: boolean;
  snapshotId?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  loadDemoSnapshot?: () => Promise<DemoSnapshot | AnalysisSnapshot>;
  loadBoundary?: (version: string) => Promise<AssignableRegion[]>;
  upsert?: (input: UpsertSnapshotInput) => Promise<boolean>;
}

async function defaultLoadDemoSnapshot(): Promise<AnalysisSnapshot> {
  const text = await readFile(DEMO_SNAPSHOT_PATH, "utf8");
  return AnalysisSnapshotSchema.parse(JSON.parse(text));
}

async function defaultLoadBoundary(version: string): Promise<AssignableRegion[]> {
  const root = /* turbopackIgnore: true */ process.cwd();
  const candidates = [
    path.join(root, "public", "data", `administrative-dong-${version}.geojson`),
    path.join(root, "public", "data", `busan-administrative-dong-${version}.geojson`),
  ];

  let text: string | null = null;
  for (const filePath of candidates) {
    try {
      text = await readFile(filePath, "utf8");
      break;
    } catch {
      // try next
    }
  }
  if (!text) {
    throw new Error(`경계 파일을 찾을 수 없습니다 (ver${version}).`);
  }

  const collection = BoundaryCollectionSchema.parse(JSON.parse(text));
  return collection.features.map((feature) => ({
    adm_cd2: feature.properties.adm_cd2,
    adm_nm: feature.properties.adm_nm,
    geometry: feature.geometry,
  }));
}

function checksumOf(snapshot: AnalysisSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

/**
 * Build a live-capable snapshot without breaking offline demos.
 * - No key → bundled demo snapshot.
 * - With HIRA key → replace facilities from HIRA getHospBasisList (부산·경남).
 * - Optional population: merge latest-month resident counts for ctpv 26+48.
 */
export async function runLiveSync(options: LiveSyncOptions = {}): Promise<LiveSyncResult> {
  const loadDemo = options.loadDemoSnapshot ?? defaultLoadDemoSnapshot;
  const loadBoundary = options.loadBoundary ?? defaultLoadBoundary;
  const upsert = options.upsert ?? upsertSnapshotWithServiceRole;
  const notes: string[] = [];
  const wantPopulation =
    options.includePopulation !== false &&
    process.env.LIVE_POPULATION_DISABLED?.trim() !== "1";

  const base = await loadDemo();
  const populationKey =
    options.serviceKey?.trim() ?? process.env.DATA_GO_KR_SERVICE_KEY?.trim() ?? "";
  const hiraKey = resolveHiraServiceKey(options.hiraServiceKey ?? options.serviceKey);

  if (!hiraKey) {
    notes.push("HIRA/공공데이터 키가 없어 데모 스냅샷을 유지했습니다.");
    const checksum = checksumOf(base);
    return {
      status: "demo-only",
      snapshot: base,
      checksum,
      facilityCount: base.facilities.length,
      published: false,
      notes,
      populationUpdated: 0,
    };
  }

  try {
    const version =
      options.boundaryVersion ??
      process.env.BOUNDARY_VERSION?.trim() ??
      "20260701";
    const boundaryRegions = await loadBoundary(version);
    const rows = await fetchHiraHospitalRows(
      { serviceKey: hiraKey, numOfRows: 1_000 },
      { fetch: options.fetch, timeoutMs: options.timeoutMs },
    );
    const facilities = facilitiesFromHiraRows(rows, boundaryRegions);

    if (facilities.length === 0) {
      notes.push("HIRA 병원 응답에서 매핑 가능한 시설이 없어 데모 시설을 유지했습니다.");
      const checksum = checksumOf(base);
      return {
        status: "demo-only",
        snapshot: base,
        checksum,
        facilityCount: base.facilities.length,
        published: false,
        notes,
        populationUpdated: 0,
      };
    }

    let populationRegions = base.regions;
    let populationUpdated = 0;
    if (wantPopulation && populationKey) {
      const pop = await fetchAndMergeRegionalPopulation(base, populationKey, {
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
      });
      populationRegions = pop.regions;
      populationUpdated = pop.updatedCount;
      notes.push(...pop.notes);
    } else if (wantPopulation && !populationKey) {
      notes.push("인구 live는 DATA_GO_KR_SERVICE_KEY가 없어 생략했습니다.");
    } else {
      notes.push("인구 live 병합이 비활성입니다(LIVE_POPULATION_DISABLED=1).");
    }

    const hybrid = populationUpdated > 0;
    const liveSnapshot = AnalysisSnapshotSchema.parse({
      ...base,
      mode: "live",
      regions: populationRegions,
      facilities,
      sourceNotes: [
        ...base.sourceNotes,
        `HIRA 병원정보서비스(v2)로 부산·경남 시설 ${facilities.length}곳을 갱신했습니다.`,
        hybrid
          ? `인구: 부산·경남 최신월 일부 live 반영(${populationUpdated}개 동). 나머지 시계열은 기준 스냅샷.`
          : "인구·세대 시계열은 검증된 기준 스냅샷을 유지합니다.",
      ],
    });

    notes.push(`시설 ${facilities.length}곳을 HIRA 실데이터로 교체했습니다.`);
    const checksum = checksumOf(liveSnapshot);
    let published = false;

    if (options.publish !== false) {
      published = await upsert({
        id: options.snapshotId ?? `live-bn-${liveSnapshot.referenceMonth}`,
        source: hybrid
          ? "hira/hospInfoServicev2+residentPopulation"
          : "hira/hospInfoServicev2",
        checksum,
        isPublished: true,
        snapshot: liveSnapshot,
      });
      notes.push(
        published
          ? "Supabase 공개 캐시에 게시했습니다."
          : "Supabase 게시 생략(서비스 롤 없음 또는 쓰기 실패).",
      );
    }

    return {
      status: hybrid ? "hybrid-live" : "facilities-live",
      snapshot: liveSnapshot,
      checksum,
      facilityCount: facilities.length,
      published,
      notes,
      populationUpdated,
    };
  } catch (error) {
    notes.push(
      `실데이터 동기화 실패: ${error instanceof Error ? error.message : "unknown"} — 데모 폴백.`,
    );
    const checksum = checksumOf(base);
    return {
      status: "failed",
      snapshot: base,
      checksum,
      facilityCount: base.facilities.length,
      published: false,
      notes,
      populationUpdated: 0,
    };
  }
}
