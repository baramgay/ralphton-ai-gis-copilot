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
import { fetchAndMergeVitals } from "@/lib/data/vitals-live";
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

export type LiveDataset = "population" | "vitals";

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
  /*
   * 한 번에 채울 데이터셋. 실측 처리량이 동시성 16에서 1,220회당 약 140초라,
   * 인구(1,220회)와 출생·사망(2,440회)을 한 실행에 넣으면 약 420초로 `maxDuration`
   * 300초를 넘긴다. 그래서 기본은 인구 하나이고, 출생·사망은 별도 실행으로 이어 붙인다.
   * 이어 붙일 때는 `baseFrom: "published"`로 앞선 실행 결과 위에 얹어야 한다.
   */
  datasets?: ReadonlyArray<LiveDataset>;
  /** 기준 스냅샷 출처. 단계 실행에서 앞 단계 결과를 이어받으려면 "published". */
  baseFrom?: "demo" | "published";
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
  const filePath = path.join(root, "public", "data", `administrative-dong-${version}.geojson`);

  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
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

const SYNTHETIC_NOTE_PREFIX = "인구·세대·출생·사망 값은 합성값";

/**
 * 합성값 각주를 **남은 합성 항목만** 말하도록 다시 쓴다. 전부 실측이면 각주를 지운다.
 *
 * 각주는 화면 배지(`populationIsLive`)가 읽는 정본이다. 사실이 바뀌었는데 문장이 그대로면
 * 배지가 거짓말을 한다 — `mode: "live"`인데 인구가 합성이던 사건이 정확히 그랬다.
 * 별도 필드를 두지 않는 이유도 같다: 두 벌이 되면 어긋나는 순간 어느 쪽이 참인지 모른다.
 */
export function rewriteSyntheticNote(
  note: string,
  live: { population: boolean; vitals: boolean },
): string | null {
  if (!note.startsWith(SYNTHETIC_NOTE_PREFIX)) return note;
  if (live.population && live.vitals) return null;
  if (live.population) return "출생·사망 값은 합성값이며 실제 주민등록 통계가 아닙니다.";
  if (live.vitals) return "인구·세대 값은 합성값이며 실제 주민등록 통계가 아닙니다.";
  return note;
}

/**
 * Build a live-capable snapshot without breaking offline demos.
 * - No key → bundled demo snapshot.
 * - With HIRA key → replace facilities from HIRA getHospBasisList (경남).
 * - Optional population: merge latest-month resident counts for ctpv 48.
 */
export async function runLiveSync(options: LiveSyncOptions = {}): Promise<LiveSyncResult> {
  const loadDemo = options.loadDemoSnapshot ?? defaultLoadDemoSnapshot;
  const loadBoundary = options.loadBoundary ?? defaultLoadBoundary;
  const upsert = options.upsert ?? upsertSnapshotWithServiceRole;
  const notes: string[] = [];
  const wantPopulation =
    options.includePopulation !== false &&
    process.env.LIVE_POPULATION_DISABLED?.trim() !== "1";

  /*
   * 단계 실행에서 앞 단계 결과를 이어받는다. 게시본이 없으면 데모로 떨어진다 — 첫 실행이
   * 곧 그 경우다. 조용히 떨어지면 앞 단계 결과가 사라진 줄 모르므로 각주에 남긴다.
   */
  let base = await loadDemo();
  if (options.baseFrom === "published") {
    const { readPublishedSnapshotMeta } = await import("@/lib/supabase/public");
    const published = await readPublishedSnapshotMeta("live");
    if (published) {
      base = published.snapshot;
      notes.push("기준 스냅샷을 게시된 live 스냅샷에서 이어받았습니다.");
    } else {
      notes.push("게시된 live 스냅샷이 없어 데모 스냅샷에서 시작합니다.");
    }
  }
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

    const datasets = options.datasets ?? ["population"];
    let mergedRegions = base.regions;
    let populationUpdated = 0;
    let vitalsUpdated = 0;

    if (wantPopulation && populationKey && datasets.includes("population")) {
      const pop = await fetchAndMergeRegionalPopulation(base, populationKey, {
        fetch: options.fetch,
        timeoutMs: options.timeoutMs,
      });
      mergedRegions = pop.regions;
      populationUpdated = pop.updatedCount;
      notes.push(...pop.notes);
    } else if (wantPopulation && !populationKey) {
      notes.push("인구 live는 DATA_GO_KR_SERVICE_KEY가 없어 생략했습니다.");
    } else if (!wantPopulation) {
      notes.push("인구 live 병합이 비활성입니다(LIVE_POPULATION_DISABLED=1).");
    }

    if (populationKey && datasets.includes("vitals")) {
      const vitals = await fetchAndMergeVitals(
        { ...base, regions: mergedRegions },
        populationKey,
        { fetch: options.fetch, timeoutMs: options.timeoutMs },
      );
      mergedRegions = vitals.regions;
      vitalsUpdated = vitals.updatedCount;
      notes.push(...vitals.notes);
    }

    /*
     * 이어 붙이기: 앞 단계에서 이미 실측이 된 항목은 이번 실행이 건드리지 않아도 실측이다.
     * 그 사실은 기준 스냅샷의 각주에만 남아 있으므로, 각주를 읽어 되살린다.
     *
     * **단계 실행에서만 따진다.** 데모 스냅샷에는 각주가 아예 없을 수도 있는데, 그때
     * "합성 각주가 없으니 실측"으로 읽으면 아무것도 안 채우고 실데이터라 말하게 된다.
     */
    const staged = options.baseFrom === "published";
    const carriedPopulationLive =
      staged &&
      !base.sourceNotes.some(
        (note) =>
          note.startsWith("인구·세대·출생·사망 값은 합성값") ||
          note.startsWith("인구·세대 값은 합성값"),
      );
    const carriedVitalsLive =
      staged &&
      !base.sourceNotes.some(
        (note) =>
          note.startsWith("인구·세대·출생·사망 값은 합성값") ||
          note.startsWith("출생·사망 값은 합성값"),
      );
    const populationLive = populationUpdated > 0 || carriedPopulationLive;
    const vitalsLive = vitalsUpdated > 0 || carriedVitalsLive;
    const populationRegions = mergedRegions;
    const hybrid = populationLive || vitalsLive;
    const liveSnapshot = AnalysisSnapshotSchema.parse({
      ...base,
      mode: "live",
      regions: populationRegions,
      facilities,
      /*
       * 인구 백필은 전부 아니면 전무다(population-live.ts). 성공하면 인구·세대는 실측이고
       * 출생·사망만 합성값으로 남으므로, 기준 스냅샷의 "인구·세대·출생·사망 값은 합성값"
       * 각주를 그대로 두면 안 된다 — 화면 배지가 그 각주를 읽고 인구까지 합성이라 판정한다.
       * 각주는 사용자도 읽고 배지도 읽는 정본이라, 사실이 바뀌면 문장도 바꾼다.
       */
      sourceNotes: [
        ...base.sourceNotes
          .map((note) => rewriteSyntheticNote(note, { population: populationLive, vitals: vitalsLive }))
          .filter((note): note is string => note !== null),
        `HIRA 병원정보서비스(v2)로 경남 시설 ${facilities.length}곳을 갱신했습니다.`,
        populationLive
          ? `인구·세대 ${base.months.length}개월 시계열을 행정안전부 주민등록 실데이터로 교체했습니다(${populationUpdated || base.regions.length}개 읍면동).`
          : "인구·세대 시계열은 검증된 기준 스냅샷을 유지합니다.",
        vitalsLive
          ? `출생·사망 ${base.months.length}개월 시계열을 행정안전부 주민등록 실데이터로 교체했습니다(${vitalsUpdated || base.regions.length}개 읍면동).`
          : "출생·사망 시계열은 검증된 기준 스냅샷을 유지합니다.",
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
