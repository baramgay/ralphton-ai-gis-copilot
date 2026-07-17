import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  facilitiesFromMedicalRows,
  fetchMedicalInstitutionRows,
} from "@/lib/data/medical-facilities";
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

const DEMO_SNAPSHOT_PATH = path.join(process.cwd(), "public", "data", "demo-snapshot.json");

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
  | "failed";

export interface LiveSyncResult {
  status: LiveSyncStatus;
  snapshot: AnalysisSnapshot;
  checksum: string;
  facilityCount: number;
  published: boolean;
  notes: string[];
}

export interface LiveSyncOptions {
  serviceKey?: string;
  boundaryVersion?: string;
  publish?: boolean;
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
  const filePath = path.join(
    process.cwd(),
    "public",
    "data",
    `busan-administrative-dong-${version}.geojson`,
  );
  const text = await readFile(filePath, "utf8");
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
 * - No service key → returns the bundled demo snapshot.
 * - With key → replaces facilities from Busan medical API when parseable.
 * - Population series stay from the verified demo base unless a full live
 *   population normalize path is wired later (safe hybrid).
 */
export async function runLiveSync(options: LiveSyncOptions = {}): Promise<LiveSyncResult> {
  const loadDemo = options.loadDemoSnapshot ?? defaultLoadDemoSnapshot;
  const loadBoundary = options.loadBoundary ?? defaultLoadBoundary;
  const upsert = options.upsert ?? upsertSnapshotWithServiceRole;
  const notes: string[] = [];

  const base = await loadDemo();
  const serviceKey = options.serviceKey?.trim() ?? process.env.DATA_GO_KR_SERVICE_KEY?.trim() ?? "";

  if (!serviceKey) {
    notes.push("공공데이터 키가 없어 데모 스냅샷을 유지했습니다.");
    const checksum = checksumOf(base);
    return {
      status: "demo-only",
      snapshot: base,
      checksum,
      facilityCount: base.facilities.length,
      published: false,
      notes,
    };
  }

  try {
    const version =
      options.boundaryVersion ??
      process.env.BOUNDARY_VERSION?.trim() ??
      "20260701";
    const regions = await loadBoundary(version);
    const rows = await fetchMedicalInstitutionRows(
      { serviceKey, numOfRows: 1_000 },
      { fetch: options.fetch, timeoutMs: options.timeoutMs },
    );
    const facilities = facilitiesFromMedicalRows(rows, regions);

    if (facilities.length === 0) {
      notes.push("의료기관 응답에서 매핑 가능한 시설이 없어 데모 시설을 유지했습니다.");
      const checksum = checksumOf(base);
      return {
        status: "demo-only",
        snapshot: base,
        checksum,
        facilityCount: base.facilities.length,
        published: false,
        notes,
      };
    }

    const liveSnapshot = AnalysisSnapshotSchema.parse({
      ...base,
      mode: "live",
      facilities,
      sourceNotes: [
        ...base.sourceNotes,
        `부산 의료기관/약국 운영시간 API로 시설 ${facilities.length}곳을 갱신했습니다.`,
        "인구·세대 시계열은 검증된 기준 스냅샷을 유지합니다(전면 live 인구 정규화는 단계적 도입).",
      ],
    });

    notes.push(`시설 ${facilities.length}곳을 실데이터로 교체했습니다.`);
    const checksum = checksumOf(liveSnapshot);
    let published = false;

    if (options.publish !== false) {
      published = await upsert({
        id: options.snapshotId ?? `live-busan-${liveSnapshot.referenceMonth}`,
        source: "data.go.kr/MedicInstitService",
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
      status: "facilities-live",
      snapshot: liveSnapshot,
      checksum,
      facilityCount: facilities.length,
      published,
      notes,
    };
  } catch {
    notes.push("실데이터 동기화에 실패해 데모 스냅샷으로 폴백했습니다.");
    const checksum = checksumOf(base);
    return {
      status: "failed",
      snapshot: base,
      checksum,
      facilityCount: base.facilities.length,
      published: false,
      notes,
    };
  }
}
