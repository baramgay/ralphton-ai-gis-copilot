# 경남 GIS 레이어 기반(Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 랄프톤 앱을 부산+경남 의료 고정에서 경남 특화 + 제네릭 레이어/코로플레스 큐브 기반으로 전환한다. 기존 의료·인구 기능이 큐브 모델 위에서 그대로 동작하고 시군구/읍면동 단위 전환이 가능한 상태가 목표.

**Architecture:** 레이어는 `LayerDescriptor`(메타)와 `LayerCube`(읍면동×월×지표 데이터)로 표현한다. 시군구 뷰는 읍면동 큐브를 런타임 집계(sum/weightedAvg)로 파생한다. 기존 `AnalysisSnapshot`(주민등록 인구+의료시설)을 `population`·`medical` 두 레이어로 흡수한다. 부산 데이터는 전 계층에서 제거한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Turf, Vitest, Node ESM scripts.

**Scope:** 이 계획은 Phase 1(기반)만 다룬다. SKT 생활인구 어댑터·레이어 스위처 완성·NL 레이어 라우팅은 Phase 2 별도 계획.

**Spec:** `docs/superpowers/specs/2026-07-24-gyeongnam-gis-layers-design.md`

---

## File Structure

**신규**
- `src/lib/layers/types.ts` — `AdminLevel`, `LayerKind`, `MetricDef`, `LayerDescriptor`, `LayerCube`, `LayerCell` 타입 + zod 스키마
- `src/lib/layers/aggregate.ts` — 읍면동 큐브 → 시군구 큐브 집계(sum/weightedAvg)
- `src/lib/layers/catalog.ts` — Phase 1 레이어 카탈로그(`population`, `medical`) 정의
- `src/lib/layers/from-snapshot.ts` — 기존 `AnalysisSnapshot` → `population`/`medical` `LayerCube` 어댑터
- `tests/layers/types.test.ts`, `tests/layers/aggregate.test.ts`, `tests/layers/from-snapshot.test.ts`
- `scripts/lib/gyeongnam-core.mjs` — 경남 필터 + 시군구 dissolve 순수 함수
- `tests/scripts/gyeongnam-core.test.ts`

**수정**
- `src/lib/analysis/scope.ts` — 부산 제거, 경남 시군구/읍면동 헬퍼로 재편
- `src/lib/analysis/intent-schema.ts` — `layerId`·`metricKey`·`adminLevel` 슬롯 추가
- `scripts/fetch-boundaries.mjs`, `scripts/lib/seed-core.mjs`, `scripts/validate-boundaries.mjs` — 경남 305동만
- `src/lib/data/hira-hospitals.ts`, `src/lib/data/live-sync.ts` — sido 380000(경남)만
- `src/components/copilot/copilot-app.tsx` — 부산 시도 칩 제거, 큐브 소비, 단위 토글(Phase 1은 훅/상태까지)
- `public/data/*` — 경남 전용 재생성(스크립트 산출물, 커밋)
- 기존 테스트: `tests/analysis/scope.test.ts`, `tests/data/*`, `tests/scripts/*` 부산 기대치 수정

---

## Task 1: 레이어/큐브 코어 타입

**Files:**
- Create: `src/lib/layers/types.ts`
- Test: `tests/layers/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/layers/types.test.ts
import { describe, expect, it } from "vitest";
import { LayerCubeSchema, LayerDescriptorSchema, type LayerCube } from "@/lib/layers/types";

const cube: LayerCube = {
  layerId: "population",
  adminLevel: "dong",
  referenceMonth: "2026-06",
  months: ["2026-06"],
  cells: [
    {
      code: "4812051000",
      name: "경상남도 창원시 의창구 동읍",
      point: { lat: 35.3, lng: 128.6 },
      areaKm2: 12.3,
      series: { pop_total: [1234] },
    },
  ],
};

describe("layer types", () => {
  it("parses a valid cube", () => {
    expect(LayerCubeSchema.parse(cube)).toEqual(cube);
  });

  it("rejects a cube whose series length differs from months length", () => {
    const bad = { ...cube, cells: [{ ...cube.cells[0], series: { pop_total: [1, 2] } }] };
    expect(() => LayerCubeSchema.parse(bad)).toThrow();
  });

  it("parses a descriptor with metrics", () => {
    const d = LayerDescriptorSchema.parse({
      id: "population",
      label: "인구",
      provider: "공공",
      kind: "choropleth",
      coverage: "gyeongnam",
      adminLevels: ["dong", "sgg"],
      months: ["2026-06"],
      sourceNotes: ["주민등록"],
      metrics: [
        {
          key: "pop_total",
          label: "총인구",
          unit: "명",
          aggregation: "sum",
          formula: "월별 주민등록 인구",
          limitation: "외국인 제외",
          triggers: ["인구", "총인구"],
        },
      ],
    });
    expect(d.metrics[0].aggregation).toBe("sum");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/layers/types.test.ts`
Expected: FAIL — `Cannot find module '@/lib/layers/types'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/layers/types.ts
import { z } from "zod";

export const AdminLevelSchema = z.enum(["dong", "sgg"]);
export type AdminLevel = z.infer<typeof AdminLevelSchema>;

export const LayerKindSchema = z.enum(["choropleth", "point"]);
export type LayerKind = z.infer<typeof LayerKindSchema>;

export const MetricDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  unit: z.string(),
  aggregation: z.enum(["sum", "weightedAvg"]),
  weightKey: z.string().min(1).optional(),
  formula: z.string().min(1),
  limitation: z.string(),
  triggers: z.array(z.string().min(1)),
});
export type MetricDef = z.infer<typeof MetricDefSchema>;

export const LayerDescriptorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  provider: z.enum(["공공", "SKT", "NH", "KCB"]),
  kind: LayerKindSchema,
  coverage: z.literal("gyeongnam"),
  adminLevels: z.array(AdminLevelSchema).min(1),
  metrics: z.array(MetricDefSchema),
  months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)),
  sourceNotes: z.array(z.string().min(1)),
});
export type LayerDescriptor = z.infer<typeof LayerDescriptorSchema>;

export const LayerCellSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  point: z.object({ lat: z.number(), lng: z.number() }),
  areaKm2: z.number().nonnegative(),
  series: z.record(z.string(), z.array(z.number().nullable())),
  breakdown: z.record(z.string(), z.unknown()).optional(),
});
export type LayerCell = z.infer<typeof LayerCellSchema>;

export const LayerCubeSchema = z
  .object({
    layerId: z.string().min(1),
    adminLevel: AdminLevelSchema,
    referenceMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    months: z.array(z.string()).min(1),
    cells: z.array(LayerCellSchema),
  })
  .refine(
    (cube) =>
      cube.cells.every((cell) =>
        Object.values(cell.series).every((s) => s.length === cube.months.length),
      ),
    { message: "series length must equal months length" },
  );
export type LayerCube = z.infer<typeof LayerCubeSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/layers/types.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/layers/types.ts tests/layers/types.test.ts
git commit -m "feat(layers): add layer descriptor and choropleth cube types"
```

---

## Task 2: 읍면동 → 시군구 집계

**Files:**
- Create: `src/lib/layers/aggregate.ts`
- Test: `tests/layers/aggregate.test.ts`

시군구 코드는 읍면동 10자리 `adm_cd2`의 앞 5자리(`sgg`)로 파생한다. `sum` 지표는 단순 합, `weightedAvg`는 `weightKey` 지표를 가중치로 한 가중평균(가중치 합 0이면 null).

- [ ] **Step 1: Write the failing test**

```ts
// tests/layers/aggregate.test.ts
import { describe, expect, it } from "vitest";
import { aggregateToSgg } from "@/lib/layers/aggregate";
import type { LayerCube } from "@/lib/layers/types";
import type { MetricDef } from "@/lib/layers/types";

const metrics: MetricDef[] = [
  { key: "pop", label: "인구", unit: "명", aggregation: "sum", formula: "f", limitation: "", triggers: [] },
  { key: "ratio", label: "고령비", unit: "%", aggregation: "weightedAvg", weightKey: "pop", formula: "f", limitation: "", triggers: [] },
];

const dongCube: LayerCube = {
  layerId: "population",
  adminLevel: "dong",
  referenceMonth: "2026-06",
  months: ["2026-06"],
  cells: [
    { code: "4812051000", name: "창원 동읍", point: { lat: 35.3, lng: 128.6 }, areaKm2: 10, series: { pop: [100], ratio: [20] } },
    { code: "4812052000", name: "창원 북면", point: { lat: 35.4, lng: 128.6 }, areaKm2: 30, series: { pop: [300], ratio: [40] } },
    { code: "4817051000", name: "진주 A동", point: { lat: 35.1, lng: 128.1 }, areaKm2: 5, series: { pop: [50], ratio: [10] } },
  ],
};

describe("aggregateToSgg", () => {
  it("groups dong cells by 5-digit sgg code", () => {
    const sgg = aggregateToSgg(dongCube, metrics);
    expect(sgg.adminLevel).toBe("sgg");
    expect(sgg.cells.map((c) => c.code).sort()).toEqual(["48120", "48170"]);
  });

  it("sums sum-metrics and area", () => {
    const sgg = aggregateToSgg(dongCube, metrics);
    const changwon = sgg.cells.find((c) => c.code === "48120")!;
    expect(changwon.series.pop).toEqual([400]);
    expect(changwon.areaKm2).toBe(40);
  });

  it("computes weighted average for weightedAvg-metrics", () => {
    const sgg = aggregateToSgg(dongCube, metrics);
    const changwon = sgg.cells.find((c) => c.code === "48120")!;
    // (20*100 + 40*300) / (100+300) = 14000/400 = 35
    expect(changwon.series.ratio).toEqual([35]);
  });

  it("returns null for weighted average when total weight is zero", () => {
    const zero: LayerCube = {
      ...dongCube,
      cells: [
        { code: "4812051000", name: "a", point: { lat: 0, lng: 0 }, areaKm2: 1, series: { pop: [0], ratio: [20] } },
      ],
    };
    const sgg = aggregateToSgg(zero, metrics);
    expect(sgg.cells[0].series.ratio).toEqual([null]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/layers/aggregate.test.ts`
Expected: FAIL — `Cannot find module '@/lib/layers/aggregate'`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/layers/aggregate.ts
import type { LayerCell, LayerCube, MetricDef } from "@/lib/layers/types";

function sggCode(dongCode: string): string {
  return dongCode.slice(0, 5);
}

function sggName(dongName: string): string {
  // "경상남도 창원시 의창구 동읍" → "경상남도 창원시" (앞 2 토큰)
  const parts = dongName.split(/\s+/);
  return parts.slice(0, 2).join(" ");
}

export function aggregateToSgg(cube: LayerCube, metrics: MetricDef[]): LayerCube {
  const groups = new Map<string, LayerCell[]>();
  for (const cell of cube.cells) {
    const code = sggCode(cell.code);
    const bucket = groups.get(code) ?? [];
    bucket.push(cell);
    groups.set(code, bucket);
  }

  const n = cube.months.length;
  const cells: LayerCell[] = [];

  for (const [code, members] of groups) {
    const series: Record<string, (number | null)[]> = {};
    for (const metric of metrics) {
      series[metric.key] = Array.from({ length: n }, (_, i) => {
        if (metric.aggregation === "sum") {
          let total = 0;
          for (const m of members) total += m.series[metric.key]?.[i] ?? 0;
          return total;
        }
        // weightedAvg
        const weightKey = metric.weightKey;
        let weighted = 0;
        let weight = 0;
        for (const m of members) {
          const v = m.series[metric.key]?.[i];
          const w = weightKey ? m.series[weightKey]?.[i] ?? 0 : 1;
          if (v == null) continue;
          weighted += v * w;
          weight += w;
        }
        return weight === 0 ? null : weighted / weight;
      });
    }

    let area = 0;
    let latSum = 0;
    let lngSum = 0;
    for (const m of members) {
      area += m.areaKm2;
      latSum += m.point.lat;
      lngSum += m.point.lng;
    }

    cells.push({
      code,
      name: sggName(members[0].name),
      point: { lat: latSum / members.length, lng: lngSum / members.length },
      areaKm2: area,
      series,
    });
  }

  return {
    layerId: cube.layerId,
    adminLevel: "sgg",
    referenceMonth: cube.referenceMonth,
    months: cube.months,
    cells,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/layers/aggregate.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/layers/aggregate.ts tests/layers/aggregate.test.ts
git commit -m "feat(layers): aggregate dong cube to sgg (sum/weightedAvg)"
```

---

## Task 3: intent-schema에 레이어 슬롯 추가

**Files:**
- Modify: `src/lib/analysis/intent-schema.ts:37-53`
- Test: `tests/analysis/intent-schema.test.ts` (신규)

기존 `tool` enum·`filters`는 유지(하위호환). 최상위에 optional `layerId`·`metricKey`·`adminLevel` 추가. `.strict()` 유지.

- [ ] **Step 1: Write the failing test**

```ts
// tests/analysis/intent-schema.test.ts
import { describe, expect, it } from "vitest";
import { AnalysisIntentSchema } from "@/lib/analysis/intent-schema";

describe("AnalysisIntent layer slots", () => {
  it("accepts optional layer/metric/adminLevel", () => {
    const parsed = AnalysisIntentSchema.parse({
      tool: "getRegionDetails",
      layerId: "population",
      metricKey: "pop_total",
      adminLevel: "sgg",
      filters: {},
    });
    expect(parsed.adminLevel).toBe("sgg");
  });

  it("still accepts a legacy intent without layer slots", () => {
    const parsed = AnalysisIntentSchema.parse({ tool: "compareRegions", filters: {} });
    expect(parsed.layerId).toBeUndefined();
  });

  it("rejects an invalid adminLevel", () => {
    expect(() =>
      AnalysisIntentSchema.parse({ tool: "compareRegions", adminLevel: "block", filters: {} }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analysis/intent-schema.test.ts`
Expected: FAIL — `adminLevel` unknown key (strict) / property missing

- [ ] **Step 3: Write minimal implementation**

`src/lib/analysis/intent-schema.ts`의 `AnalysisIntentSchema` 정의를 아래로 교체(기존 `.object({ tool..., filters... }).strict()` 블록):

```ts
import { AdminLevelSchema } from "@/lib/layers/types";

export const AnalysisIntentSchema = z
  .object({
    tool: ToolNameSchema,
    layerId: z.string().min(1).max(40).optional(),
    metricKey: z.string().min(1).max(60).optional(),
    adminLevel: AdminLevelSchema.optional(),
    filters: z
      .object({
        facilityTypes: z.array(FacilityTypeSchema).max(20).optional(),
        includePharmacy: z.boolean().optional(),
        radiusKm: z.number().min(1).max(3).optional(),
        requireNightHours: z.boolean().optional(),
        requireWeekendHours: z.boolean().optional(),
        regions: z.array(z.string().min(1).max(50)).max(10).optional(),
        compare: z.array(z.string().min(1).max(50)).max(10).optional(),
        limit: z.number().int().min(1).max(600).optional(),
      })
      .strict(),
  })
  .strict();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analysis/intent-schema.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Verify no regression in parse path**

Run: `npx vitest run tests/api/ai-parse.test.ts tests/analysis/query-rules.test.ts`
Expected: PASS (기존 통과 유지)

- [ ] **Step 6: Commit**

```bash
git add src/lib/analysis/intent-schema.ts tests/analysis/intent-schema.test.ts
git commit -m "feat(analysis): add layerId/metricKey/adminLevel slots to intent"
```

---

## Task 4: 경남 필터 + 시군구 dissolve 순수 함수

**Files:**
- Create: `scripts/lib/gyeongnam-core.mjs`
- Test: `tests/scripts/gyeongnam-core.test.ts`

`administrative-dong-20260701.geojson`의 feature properties(`adm_nm`, `adm_cd2`, `sgg`, `sggnm`)를 사용. 경남은 `adm_cd2` 앞 2자리 `48`. 시군구 dissolve는 Phase 1에서는 폴리곤 병합(turf `union`)까지 안 하고 **코드·이름 목록만** 산출(시군구 경계 렌더는 Phase 2). 이 태스크는 순수 필터/그룹 함수만.

- [ ] **Step 1: Write the failing test**

```ts
// tests/scripts/gyeongnam-core.test.ts
import { describe, expect, it } from "vitest";
import { filterGyeongnam, listSggFromDong } from "../../scripts/lib/gyeongnam-core.mjs";

const features = [
  { properties: { adm_nm: "부산광역시 중구 중앙동", adm_cd2: "2611051000", sgg: "26110", sggnm: "중구" } },
  { properties: { adm_nm: "경상남도 창원시 의창구 동읍", adm_cd2: "4812051000", sgg: "48120", sggnm: "창원시 의창구" } },
  { properties: { adm_nm: "경상남도 진주시 천전동", adm_cd2: "4817051000", sgg: "48170", sggnm: "진주시" } },
];

describe("gyeongnam-core", () => {
  it("keeps only 경상남도 (adm_cd2 starts 48)", () => {
    const kept = filterGyeongnam(features);
    expect(kept).toHaveLength(2);
    expect(kept.every((f) => f.properties.adm_cd2.startsWith("48"))).toBe(true);
  });

  it("lists distinct sgg codes with names", () => {
    const sgg = listSggFromDong(filterGyeongnam(features));
    expect(sgg).toEqual([
      { code: "48120", name: "창원시 의창구" },
      { code: "48170", name: "진주시" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scripts/gyeongnam-core.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```js
// scripts/lib/gyeongnam-core.mjs
export function filterGyeongnam(features) {
  return features.filter((f) => String(f.properties.adm_cd2).startsWith("48"));
}

export function listSggFromDong(features) {
  const map = new Map();
  for (const f of features) {
    const { sgg, sggnm } = f.properties;
    if (!map.has(sgg)) map.set(sgg, { code: sgg, name: sggnm });
  }
  return [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scripts/gyeongnam-core.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/gyeongnam-core.mjs tests/scripts/gyeongnam-core.test.ts
git commit -m "feat(scripts): gyeongnam filter and sgg list helpers"
```

---

## Task 5: scope.ts 경남 재편

**Files:**
- Modify: `src/lib/analysis/scope.ts` (전면 교체)
- Modify: `tests/analysis/scope.test.ts` (부산 기대치 제거)

> **선행 독해:** `src/lib/analysis/scope.ts` 전체와 `tests/analysis/scope.test.ts` 전체를 먼저 읽어 현재 export 사용처를 파악한다. `copilot-app.tsx`가 `applySidoScopeToRegions`, `filterBySidoScope`, `matchesSidoScope`, `sidoBadge`, `SidoScope`, `SIDO_SCOPE_LABEL`를 import한다(Task 8에서 정리).

Phase 1 방침: `SidoScope`(all/busan/gyeongnam)를 제거하지 않고 **의미를 시군구 필터로 재정의하기보다**, 부산 분기만 삭제하고 시군구 헬퍼를 신규 추가한다. 소비처(copilot-app)는 Task 8에서 함께 수정하므로, 이 태스크는 scope 모듈과 그 단위테스트만 그린으로 만든다.

- [ ] **Step 1: 새 스펙을 반영해 테스트를 먼저 수정/작성**

`tests/analysis/scope.test.ts`에서 부산 관련 케이스를 제거하고 아래 시군구 헬퍼 테스트를 추가한다:

```ts
import { sggCodeOf, sggNameOf, isGyeongnam } from "@/lib/analysis/scope";

describe("gyeongnam scope helpers", () => {
  it("derives 5-digit sgg code from 10-digit dong code", () => {
    expect(sggCodeOf("4812051000")).toBe("48120");
  });
  it("extracts sgg name from full adm_nm", () => {
    expect(sggNameOf("경상남도 창원시 의창구 동읍")).toBe("창원시 의창구");
  });
  it("flags gyeongnam membership", () => {
    expect(isGyeongnam("4817051000")).toBe(true);
    expect(isGyeongnam("2611051000")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analysis/scope.test.ts`
Expected: FAIL — `sggCodeOf` 등 미정의

- [ ] **Step 3: scope.ts에 헬퍼 추가(부산 분기 삭제)**

`stripSido`는 `"경상남도 "` 접두만 제거하도록 축소하고, 부산 관련 export(`sidoBadge`의 부산 분기, `matchesSidoScope`의 busan 분기)는 경남 전용으로 정리한다. 신규 export:

```ts
export function sggCodeOf(dongCode: string): string {
  return dongCode.slice(0, 5);
}

export function sggNameOf(admNm: string): string {
  // "경상남도 창원시 의창구 동읍" → "창원시 의창구"
  const withoutSido = admNm.replace(/^경상남도\s*/, "");
  const parts = withoutSido.split(/\s+/);
  // 광역시 자치구가 있는 창원만 2토큰, 그 외는 1토큰
  return parts[0]?.endsWith("시") && parts[1]?.endsWith("구")
    ? `${parts[0]} ${parts[1]}`
    : parts[0] ?? "";
}

export function isGyeongnam(dongCode: string): boolean {
  return String(dongCode).startsWith("48");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/analysis/scope.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/analysis/scope.ts tests/analysis/scope.test.ts
git commit -m "feat(analysis): add gyeongnam sgg helpers, drop busan branches"
```

---

## Task 6: 경남 전용 경계·데모 데이터 재생성

**Files:**
- Modify: `scripts/fetch-boundaries.mjs`, `scripts/lib/seed-core.mjs`, `scripts/validate-boundaries.mjs`
- Regenerate (commit outputs): `public/data/administrative-dong-20260701.geojson`, `public/data/demo-snapshot.json`, `public/data/place-index.json`, `public/data/boundary-metadata.json`
- Test: `tests/scripts/boundary-core.test.ts`, `tests/scripts/seed-core.test.ts` (부산 기대치 수정)

> **선행 독해:** `scripts/fetch-boundaries.mjs`(특히 `extractBusanGyeongnam`), `scripts/lib/seed-core.mjs`, `scripts/validate-boundaries.mjs`, 그리고 `tests/scripts/boundary-core.test.ts`·`tests/scripts/seed-core.test.ts`를 먼저 읽는다. `src/lib/domain/schemas.ts`의 `DemoSnapshotSchema.regions.min(150)`는 경남 305 유지 시 그대로 통과.

- [ ] **Step 1: `extractBusanGyeongnam`을 경남 전용으로 좁히는 테스트 수정**

`tests/scripts/boundary-core.test.ts`에서 부산 포함 기대를 제거하고, `filterGyeongnam`(Task 4) 적용 후 feature가 전부 `adm_cd2` 48 시작임을 단언하는 케이스로 교체한다. (함수명이 `extractBusanGyeongnam`이면 `extractGyeongnam`으로 rename하고 호출부·테스트 동반 수정.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scripts/boundary-core.test.ts`
Expected: FAIL

- [ ] **Step 3: 스크립트 구현**

- `fetch-boundaries.mjs`: 원본 로드 후 `filterGyeongnam`(Task 4 helper) 적용, `extractGyeongnam`로 rename. 산출 featureCount 305 기대.
- `seed-core.mjs`: 부산 관련 sourceNote·좌표 시드 제거, 경남 305 regions 생성.
- `validate-boundaries.mjs`: 기대 featureCount를 305로, 부산 코드 목록 제거.

- [ ] **Step 4: 스크립트 실행하여 데이터 재생성**

Run:
```bash
npm run data:boundaries
npm run data:seed
npm run data:boundaries:validate
```
Expected: validate 통과, `boundary-metadata.json.featureCount == 305`

- [ ] **Step 5: 단위 테스트 통과 확인**

Run: `npx vitest run tests/scripts/`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/ public/data/administrative-dong-20260701.geojson public/data/demo-snapshot.json public/data/place-index.json public/data/boundary-metadata.json tests/scripts/
git commit -m "feat(data): regenerate gyeongnam-only boundaries and demo snapshot"
```

- [ ] **Step 7: 부산 legacy 복사본 정리**

`public/data/busan-administrative-dong-20260701.geojson` 참조를 `copilot-app.tsx:634`(fetch 경로)에서 경남 파일로 교체(Task 8). 파일 자체는 Task 8에서 경로 교체 후 삭제.

---

## Task 7: population/medical 큐브 어댑터

**Files:**
- Create: `src/lib/layers/from-snapshot.ts`
- Create: `src/lib/layers/catalog.ts`
- Test: `tests/layers/from-snapshot.test.ts`

기존 `AnalysisSnapshot`(regions: RegionSeries[], facilities: Facility[])을 두 레이어로 변환. `population` 큐브는 `RegionSeries`의 인구 지표를, `medical`은 시설을 point cell로. `catalog.ts`는 두 `LayerDescriptor`를 정의.

> **선행 독해:** `src/lib/domain/schemas.ts`(RegionSeries 필드), `src/lib/analysis/result.ts`. population 지표 키 후보: `pop_total`(population), `households`, `elderly_ratio`(=elderlyPopulation/population*100, weightedAvg by population), `density`(populationDensity), `natural_change`. medical은 kind=point.

- [ ] **Step 1: Write the failing test**

```ts
// tests/layers/from-snapshot.test.ts
import { describe, expect, it } from "vitest";
import { populationCubeFromSnapshot } from "@/lib/layers/from-snapshot";
import { LayerCubeSchema } from "@/lib/layers/types";
import type { AnalysisSnapshot } from "@/lib/domain/schemas";

const months = Array.from({ length: 13 }, (_, i) => `2025-${String((i % 12) + 1).padStart(2, "0")}`);
const snapshot = {
  mode: "demo",
  referenceMonth: months[12],
  months,
  sourceNotes: ["주민등록"],
  regions: [
    {
      adm_cd2: "4812051000",
      adm_nm: "경상남도 창원시 의창구 동읍",
      representativePoint: { lat: 35.3, lng: 128.6 },
      areaSquareKm: 12,
      months,
      population: months.map(() => 1000),
      households: months.map(() => 400),
      populationDensity: months.map(() => 80),
      youthPopulation: months.map(() => 100),
      workingAgePopulation: months.map(() => 600),
      elderlyPopulation: months.map(() => 300),
      onePersonHouseholds: months.map(() => 120),
      births: months.map(() => 2),
      deaths: months.map(() => 3),
      naturalChange: months.map(() => -1),
    },
  ],
  facilities: [],
} as unknown as AnalysisSnapshot;

describe("populationCubeFromSnapshot", () => {
  it("produces a valid dong cube with pop_total series", () => {
    const cube = populationCubeFromSnapshot(snapshot);
    expect(() => LayerCubeSchema.parse(cube)).not.toThrow();
    expect(cube.layerId).toBe("population");
    expect(cube.cells[0].series.pop_total).toHaveLength(13);
    expect(cube.cells[0].series.pop_total[0]).toBe(1000);
  });

  it("computes elderly_ratio as percentage", () => {
    const cube = populationCubeFromSnapshot(snapshot);
    expect(cube.cells[0].series.elderly_ratio[0]).toBeCloseTo(30, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/layers/from-snapshot.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```ts
// src/lib/layers/from-snapshot.ts
import type { AnalysisSnapshot, RegionSeries } from "@/lib/domain/schemas";
import type { LayerCube } from "@/lib/layers/types";

function ratioSeries(num: number[], den: number[]): (number | null)[] {
  return num.map((n, i) => (den[i] ? (n / den[i]) * 100 : null));
}

export function populationCubeFromSnapshot(snapshot: AnalysisSnapshot): LayerCube {
  return {
    layerId: "population",
    adminLevel: "dong",
    referenceMonth: snapshot.referenceMonth,
    months: snapshot.months,
    cells: snapshot.regions.map((r: RegionSeries) => ({
      code: r.adm_cd2,
      name: r.adm_nm,
      point: r.representativePoint,
      areaKm2: r.areaSquareKm,
      series: {
        pop_total: [...r.population],
        households: [...r.households],
        density: [...r.populationDensity],
        elderly_ratio: ratioSeries([...r.elderlyPopulation], [...r.population]),
        natural_change: [...r.naturalChange],
      },
    })),
  };
}
```

`catalog.ts`:

```ts
// src/lib/layers/catalog.ts
import type { LayerDescriptor } from "@/lib/layers/types";

export const POPULATION_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "population",
  label: "인구",
  provider: "공공",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["주민등록 인구·세대 (시연 스냅샷은 합성)"],
  metrics: [
    { key: "pop_total", label: "총인구", unit: "명", aggregation: "sum", formula: "월별 주민등록 인구", limitation: "외국인 제외", triggers: ["인구", "총인구", "인구수"] },
    { key: "households", label: "세대수", unit: "세대", aggregation: "sum", formula: "월별 세대 수", limitation: "", triggers: ["세대", "가구"] },
    { key: "density", label: "인구밀도", unit: "명/㎢", aggregation: "weightedAvg", weightKey: "pop_total", formula: "인구/면적", limitation: "", triggers: ["밀도", "인구밀도"] },
    { key: "elderly_ratio", label: "고령비율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "고령인구/총인구×100", limitation: "", triggers: ["고령", "고령비율", "노인"] },
    { key: "natural_change", label: "자연증가", unit: "명", aggregation: "sum", formula: "출생−사망", limitation: "전입·전출 미포함", triggers: ["자연증가", "출생", "사망"] },
  ],
};

export const MEDICAL_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "medical",
  label: "의료",
  provider: "공공",
  kind: "point",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["HIRA 병원정보서비스 (경남 sido 380000)"],
  metrics: [
    { key: "vulnerability", label: "의료취약지수", unit: "점", aggregation: "weightedAvg", weightKey: "pop_total", formula: "공급35%+고령수요25%+최근접25%+2km무시설15%", limitation: "병원급 중심", triggers: ["의료취약", "취약지", "병원부족"] },
  ],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/layers/from-snapshot.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/layers/from-snapshot.ts src/lib/layers/catalog.ts tests/layers/from-snapshot.test.ts
git commit -m "feat(layers): population/medical cube adapters and catalog"
```

---

## Task 8: UI — 부산 칩 제거 + 큐브 소비 + 단위 토글 상태

**Files:**
- Modify: `src/components/copilot/copilot-app.tsx`
- Create: `src/components/copilot/admin-level-toggle.tsx`
- Modify: `tests/e2e/copilot.spec.ts`(부산 칩 시나리오 제거), `tests/analysis/share-state.test.ts`(sido 쿼리 제거 시)

> **선행 독해 (필수):** `copilot-app.tsx` 전체 흐름 중 최소 다음 구간 — L38-46(scope import), L78(SIDO_SCOPE_KEY), L144-239(quickIntent/executeQuickAnalysis), L351-388(state), L460-470(localStorage 복원), L537-553(단축키 1/2/3), L630-640(boundary fetch), L685-695(share 복원), L750-780. `src/lib/analysis/share-state.ts`도 읽어 `sido` 쿼리 처리 확인.

Phase 1 UI 목표(최소): ①부산/전체/경남 시도 칩과 단축키 1/2/3, `SIDO_SCOPE_KEY` localStorage, share의 `sido` 제거 ②boundary fetch 경로를 경남 파일로 ③`adminLevel` 상태(`"dong"|"sgg"`)와 `AdminLevelToggle` 컴포넌트 추가(집계는 `aggregateToSgg` 호출로 지도/랭킹에 반영). 레이어 스위처 UI는 Phase 2.

- [ ] **Step 1: AdminLevelToggle 컴포넌트 테스트 작성**

```tsx
// tests/components/admin-level-toggle.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminLevelToggle } from "@/components/copilot/admin-level-toggle";

describe("AdminLevelToggle", () => {
  it("renders both levels and fires onChange", () => {
    const onChange = vi.fn();
    render(<AdminLevelToggle value="dong" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "시군구" }));
    expect(onChange).toHaveBeenCalledWith("sgg");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/components/admin-level-toggle.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 컴포넌트 구현**

```tsx
// src/components/copilot/admin-level-toggle.tsx
import type { AdminLevel } from "@/lib/layers/types";

const LABELS: Record<AdminLevel, string> = { dong: "읍면동", sgg: "시군구" };

export function AdminLevelToggle({
  value,
  onChange,
}: {
  value: AdminLevel;
  onChange: (level: AdminLevel) => void;
}) {
  return (
    <div role="group" aria-label="분석 단위" className="admin-level-toggle">
      {(["sgg", "dong"] as AdminLevel[]).map((level) => (
        <button
          key={level}
          type="button"
          aria-pressed={value === level}
          onClick={() => onChange(level)}
        >
          {LABELS[level]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/components/admin-level-toggle.test.tsx`
Expected: PASS

- [ ] **Step 5: copilot-app.tsx에서 부산 제거 + 토글 배선**

선행 독해에서 파악한 각 구간을 수정:
- `sidoScope` state/`setSidoScope`, `SIDO_SCOPE_KEY`, `applySidoScopeToRegions`/`filterBySidoScope`/`matchesSidoScope`/`sidoBadge`/`SidoScope`/`SIDO_SCOPE_LABEL` import 및 사용 제거. `executeQuickAnalysis`/`quickIntent`의 `sidoScope` 인자 삭제.
- 단축키 1/2/3 핸들러(L537-553) 제거.
- boundary fetch(L634)를 `/data/administrative-dong-${boundaryVersion}.geojson`로 교체.
- share 복원(L690)의 `share.sido` 분기 제거(+ `share-state.ts`에서 `sido` 키 삭제).
- `const [adminLevel, setAdminLevel] = useState<AdminLevel>("dong")` 추가, `<AdminLevelToggle value={adminLevel} onChange={setAdminLevel} />` 렌더, 지도/랭킹 파생값을 `adminLevel==="sgg" ? aggregateToSgg(cube, metrics) : cube` 기준으로 계산.

- [ ] **Step 6: 타입체크·단위·e2e 조정 후 통과 확인**

Run: `npx tsc --noEmit && npx vitest run tests/analysis/share-state.test.ts`
Expected: PASS (컴파일 에러 0)

- [ ] **Step 7: 부산 legacy geojson 삭제**

```bash
git rm public/data/busan-administrative-dong-20260701.geojson
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): remove busan scope chips, add admin-level toggle"
```

---

## Task 9: HIRA/live-sync 경남 전용화

**Files:**
- Modify: `src/lib/data/hira-hospitals.ts`, `src/lib/data/live-sync.ts`
- Modify: `tests/data/hira-hospitals.test.ts`, `tests/data/live-sync.test.ts`

> **선행 독해:** 두 소스 파일과 두 테스트. sido 코드 상수(`210000` 부산 / `380000` 경남)와 인구 ctpv(`26` 부산 / `48` 경남) 사용처.

- [ ] **Step 1: 테스트에서 부산 sido 기대 제거**

`tests/data/hira-hospitals.test.ts`·`tests/data/live-sync.test.ts`에서 `210000`/`26` 관련 케이스를 삭제하고, sido 목록이 `["380000"]`, ctpv가 `["48"]`임을 단언하도록 수정.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/data/hira-hospitals.test.ts tests/data/live-sync.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`hira-hospitals.ts`의 sido 목록 상수를 `['380000']`로, `live-sync.ts`의 인구 ctpv를 `['48']`로 좁힌다. 부산 분기 제거.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/data/hira-hospitals.test.ts tests/data/live-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/data/hira-hospitals.ts src/lib/data/live-sync.ts tests/data/
git commit -m "feat(data): restrict HIRA and population sync to gyeongnam"
```

---

## Task 10: health scope 메타 + 전체 검증 게이트

**Files:**
- Modify: `src/app/api/health/route.ts`(scope.regions를 경남만), `tests/api/health-route.test.ts`
- Modify: `README.md`, `docs/AI_HANDOFF_STATUS.md`(경남 전환 반영)

- [ ] **Step 1: health scope 테스트 수정**

`tests/api/health-route.test.ts`에서 `scope.regions`가 `["경상남도"]`(부산 없음), `hiraSidoCd`가 `["380000"]`, `populationCtpv`가 `["48"]`임을 단언.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/health-route.test.ts`
Expected: FAIL

- [ ] **Step 3: health route·문서 수정**

`health/route.ts`의 scope 응답에서 부산 제거. README·핸드오프의 "부산+경남 511" → "경남 305" 표기 갱신.

- [ ] **Step 4: 전체 검증 게이트**

Run:
```bash
npm test
npx tsc --noEmit
npm run data:boundaries:validate
npm run build
```
Expected: 전 스위트 PASS, 타입 0 에러, validate 통과, build 성공

- [ ] **Step 5: 린트 정리(이번에 손댄 파일 한정)**

Run: `npx eslint src/lib/layers src/lib/analysis/scope.ts src/components/copilot/admin-level-toggle.tsx`
Expected: 0 errors (prefer-const 등은 수정)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: gyeongnam scope in health, docs; phase-1 verification green"
```

- [ ] **Step 7: 배포 검증 (Vercel MCP 또는 CLI)**

푸시 후 프로덕션 smoke — `npm run smoke`. 실패 시 20–30초 후 재시도(기존 함정). **배포 URL 기준으로 완료 선언**(로컬만으로 금지).

---

## Self-Review Notes

- **Spec 커버리지**: §1 데이터모델→Task 1·2·7 / §2 ETL 경계→Task 4·6 / §3 intent 슬롯→Task 3(NL 라우팅 규칙 본체는 Phase 2) / §4 UI 부산제거·단위토글→Task 8(레이어 스위처는 Phase 2) / §5 마이그레이션→Task 5·6·8·9 / §6 검증→Task 10 / §7 Phase 1 = 본 계획.
- **Phase 2로 미룬 항목(의도적)**: SKT 어댑터, 레이어 스위처 UI, NL 레이어·단위 자동 라우팅, tool-registry 제네릭 큐브 툴, 시군구 폴리곤 렌더. 이는 spec §7 단계 구분과 일치.
- **타입 일관성**: `AdminLevel`은 `types.ts`에서 단일 정의, Task 3·5·8이 재사용. `aggregateToSgg(cube, metrics)` 시그니처는 Task 2 정의를 Task 8이 그대로 호출. `sggCodeOf`(scope) 와 `aggregate.ts`의 내부 `sggCode`는 동일 규칙(앞 5자리) — 중복이지만 레이어 경계상 허용, Phase 2에서 통합 고려.
- **미해결 위험**: Task 6·8은 대형 기존 파일 독해 후 구현이 전제. 각 태스크 선행 독해 지시 준수 필수.
