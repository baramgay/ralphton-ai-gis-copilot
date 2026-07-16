# AI GIS Copilot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 외부 키가 없어도 부산 206개 행정동의 의료·인구 접근성 분석을 완전히 시연하고, 키가 있으면 검증된 서버 어댑터로 실데이터와 AI를 연결하는 Next.js 앱을 완성한다.

**Architecture:** 검증·생성 가능한 정적 경계와 데모 스냅샷을 기준선으로 두고, 순수 TypeScript Tool Registry가 모든 GIS·지표 계산을 수행한다. 단일 클라이언트 reducer가 자연어/빠른 분석/지도 선택을 하나의 결과로 동기화하며 Kakao 지도와 SVG 데모 지도는 동일한 view model을 렌더링한다. 외부 API, Supabase service-role, AI는 Route Handler의 지연 초기화 서버 모듈에서만 접근한다.

**Tech Stack:** Next.js 16.2.10 App Router, React 19.2.7, TypeScript 5.9 strict, Tailwind CSS 4, shadcn/ui 패턴, Turf.js 7.3.5, Zod 4.4.3, Supabase JS 2.110.6, Vitest 4, Testing Library, Playwright 1.61, PowerShell.

## Global Constraints

- Node.js 20.9 이상, npm lockfile을 커밋하고 설치된 패키지 버전을 고정한다.
- 실제 키·JWT·서비스키는 코드, 문서, Git, 로그, 오류, 클라이언트 정적 산출물에 넣지 않는다.
- `.env.example`에는 명세의 변수명과 `QWEN_PRIMARY_MODEL=qwen3.7-max`, `QWEN_JSON_FALLBACK_MODEL=qwen3.7-plus`만 둔다.
- `KAKAO_REST_API_KEY`, `DATA_GO_KR_SERVICE_KEY`, `QWEN_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`는 `server-only` 모듈에서만 읽는다.
- 외부 키·SDK·네트워크가 없어도 모든 빠른 분석, 자연어 예시, 지도 선택, 상세 카드가 동작한다.
- 행정동 결합 키는 `adm_cd2`, 좌표는 GeoJSON `[lng, lat]`, Kakao 생성자는 `(lat, lng)`다.
- 모든 새 도메인 함수는 테스트가 먼저 실패한 뒤 구현한다.
- 사용자 UI에 AI 제공사, 모델명, 키, 내부 프롬프트를 표시하지 않는다.

---

### Task 1: 보안 기반과 프로젝트 스캐폴드

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `components.json`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Create: `src/app/api/health/route.ts`
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/badge.tsx`
- Create: `src/lib/utils.ts`
- Test: `tests/security/environment.test.ts`

**Interfaces:**
- Consumes: 기존 `data/source/*.geojson`, `public/data/*.geojson`를 그대로 보존한다.
- Produces: `npm run test`, `typecheck`, `lint`, `build`, `verify` 명령과 `cn(...classes)` UI helper, `/api/health` 200 JSON.

- [ ] **Step 1: 비밀 파일을 먼저 제외한다**

`.gitignore`에 `.env*`, `!.env.example`, `.next`, `node_modules`, `logs`, Playwright 결과, 원본 마스터 프롬프트의 정확한 파일명을 넣는다. Git 초기화 전에 `git check-ignore`로 원문이 제외되는지 확인한다.

- [ ] **Step 2: 환경 계약의 실패 테스트를 작성한다**

```ts
expect(exampleKeys.sort()).toEqual([
  'DATA_GO_KR_SERVICE_KEY', 'KAKAO_REST_API_KEY',
  'NEXT_PUBLIC_KAKAO_MAP_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SUPABASE_URL', 'QWEN_API_KEY', 'QWEN_BASE_URL',
  'QWEN_JSON_FALLBACK_MODEL', 'QWEN_PRIMARY_MODEL',
  'SUPABASE_SERVICE_ROLE_KEY',
].sort())
expect(secretLikeValueFound).toBe(false)
```

- [ ] **Step 3: RED를 확인한다**

Run: `npm test -- tests/security/environment.test.ts`
Expected: FAIL because package/test configuration or `.env.example` is absent.

- [ ] **Step 4: 스캐폴드와 shadcn 기반 primitive를 구현한다**

`package.json`은 `ralphton-ai-gis-copilot`이라는 ASCII 이름과 명시 버전, Node engines, 모든 필수 script를 가진다. `layout.tsx`는 `lang="ko"`, 시스템 글꼴, 한국어 metadata를 사용한다. `next.config.ts`는 production source map을 끄고 보안 헤더를 설정한다.

- [ ] **Step 5: GREEN과 초기 빌드를 확인한다**

Run: `npm install && npm test -- tests/security/environment.test.ts && npm run typecheck && npm run lint && npm run build`
Expected: 모든 명령 exit 0; `/api/health`가 빌드 route 목록에 포함된다.

- [ ] **Step 6: 안전하게 Git을 초기화한다**

Run: `git init && git add . && git status --short`
Expected: 마스터 프롬프트와 `.env.local`은 staging 목록에 없다.

### Task 2: 행정동 경계 다운로드·추출·검증

**Files:**
- Create: `scripts/lib/boundary-core.mjs`
- Create: `scripts/fetch-boundaries.mjs`
- Create: `scripts/validate-boundaries.mjs`
- Create: `public/data/boundary-metadata.json`
- Test: `tests/scripts/boundary-core.test.ts`

**Interfaces:**
- Consumes: GitHub contents API entries `{type,name,download_url,url}`와 GeoJSON 문자열.
- Produces: `discoverLatestVersion(entries): string`, `validateBoundaryCollection(fc): ValidationSummary`, `extractBusan(fc): FeatureCollection`, `buildBoundaryMetadata(bytes, context): BoundaryMetadata`.

- [ ] **Step 1: 버전 선택·부산 필터·실패 조건 테스트를 작성한다**

```ts
expect(discoverLatestVersion([{type:'dir',name:'ver20260401'}, {type:'dir',name:'ver20260701'}])).toBe('20260701')
expect(() => validateBoundaryCollection(invalidDuplicateFixture)).toThrow(/중복/)
expect(extractBusan(fixture).features.every(f => f.properties.adm_nm.startsWith('부산광역시'))).toBe(true)
```

- [ ] **Step 2: RED를 확인한다**

Run: `npm test -- tests/scripts/boundary-core.test.ts`
Expected: FAIL because `scripts/lib/boundary-core.mjs` is absent.

- [ ] **Step 3: 순수 검증 로직을 구현한다**

FeatureCollection, CRS84/EPSG:4326, 150개 이상, 필수 문자열 속성, 8/10자리 코드, 중복, geometry type, 빈 좌표, 부산 좌표 범위, 닫힌 ring, Turf `booleanValid`를 검사한다.

- [ ] **Step 4: 네트워크·원자적 파일 쓰기를 구현한다**

GitHub API는 명시 User-Agent, 20초 timeout, status 검사를 사용한다. 임시 파일에 쓴 뒤 rename하고 메타데이터에는 최종 부산 파일의 SHA-256, UTC timestamp, URL, 버전, 206개 코드 목록을 기록한다.

- [ ] **Step 5: GREEN과 실제 경계를 검증한다**

Run: `npm test -- tests/scripts/boundary-core.test.ts && npm run data:boundaries && npm run data:boundaries:validate`
Expected: 최신 버전 부산 Feature 150개 이상, SHA 일치, exit 0.

### Task 3: 결정론적 부산 데모 데이터와 기간 집계

**Files:**
- Create: `scripts/lib/seed-core.mjs`
- Create: `scripts/seed-demo-data.mjs`
- Create: `public/data/demo-snapshot.json`
- Create: `public/data/demo-metadata.json`
- Create: `src/lib/domain/schemas.ts`
- Create: `src/lib/domain/periods.ts`
- Create: `src/lib/domain/aggregation.ts`
- Test: `tests/scripts/seed-core.test.ts`
- Test: `tests/domain/periods.test.ts`
- Test: `tests/domain/aggregation.test.ts`

**Interfaces:**
- Produces: Zod schemas/types `RegionSeries`, `RegionMetric`, `Facility`, `DemoSnapshot`; `selectLatestCommonMonth`, `aggregateTongBanRows`, `calculateNaturalChange`.
- Snapshot: `{mode:'demo', referenceMonth, months[13], regions[206], facilities, sourceNotes}`.

- [ ] **Step 1: 기간·중복 집계·결정론 테스트를 작성한다**

```ts
expect(selectLatestCommonMonth([['2026-05','2026-06'], ['2026-04','2026-05']])).toBe('2026-05')
expect(aggregateTongBanRows([rowA, rowA, rowB]).population).toBe(rowA.population + rowB.population)
expect(seedSnapshot(boundary, 20260701)).toEqual(seedSnapshot(boundary, 20260701))
```

- [ ] **Step 2: RED를 확인하고 최소 구현을 추가한다**

Run: `npm test -- tests/scripts/seed-core.test.ts tests/domain/periods.test.ts tests/domain/aggregation.test.ts`
Expected: missing module failures first, then assertions pass after implementation.

- [ ] **Step 3: 부산 전역 샘플을 생성한다**

각 Feature의 `pointOnFeature` 내부 좌표, 면적, 해시 기반 PRNG를 사용한다. 13개월 인구·세대·연령·1인가구·출생·사망을 만들고 시설을 행정동 내부에 배치한다. 시설 종류는 종합병원/병원/요양병원/의원/치과의원/한의원/보건소/약국을 포함하며 진료과와 운영시간 필드의 일부는 의도적으로 null로 둔다.

- [ ] **Step 4: 생성물 스키마와 체크섬을 검증한다**

Run: `npm run data:seed && npm run data:seed && npm test -- tests/scripts/seed-core.test.ts`
Expected: 두 실행의 `demo-metadata.json.sha256`이 동일하고 206개 지역이 모두 유효하다.

### Task 4: GIS 지표와 Tool Registry

**Files:**
- Create: `src/lib/gis/coordinates.ts`
- Create: `src/lib/gis/metrics.ts`
- Create: `src/lib/analysis/tool-registry.ts`
- Create: `src/lib/analysis/result.ts`
- Test: `tests/gis/coordinates.test.ts`
- Test: `tests/gis/metrics.test.ts`
- Test: `tests/analysis/tool-registry.test.ts`

**Interfaces:**
- Produces: `geoJsonToKakaoPath`, `nearestFacilityDistance`, `countFacilitiesWithinRadius`, 10개 명명 도구, `executeAnalysisIntent(intent, snapshot)`.
- Tool output: `{title, summary, rankedRegions, selectedRegion, filteredFacilities, legend, formulaNotes}`.

- [ ] **Step 1: 좌표·거리·반경·점수의 실패 테스트를 작성한다**

```ts
expect(geoJsonToKakaoPath([129.0756, 35.1796])).toEqual({lat:35.1796,lng:129.0756})
expect(nearestFacilityDistance(origin, [oneKilometerAway])).toBeCloseTo(1, 1)
expect(countFacilitiesWithinRadius(origin, facilities, 2)).toBe(2)
expect(medicalVulnerabilityIndex(input)).toBeGreaterThanOrEqual(0)
expect(medicalVulnerabilityIndex(input)).toBeLessThanOrEqual(100)
```

- [ ] **Step 2: RED 후 Turf 기반 구현으로 GREEN을 만든다**

Run: `npm test -- tests/gis tests/analysis/tool-registry.test.ts`
Expected: 10개 registry key, 의료/인구 지표, 동률 정렬, 빈 시설 처리 모두 pass.

- [ ] **Step 3: 수식 메타데이터를 결과에 포함한다**

모든 metric descriptor는 `label`, `value`, `unit`, `formula`, `referenceMonth`, `limitation`을 필수로 가진다. null은 0으로 바꾸지 않고 “데이터 없음”으로 렌더링할 수 있게 유지한다.

### Task 5: 안전한 자연어 파서와 AI Route Handler

**Files:**
- Create: `src/lib/analysis/intent-schema.ts`
- Create: `src/lib/analysis/query-rules.ts`
- Create: `src/lib/ai/qwen.ts`
- Create: `src/lib/ai/parse-intent.ts`
- Create: `src/app/api/ai/parse/route.ts`
- Test: `tests/analysis/query-rules.test.ts`
- Test: `tests/api/ai-parse.test.ts`

**Interfaces:**
- Produces: strict Zod `AnalysisIntentSchema`, `parseIntentWithRules(query)`, `parseIntentWithFallbacks(query,deps)`.
- Route response: `{intent, mode:'live'|'demo', notice?:string}`; never returns provider/model/prompt/key.

- [ ] **Step 1: 8개 필수 질의와 공격 입력 테스트를 먼저 작성한다**

병원, 고령, 인구증가, 기장군-강서구, 2km, 종합병원, 야간, 약국을 각각 기대 tool/filters로 assertion한다. `tool:'shell'`, `sql`, unknown keys, 50km radius, 1,000자 초과 입력을 거부하는 테스트도 추가한다.

- [ ] **Step 2: RED를 확인한다**

Run: `npm test -- tests/analysis/query-rules.test.ts tests/api/ai-parse.test.ts`
Expected: missing parser/route failures.

- [ ] **Step 3: 규칙 파서와 Qwen 호출 순서를 구현한다**

서버 fetch는 `${validatedBaseUrl}/chat/completions`, Bearer header, 12초 timeout, `response_format:{type:'json_object'}`, `enable_thinking:false`를 사용한다. 호출 순서는 primary → primary retry → fallback이며 각 출력은 JSON.parse 후 strict Zod로 검증한다. 키 없음/모든 실패는 규칙 파서다.

- [ ] **Step 4: GREEN과 비밀 비노출을 확인한다**

Run: `npm test -- tests/analysis/query-rules.test.ts tests/api/ai-parse.test.ts`
Expected: 호출 순서·fallback·금지 필드·응답 문자열 검사 모두 pass.

### Task 6: 공공데이터 정규화와 Supabase 선택적 캐시

**Files:**
- Create: `src/lib/data/public-api.ts`
- Create: `src/lib/data/normalize-public-data.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/public.ts`
- Create: `src/app/api/data/snapshot/route.ts`
- Create: `supabase/migrations/202607160001_ai_gis_snapshot.sql`
- Test: `tests/data/normalize-public-data.test.ts`
- Test: `tests/security/server-boundaries.test.ts`

**Interfaces:**
- Produces: provider response → `DemoSnapshot` 호환 정규화, lazy `getServiceSupabaseClient()`, public read client, `/api/data/snapshot?mode=auto`.

- [ ] **Step 1: pagination·월 불일치·중복·결측 열 테스트를 작성한다**

실제 비밀을 사용하지 않는 fixture로 최신 공통월, 통·반 중복 제거, 약국 분리, 결측 진료과/시간 null 보존을 검증한다.

- [ ] **Step 2: RED 후 timeout·schema validation이 있는 어댑터를 구현한다**

서버 전용 모듈만 비공개 env를 읽고 client import graph에는 포함되지 않아야 한다. 실데이터 계약이 불완전하거나 키가 없으면 검증된 정적 snapshot을 반환한다.

- [ ] **Step 3: RLS migration을 구현한다**

세 테이블, 최소 GRANT, RLS, 공개된 스냅샷에 대한 SELECT 정책만 정의한다. `SECURITY DEFINER` 함수는 만들지 않는다.

- [ ] **Step 4: 검증한다**

Run: `npm test -- tests/data tests/security/server-boundaries.test.ts && npm run typecheck`
Expected: server/client 경계와 fallback 테스트 pass.

### Task 7: 분석 상태·빠른 분석·상세 UI

**Files:**
- Create: `src/components/copilot/copilot-app.tsx`
- Create: `src/components/copilot/analysis-reducer.ts`
- Create: `src/components/copilot/analysis-panel.tsx`
- Create: `src/components/copilot/query-form.tsx`
- Create: `src/components/copilot/quick-actions.tsx`
- Create: `src/components/copilot/result-summary.tsx`
- Create: `src/components/copilot/region-ranking.tsx`
- Create: `src/components/copilot/region-details.tsx`
- Create: `src/components/ui/tabs.tsx`
- Create: `src/components/ui/accordion.tsx`
- Test: `tests/components/quick-actions.test.tsx`
- Test: `tests/components/analysis-panel.test.tsx`

**Interfaces:**
- Consumes: snapshot, boundaries, `executeAnalysisIntent`.
- Produces: `AnalysisState`/actions `RUN_PRESET`, `RUN_INTENT`, `SELECT_REGION`, `SELECT_FACILITY`, `RESET`; `MapViewModel`.

- [ ] **Step 1: 8개 버튼·동기화·metric 카드 실패 테스트를 작성한다**

```tsx
await user.click(screen.getByRole('button', {name:'의료 취약 지역'}))
expect(button).toHaveAttribute('aria-pressed','true')
expect(screen.getByTestId('analysis-title')).toHaveTextContent('의료 취약 지역')
expect(screen.getAllByText('기준월').length).toBeGreaterThan(0)
```

- [ ] **Step 2: RED 후 reducer와 컴포넌트를 구현한다**

pointer-down에서 즉시 `data-pressing` 상태를 켜고 click/keyboard에서 분석을 commit한다. 모바일 chips는 overflow-x auto, 모든 타깃은 44px 이상이다.

- [ ] **Step 3: 상세 산식·데모·결측 상태를 구현한다**

카드는 산식·단위·기준월·한계를 모두 렌더링한다. 약국은 명시 필터에만 들어가며 null 데이터는 “데이터 없음”이다.

- [ ] **Step 4: GREEN을 확인한다**

Run: `npm test -- tests/components/quick-actions.test.tsx tests/components/analysis-panel.test.tsx`
Expected: 8 presets, reset, Enter/Space, aria state, summary/ranking/details synchronization pass.

### Task 8: Kakao 지도와 SVG 데모 지도

**Files:**
- Create: `src/components/map/map-shell.tsx`
- Create: `src/components/map/kakao-sdk.ts`
- Create: `src/components/map/kakao-map.tsx`
- Create: `src/components/map/demo-geo-map.tsx`
- Create: `src/components/map/map-legend.tsx`
- Create: `src/types/kakao.maps.d.ts`
- Test: `tests/map/kakao-sdk.test.ts`
- Test: `tests/map/demo-map.test.tsx`
- Test: `tests/components/map-sync.test.tsx`

**Interfaces:**
- Consumes: `MapViewModel`, GeoJSON, selection callbacks.
- Produces: load-once `loadKakaoSdk(key)`, accessible fallback `<svg>`, polygon/facility click events.

- [ ] **Step 1: SDK URL·load once·좌표 순서·fallback 테스트를 작성한다**

```ts
expect(buildSdkUrl('public-key')).toContain('libraries=services%2Cclusterer%2Cdrawing')
expect(loadKakaoSdk('key')).toBe(loadKakaoSdk('key'))
expect(toKakaoLatLngArgs([129,35])).toEqual([35,129])
```

- [ ] **Step 2: RED 후 SDK adapter를 구현한다**

script는 `autoload=false`, nonce 지원, 하나의 cached Promise, timeout을 사용한다. 실패/키 없음은 error throw 대신 shell이 DemoMap을 선택하게 한다.

- [ ] **Step 3: 실제 GeoJSON SVG 투영을 구현한다**

부산 bbox를 viewBox로 선형 투영하고 even-odd path로 MultiPolygon을 그린다. 단계구분 색, 시설 점, 선택 outline, 1/2/3km 근사 원, 범례, 각 행정동의 접근 가능한 `<title>`을 포함한다.

- [ ] **Step 4: 양방향 동기화를 검증한다**

Run: `npm test -- tests/map tests/components/map-sync.test.tsx`
Expected: polygon click가 상세를 변경하고 목록 선택이 SVG/Kakao overlay 선택을 변경한다.

### Task 9: 이용방법·데이터 정보·모바일 Bottom Sheet·접근성

**Files:**
- Create: `src/components/copilot/help-panel.tsx`
- Create: `src/components/copilot/data-info-panel.tsx`
- Create: `src/components/copilot/mobile-sheet.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/copilot/copilot-app.tsx`
- Test: `tests/components/tabs-help.test.tsx`
- Test: `tests/components/mobile-sheet.test.tsx`
- Test: `tests/accessibility/app-a11y.test.tsx`

**Interfaces:**
- Produces: WAI-ARIA tabs, accordion, executable examples, pointer-driven sheet with keyboard fallback.

- [ ] **Step 1: tabs·accordion·질문 실행·접근성 실패 테스트를 작성한다**

ArrowLeft/Right, Home/End, Tab panel focus, 클릭 가능한 예시, 자연증가/직선거리/기준월/시설분류 문구, reduced-motion class 동작을 assertion한다.

- [ ] **Step 2: RED 후 패널과 시트를 구현한다**

시트는 Pointer Events와 capture로 1:1 이동하고 release velocity로 세 snap point를 선택한다. reduced-motion에서는 transform animation 없이 opacity/state만 바꾼다.

- [ ] **Step 3: Apple 수준 토큰을 마무리한다**

시스템 폰트, restrained blue, 한 계층 glass, 불투명 본문 카드, 가시적 focus ring, contrast/reduced-transparency media query, `:active` 100ms scale을 적용한다.

- [ ] **Step 4: GREEN을 확인한다**

Run: `npm test -- tests/components/tabs-help.test.tsx tests/components/mobile-sheet.test.tsx tests/accessibility/app-a11y.test.tsx`
Expected: keyboard, ARIA, help execution, media preference tests pass.

### Task 10: Windows 원클릭 실행과 안전한 종료

**Files:**
- Create: `실행하기.ps1`
- Create: `실행하기.cmd`
- Create: `실행하기-개발모드.cmd`
- Create: `종료하기.ps1`
- Create: `종료하기.cmd`
- Create: `scripts/verify-windows.ps1`
- Test: `tests/windows/launcher.contract.test.ts`

**Interfaces:**
- Produces: `logs/app.pid`, `logs/app.port`, `logs/app.log`; health-check 기반 start/stop contract.

- [ ] **Step 1: 정적 계약과 helper 실패 테스트를 작성한다**

Node 검사, `npm ci/install`, env copy, build, 3000~3099, health timeout, Chrome/default browser, PID command-line 확인, own-process-only 종료 문자열을 검사한다.

- [ ] **Step 2: RED 후 PowerShell 실행기를 구현한다**

경로는 `$PSScriptRoot`와 `-LiteralPath`만 사용한다. 숨김 창으로 `npm.cmd start -- -p $port`를 시작하고 stdout/stderr를 로그로 redirect한다. 브라우저 실행은 `-NoBrowser` 테스트 옵션으로 끌 수 있다.

- [ ] **Step 3: 종료기와 CMD wrapper를 구현한다**

PID가 살아 있고 command line에 이 프로젝트의 절대 경로와 Next start가 모두 있을 때만 프로세스 트리를 종료한다. 일치하지 않으면 PID 파일만 삭제하지 말고 오류로 종료한다.

- [ ] **Step 4: 실제 process smoke를 검증한다**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-windows.ps1`
Expected: 첫 실행, 중복 차단, 점유 포트 건너뛰기, browserless 시작, 다른 Node 보존, 앱 종료 모두 pass.

### Task 11: 통합 verifier와 브라우저 E2E

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/copilot.spec.ts`
- Create: `tests/e2e/mobile.spec.ts`
- Create: `scripts/verify.mjs`
- Create: `README.md`

**Interfaces:**
- Produces: `npm run verify`가 데이터, unit/component/API, typecheck, lint, build, E2E, security scan을 순서대로 실행하고 실패 시 non-zero를 반환한다.

- [ ] **Step 1: 사용자 여정 E2E를 먼저 작성한다**

8개 빠른 분석, 필수 8질의, polygon click, metric 전환, 1/2/3km, tabs, 모바일 sheet, 키 없는 DemoMap, console error 0을 검증한다.

- [ ] **Step 2: RED를 확인한다**

Run: `npx playwright test`
Expected: 아직 누락된 통합 selector/동작에서 FAIL; 실패 이유를 기록한다.

- [ ] **Step 3: 누락된 연결만 구현해 GREEN을 만든다**

페이지가 snapshot과 boundaries를 로드해 `CopilotApp`에 전달하고, stable `data-testid`는 사용자 의미가 있는 통합 경계에만 둔다. README에는 비밀값 없이 설치, 데모 실행, 데이터 갱신, 선택적 외부 설정, 산식·한계를 기록한다.

- [ ] **Step 4: 전체 검증을 새로 실행한다**

Run: `npm run data:boundaries && npm run data:seed && npm run typecheck && npm run lint && npm run build && npm run verify`
Expected: 모든 명령 exit 0, 테스트 실패 0, console error 0.

- [ ] **Step 5: 보안·요구사항 완전성 감사를 실행한다**

마스터 프롬프트를 제외한 source, `.next/static`, README, logs, Git tracked files에서 JWT/API-key 형태와 제공사·모델 UI 문자열을 검색한다. 설계 명세의 완료 기준과 요구사항 행렬을 하나씩 실제 파일·테스트·브라우저 증거에 연결하고 누락이 있으면 수정 후 Step 4 전체를 다시 실행한다.

## Plan self-review

- 명세의 보안, 경계, 데이터·기간, 시설 해석, AI, 10개 도구, 지도, 8개 빠른 분석, Apple UI, 탭, Windows 실행, 모든 검증 명령은 각각 Task 1~11에 배정됐다.
- `adm_cd2`, 연령 구간, 대표점, 거리, 취약지수 가중치, 공통월, 13개월 입력, 1인가구 결측, Supabase 역할, 메타데이터 해시 대상, Windows 포트·timeout·PID 위치를 명시해 모호성을 제거했다.
- 실제 자격증명이나 원문에 있는 값은 이 계획에 포함하지 않았다.
- 구현 중 발견되는 결함은 재현 테스트를 먼저 추가한 뒤 수정한다.
