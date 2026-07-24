# AI 인수인계 · 작업 진행 상태

> **목적:** 이후 AI/개발자가 컨텍스트 없이 이어서 작업할 수 있도록 상태·결정·미완·함정을 한곳에 둔다.  
> **최종 갱신:** 2026-07-17  
> **작성 세션:** Grok / 사용자 지시로 부산 AI GIS Copilot(랄프톤) 고도화 연속 작업

---

## 0. 30초 요약

| 항목 | 값 |
|------|-----|
| **프로젝트 경로** | `C:\업무\랄프톤` |
| **GitHub** | `https://github.com/baramgay/ralphton-ai-gis-copilot` · branch `main` |
| **프로덕션** | `https://ralphton-ai-gis-copilot.vercel.app` |
| **HEAD (작업 시점)** | `9597eb0` — `main` = `origin/main` (clean) |
| **스택** | Next.js 16 App Router · React 19 · Turf · Vitest · Playwright · Vercel |
| **분석 범위** | **경상남도** 행정동 **305개** · 22 시군구 |
| **기본 데이터** | 시연(demo) 스냅샷 합성 · 실데이터(live)는 sync 후 Supabase 게시 |
| **병원 live 원천** | HIRA `hospInfoServicev2/getHospBasisList` XML · sido `380000` |
| **현재 프로덕션 live** | **미게시** (`publishedLive.available: false`, sync 권장) |
| **검증 기준선** | `npm test` ~350+ · `npm run smoke` 9/9 · typecheck/build 통과 이력 있음 |

---

## 1. 제품이 하는 일

- 경남 행정동 단위 **의료·인구 접근성** 탐색 웹앱
- **3패널:** 분석(질의·빠른분석) | 지도(Kakao 또는 DemoMap) | 결과(순위·해석·상세)
- **키 없음:** 데모 스냅샷 + SVG DemoMap으로 전체 플로우 가능
- **키 있음:** Kakao 지도/장소, Qwen 의도 파서, HIRA 시설 sync, 주민인구 live 병합, Supabase 캐시

---

## 2. 아키텍처 맵 (작업 시 진입점)

```
src/app/page.tsx
  └── CopilotApp (src/components/copilot/copilot-app.tsx)  ← UI 중심, 큰 파일
        ├── MapCanvas → KakaoMap | DemoMap
        ├── tool-registry 분석 실행
        └── /api/ai/parse, snapshot, health, kakao/*, rag/search

src/lib/analysis/     의도·규칙·툴·해석·범위·공유·평가자가이드
src/lib/data/         HIRA·live-sync·인구·sync-status·공공 API
src/lib/rag/          corpus·hybrid retrieve·embed-cache
src/lib/geo/          place-index (public/data/place-index.json)
public/data/          경계 geojson, demo-snapshot, place-index, metadata
scripts/              boundaries fetch/validate, seed, smoke, sync-live
```

### 핵심 데이터 파일

| 파일 | 역할 | 규모(시점) |
|------|------|------------|
| `public/data/administrative-dong-20260701.geojson` | 경남 경계 | 305 features |
| `public/data/demo-snapshot.json` | 시연 분석 스냅샷 | 305 regions |
| `public/data/place-index.json` | NL 동 지명 사전 | 305 places |
| `public/data/boundary-metadata.json` | 버전·SHA·코드 목록 | ver `20260701` |

### 경계 원천

- GitHub `vuski/admdongkor` → `scripts/fetch-boundaries.mjs` → `extractGyeongnam`
- 로컬 원본: `data/source/HangJeongDong_ver20260701.geojson`

---

## 3. 세션에서 완료한 작업 타임라인 (커밋 기준, 최신→과거)

| 커밋 | 내용 |
|------|------|
| `9597eb0` | **health 경량화** — env 플래그만 반환, Vercel API 500 완화 |
| `ed6c04f` | `process.cwd()`에 `turbopackIgnore` 주석 (NFT 경고 완화 시도) |
| `6a0cc6d` | **평가자 가이드**·방법론 요약·출처 노트 한글·README 범위 수정 |
| `e92e4b5` | health runtime/error handling 보강 |
| `4af431c` | 시설 정렬, 단축키 1/2/3, 밀도 기억, print CSS, 로드 재시도 |
| `1404590` | `server-only` 제거 (Vercel 빌드 깨짐 수정) |
| `ce2b946` | 공유 URL sido, 범위 저장, 결론 복사, 시설 시도시 통계 |
| `85c3d0e` | NL에 sido 반영, 시설 유형 분포, CSV 시도시, health scope 메타 |
| `9a3d4fa` | embed-cache 테스트 격리, e2e 수정, smoke 확장 |
| `1415af0` | **다크/시스템/고대비 테마**, FOUC 부트스트랩 |
| `9b82e7f` | **부산+경남 + HIRA 병원 API** (핵심 범위 확대) |
| (그 이전) | Kakao 지도 수정, RAG hybrid, UX 타이포, cron, 비교 UI, 한 줄 결론, 시트 snap 등 |

### 기능 영역별 “끝난 것”

1. **지도:** Kakao JS (CSP `unsafe-eval`, clusterer 2단 로드), DemoMap 폴백  
2. **NL:** 규칙 카탈로그 + Qwen JSON 폴백, place-index, 시·도 칩과 연동  
3. **RAG:** BM25-lite + hash embed, optional remote re-rank + embed-cache  
4. **실데이터 파이프:** `runLiveSync` → HIRA 시설 + 인구 ctpv 26/48 최신월 병합 + Supabase publish  
5. **UX:** 3패널 리사이즈, 테마, 온보딩, 비교/드릴다운, 결과 검색·더보기, 평가자 가이드  
6. **검증:** Vitest 대량, Playwright chromium e2e, `npm run smoke`  

---

## 4. 환경 변수 (이름만 — 값 커밋 금지)

### 로컬 `.env.local`에 존재했던 키 이름 (시점)

- `DATA_GO_KR_SERVICE_KEY`, `HIRA_HOSP_SERVICE_KEY`
- `DATA_SYNC_SECRET`
- `KAKAO_REST_API_KEY`, `NEXT_PUBLIC_KAKAO_MAP_KEY`
- `QWEN_API_KEY`, `QWEN_BASE_URL`, `QWEN_PRIMARY_MODEL`, `QWEN_JSON_FALLBACK_MODEL`
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### Vercel production에 맞춰야 하는 것

| 키 | 용도 |
|----|------|
| 위 공개/서버 키 전부 | 기능 플래그·실데이터 |
| `CRON_SECRET` | Vercel Cron → `/api/cron/sync` |
| `CRON_ALERT_WEBHOOK` | 실패 알림 (현재 health상 **false**) |
| `HIRA_HOSP_SERVICE_KEY` | HIRA 전용 (없으면 DATA_GO 키 폴백) |

### 선택 플래그

- `LIVE_POPULATION_DISABLED=1` — 인구 live 끄기  
- `RAG_REMOTE_EMBED=1` / `QWEN_EMBED_MODEL` — parse/RAG remote embed  
- `BOUNDARY_VERSION` — 기본 `20260701`  

---

## 5. API 표면

| 경로 | 역할 |
|------|------|
| `GET /api/health` | **경량** capabilities/scope (동기화 상세는 최소화됨) |
| `GET /api/data/snapshot?mode=auto\|demo\|live` | 분석 스냅샷 |
| `GET/POST /api/data/sync` | 상태 조회 / 시크릿 보호 live sync |
| `GET /api/cron/sync` | 일 1회 cron (UTC 15:00, `vercel.json`) |
| `POST /api/ai/parse` | 의도 파싱 |
| `POST /api/rag/search` | RAG 검색 |
| `GET /api/kakao/*` | places, geocode, sdk proxy |

### HIRA 연동 요지 (`src/lib/data/hira-hospitals.ts`)

- Endpoint: `https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList`
- Format: **XML** · `sidoCd` 380000(경남)
- 키: encoding 키를 포털 방식대로 사용 (`decodeURIComponent` 1회)
- 시설 타입 매핑: clCd/clCdNm → 종합병원/병원/의원/요양/치과/한의/보건소 등

---

## 6. UI 상태 · localStorage 키

| 키 | 내용 |
|----|------|
| `ralphton-theme` | `system` \| `light` \| `dark` \| `contrast` |
| `ralphton-density-v1` | `comfortable` \| `compact` |
| `ralphton-recent-queries-v1` | 최근 질의 배열 |
| 온보딩 | `ralphton-onboard-v1` (또는 코드 내 `ONBOARD_KEY`) |

### 공유 URL 쿼리 (`share-state.ts`)

- `tool`, `region`, `radius`, `q`, `markers`, `tab`, **`sido`** (all이면 생략)

### 단축키

- `/` 질의 포커스 · `[` `]` 패널 · `\` 지도 넓게 · `Shift+0` 레이아웃 초기화  
- `Shift+D` 테마 순환 · `j`/`k` 순위 이동  

---

## 7. 스키마·도메인 주의

- `DemoSnapshotSchema.regions`: **`.min(150)`** (과거 `.length(206)` 폐기 — 경남 305 대응)
- `AnalysisIntentSchema.filters.limit`: **max 600**
- `CachedSnapshotSchema` (Supabase): regions 길이 고정 없음
- 시연 출처 노트: **한글 6줄** (seed-core)

---

## 8. 검증 방법

```powershell
cd C:\업무\랄프톤
npm run typecheck
npm test                          # Vitest 전 스위트 (~350+)
npm run data:boundaries:validate
npm run build
npm run smoke                     # 기본 프로덕션 URL
# E2E (chromium; mobile project는 Pixel 5)
npm run test:e2e -- --project=chromium
```

- smoke: `scripts/smoke.mjs` — home, health, snapshot demo/auto, sync GET, parse×3, rag  
- Playwright: `playwright.config.ts` · webServer=`next start` · **사전 `npm run build` 필요**  
- Windows 런처: `실행하기.cmd` / `tests/windows/launcher.contract.test.ts` (느림)

---

## 9. 알려진 이슈 · 함정 (재발 방지)

1. **Vercel API 500 (간헐/배포 직후)**  
   - 증상: `/`는 200, `/api/*`는 HTML 500  
   - 대응: health를 **env-only 경량**으로 둠 (`9597eb0`). 배포 직후 실패 시 15–30초 후 smoke 재시도  
   - **금지:** `import "server-only"` + `serverExternalPackages: ['server-only']` 조합 → 빌드/런타임 붕괴 이력  

2. **Turbopack NFT 경고**  
   - `live-sync` ↔ `process.cwd()`/`fs` 추적이 `next.config` 경로로 잡힘  
   - `/* turbopackIgnore: true */ process.cwd()` 적용됨. 경고는 남을 수 있음  

3. **Kakao Maps**  
   - CSP에 `unsafe-eval` 필요  
   - `libraries=` 한 번에 걸면 readyState hang → **core 먼저, clusterer 2단**  
   - `crossOrigin` 로드 깨짐 이력  

4. **embed-cache 테스트**  
   - 모듈 메모리 + 디스크 캐시 누수 → `resetEmbedCacheForTests` + VITEST 시 디스크 스킵  
   - `vitest.setup.ts`에 `vi.mock('server-only')`  

5. **Playwright**  
   - WebKit(iPhone) 미설치 환경 → mobile project는 **Pixel 5 Chromium**  
   - 모바일 시트 클릭은 force / 오버레이 주의  

6. **데모 vs live**  
   - 프로덕션에 **live 스냅샷 미게시** 상태 (sync 한 번도 성공 안 한 것으로 관측)  
   - 평가/시연 시 시연 데이터 고지 필수  

7. **HIRA 한계**  
   - 병원급 중심 · 약국·운영시간 빈약  
   - 구 부산 `MedicInstitService` 경로는 live-sync에서 HIRA로 교체됨  

8. **에이전트 시스템 (사용자 전역 규칙)**  
   - 작업 시 `C:\업무\agents` `update_status.py` 경유  
   - 응답: caveman/한글 우선, 한자·일본어 금지  

---

## 10. 미완 · 다음 작업 후보 (우선순위 제안)

### P0 — 실데이터·운영

1. **프로덕션 live sync 1회 성공**  
   - `POST /api/data/sync` + `x-sync-secret` / cron  
   - Supabase `data_snapshots` 게시 확인  
   - health/sync UI에서 facilityCount·published 확인  
2. **health에 상세 syncOps 재결합** (경량 base + optional dynamic import, 실패 시 degraded)  
3. **CRON_ALERT_WEBHOOK** 설정 여부 확인  

### P1 — 평가·제품 완성도

4. live 미게시 시 데이터 탭 **「지금 동기화」** 운영자 안내 (시크릿 없이 불가 명시)  
5. 인구 **13개월 전면 live** (현재 최신월 병합 위주)  
6. 평가 루브릭 인쇄 1페이지 (`print` CSS 확장)  
7. NFT 경고 근본 해소: demo-snapshot을 fs 대신 static import 분리 또는 sync 모듈 경로 정리  

### P2 — 품질

8. 동 단위 비교 UX 강화, 결과 페이지네이션 성능  
9. Playwright CI를 GitHub Actions에 고정  
10. wiki(`C:\업무\agents\wiki`)에 랄프톤 노트 등록 (사용자 지식 루프)

---

## 11. 이어서 작업할 때 권장 순서

```text
1. cd C:\업무\랄프톤 && git pull && git log -1
2. npm run smoke   # 프로덕션 생존 확인
3. 로컬: .env.local 키 확인 (이름만, 커밋 금지)
4. 변경 전: npm test && npm run typecheck
5. 실데이터 작업이면:
   - HIRA_HOSP_SERVICE_KEY / DATA_GO_KR_SERVICE_KEY / DATA_SYNC_SECRET / Supabase 롤
   - POST /api/data/sync { "publish": true } 헤더 x-sync-secret
6. 배포: git push main → vercel --prod (또는 자동)
7. 배포 후 smoke (실패 시 20초 후 재시도, health 경량 응답 확인)
```

### 자주 고치는 파일

| 목적 | 파일 |
|------|------|
| UI 전면 | `src/components/copilot/copilot-app.tsx` |
| 분석 툴 | `src/lib/analysis/tool-registry.ts` |
| 질의 규칙 | `query-rules.ts`, `query-catalog-meta.ts`, `query-signals.ts` |
| HIRA/sync | `hira-hospitals.ts`, `live-sync.ts` |
| 테마 | `src/lib/ui/theme.ts`, `globals.css` |
| 평가 문구 | `evaluator-guide.ts` |
| 데모 데이터 | `scripts/lib/seed-core.mjs` → `npm run data:seed` |

---

## 12. 평가자 관점 메모 (이미 앱에 반영)

- **이용 탭 → 평가자 점검 가이드** (`data-testid="evaluator-guide"`)
- **결과 패널 방법론 요약** (`data-testid="method-summary"`)
- 3분 시나리오: 의료취약 → 경남 칩 → 창원vs김해 → 데이터 탭 → 다크/CSV

---

## 13. 관련 외부 상태

| 시스템 | 메모 |
|--------|------|
| Vercel 프로젝트 | `ralphton-ai-gis-copilot` · org `na-da-s-projects` |
| Supabase | 스냅샷 테이블 `data_snapshots` (migration 존재) |
| agents | `C:\업무\agents` · 상태 스크립트 `scripts/update_status.py` |
| 위키 | 도메인 노트 등록은 선택 (아직 랄프톤 전용 MoC 갱신 미필수) |

---

## 14. 한 줄 핸드오프

**경남 305동 AI GIS 코파일럿은 main `9597eb0` / Vercel prod 배포 상태이며, 시연·NL·지도·테마·평가자 가이드까지 완료. 실데이터 live 스냅샷은 아직 게시되지 않았고, 다음 핵심 작업은 보호된 sync로 live 게시 + health/sync UX 복원이다다.**

이 파일을 갱신할 때: HEAD·smoke 결과·live 게시 여부·새 함정만 상단에 덮어쓴다.
