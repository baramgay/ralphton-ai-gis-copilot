# 경남 GIS 레이어 플랫폼화 — 설계 (Phase 1–2)

- **작성일**: 2026-07-24
- **대상 앱**: `C:\업무\랄프톤` (ralphton-ai-gis-copilot)
- **이번 스펙 범위**: Phase 1(경남 전환 + 레이어/큐브 기반) + Phase 2(SKT 생활인구 파일럿)
- **최종 목표(비전)**: 민간데이터 포함 다양한 GIS 데이터를 자연어로 분석하는 플랫폼

---

## 0. 배경 & 문제

현재 앱은 **부산+경남 511 읍면동의 의료·인구 접근성**이 스키마부터 UI까지 하드코딩된 단일 도메인 수직 슬라이스다.

- 데이터 모델(`RegionSeries`)이 인구 필드 고정, 시설(`FacilityType`) 8종 의료 enum 고정, 지표(`medicalVulnerabilityIndex`) 의료 전용
- NL 파서(`query-catalog` 420줄)·툴 레지스트리·UI 범례 모두 의료+인구에 결박
- 안정성 자체는 튼튼(테스트 356/356, 프로덕션 live 게시 정상)

민간데이터(SKT 생활·유입인구, NH 카드매출, KCB 신용)를 붙이려면 "설정 추가"가 아니라 관통 리팩터가 필요하다. 투기적 범용 플랫폼을 먼저 짓지 않고, **실제 첫 민간 데이터셋(SKT)을 붙이며 그것이 강제하는 최소 추상화만** 뽑는다.

### 확정된 방향 결정 (사용자 승인)

1. 기존 의료·인구를 **레이어로 흡수**하는 통합 리팩터 (별도 병행 시스템 아님)
2. **경남 특화 전환** — 부산 데이터 전부 제거, 경남 305 읍면동만
3. 단위는 **읍면동 기본 + 시군구 런타임 집계**, 자연어가 단위 판단
4. 데이터 모델 접근 **C(하이브리드)**: 레이어 인터페이스 + 공통 "코로플레스 큐브", 다차원 원본은 ETL에서 읍면동 지표로 사전 환원

---

## 1. 아키텍처 & 데이터 모델

### 1.1 핵심 타입 (신규 `src/lib/layers/`)

```ts
type AdminLevel = "dong" | "sgg";
type LayerKind = "choropleth" | "point";

type MetricDef = {
  key: string;              // "living_total"
  label: string;            // "총 생활인구"
  unit: string;             // "명" | "원" | "건" | "%"
  aggregation: "sum" | "weightedAvg";  // 동→시군구 집계법
  weightKey?: string;       // weightedAvg 시 가중치 지표 key
  formula: string;
  limitation: string;
  triggers: string[];       // NL 라우팅 어휘
};

type LayerDescriptor = {
  id: string;               // "medical" | "population" | "skt-living" ...
  label: string;
  provider: "공공" | "SKT" | "NH" | "KCB";
  kind: LayerKind;
  coverage: "gyeongnam";
  adminLevels: AdminLevel[];
  metrics: MetricDef[];
  months: string[];
  sourceNotes: string[];
};
```

### 1.2 공통 데이터 형태 — 코로플레스 큐브

```ts
type LayerCube = {
  layerId: string;
  adminLevel: AdminLevel;
  referenceMonth: string;
  months: string[];
  cells: Array<{
    code: string;           // 읍면동 10자리(adm_cd2) | 시군구 5자리(sgg)
    name: string;
    point: { lat: number; lng: number };  // 대표점 (pointOnFeature)
    areaKm2: number;
    series: Record<string, (number | null)[]>;  // metricKey → 13개월
    breakdown?: Record<string, BreakdownPayload>; // 선택: 성연령·업종·시간대
  }>;
};
```

- **의료·인구도 이 모델의 인스턴스**:
  - `population` 레이어(kind=choropleth): 기존 주민등록 인구·세대·고령·출생사망 지표
  - `medical` 레이어(kind=point): 기존 시설/취약지수. `medicalVulnerabilityIndex` 등은 medical 전용 파생지표 모듈로 이동
- **시군구 뷰 = 동 큐브 런타임 집계**: `aggregation`에 따라 sum(건수·인구) 또는 weightedAvg(비율·밀도, `weightKey` 가중). ETL은 항상 읍면동만 산출, sgg는 파생
- **활성 레이어 상태**: 한 번에 **1개 코로플레스 레이어 + 선택적 medical 포인트 오버레이**. 다중 코로플레스 동시비교는 후순위(YAGNI)

### 1.3 코드 매핑

경계 geojson properties에 이미 내장: `adm_cd2`(10자리)·`adm_cd`(8자리=SKT ADMDONG_CD)·`sgg`(5자리)·`sggnm`·`adm_nm`. **외부 코드 CSV 불필요** — 경계 파일이 코드 정규화의 단일 진실원. (SKT 8자리 ↔ 앱 10자리 ↔ 시군구 5자리 매핑을 여기서 생성.)

### 1.4 기존 자산 재사용

`AnalysisResult` / `MetricDescriptor` / `LegendItem`(`result.ts`) 구조 그대로 활용 — 툴이 큐브를 받아 랭킹·해석 생산. `AnalysisSnapshot`은 `LayerCube`로 대체하되 medical 소비처는 어댑터로 하위호환.

---

## 2. ETL 파이프라인 (오프라인)

**원칙**: 다차원 원본 복잡성은 전부 오프라인 스크립트에 격리 → 앱은 정규화된 큐브만 소비. 기존 `scripts/` + `data:seed`/`data:sync` 패턴 계승.

### 2.1 경계·코드 셋업 (일회성)

- **읍면동 경계**: 현 `administrative-dong-20260701.geojson`에서 경남 305 feature만 필터 (이미 `adm_cd2`·`adm_cd`·`sgg`·`sggnm` 코드 속성 보유 → 별도 shp 변환 불필요). 부산 206 제거
- **시군구 경계**: 위 읍면동 폴리곤을 `sgg` 코드로 dissolve(turf `union`/`combine`)하여 18개 시군구 폴리곤 생성. 외부 shp 의존 없음
- **대표점**: `pointOnFeature`로 읍면동·시군구 각각 산출 (기존 로직 재사용)

### 2.2 제공사 어댑터 (`scripts/adapters/<provider>.mjs`)

각 어댑터: 원본 → 표준 `LayerCube(dong)` 산출. 인코딩(CP949/pipe) 흡수, 출력은 항상 UTF-8 JSON.

| 어댑터 | 원본 | 1차 지표 | breakdown | 단계 |
|---|---|---|---|---|
| `skt-living` | `gn_living_pop_hjd_*.csv` (pipe, ADMDONG_CD 8자리) | 총생활인구(일평균), 고령비중 | 성·연령 34칸 | **Phase 2** |
| `skt-inflow` | `gn_inflow_pop_dong_*.csv` | 총유입인구, 외지유입비중 | 거주지 시군구별 | Phase 3 |
| `nh-card` | `경상남도_2_성연령별_*.csv` (CP949, adm_cd 10자리) | 총매출액, 매출건수, 개인비중, 건단가 | 성연령·업종·시간대 | Phase 3 |
| `kcb-credit` | `KCB_STAT_*.txt` (100m 격자) | 신용지표 (격자→동 집계) | — | Phase 3+ |

- 월 병합: 제공 범위 202501~202512를 12~13개월 시계열로 결합
- KCB 격자집계: `격자변환/grid_100m_centroids_wgs84.csv` + 동 폴리곤 turf point-in-polygon

### 2.3 검증 & 산출물

- 각 어댑터 zod 스키마 통과 + **동 커버리지 리포트**(누락 동 경고). 기존 `validate-boundaries` 패턴
- 로컬: `public/data/layers/<layerId>.json` + `layer-catalog.json`
- 원격: Supabase `data_snapshots` 테이블에 `layer_id` 컬럼 추가 → `snapshot` API가 레이어 파라미터로 서빙

---

## 3. 자연어 라우팅

큐브 모델이라 툴이 대부분 "지표 X 랭킹/비교/상세"로 수렴 → 파서에 **레이어·단위 슬롯** 추가.

### 3.1 의도 스키마 확장 (`intent-schema.ts`)

```ts
AnalysisIntent {
  layerId?: string;      // 미지정 시 활성 레이어 유지
  metricKey?: string;    // 레이어 내 지표
  adminLevel?: AdminLevel; // NL 판단
  tool: "rank" | "compare" | "detail" | "trend" | "radius"; // radius=medical 전용
  regions?, month?, filters ...  // 기존 유지
}
```

### 3.2 라우팅 규칙 (규칙 우선, Qwen 폴백)

- **레이어 사전**: 각 `MetricDef.triggers` — "생활인구/유동"→skt-living, "카드매출/소비/매출"→nh-card, "병원/의료취약"→medical, "고령/세대"→population. 다중 매칭 시 명시 우선
- **단위 판단(NL)**: "시군구별/시별/창원·김해 비교"→sgg, "동별/읍면동/OO동"→dong, 미지정 시 레이어 기본단위(dong)이되 지역명이 시군구면 sgg 승격
  - 예: "경남 시군구별 카드매출 순위" → (nh-card, card_sales_amt, sgg, rank)
- **지명 사전**: `place-index.json`을 경남 시군구+읍면동으로 재생성, 단위 태깅
- **RAG**: 기존 하이브리드 검색 유지, 코퍼스를 레이어별 지표·산식 설명으로 확장

### 3.3 폴백·안전

- 레이어 미해석 → 활성 레이어에서 지표만 매칭 → 실패 시 명확화 질문(추측 금지)
- metricKey가 레이어에 없으면 최근접 지표 제안 + 근거 고지

### 3.4 툴 레지스트리 재편

의료 전용 다수 툴 → **큐브 제네릭 4종**(rank/compare/detail/trend) + **medical 전용**(radius/최근접/취약지수)만 잔존. 각 툴 시그니처 `(intent, cube)`.

---

## 4. UI/UX

- **레이어 스위처(신규)**: 분석 패널 상단. 선택 시 지표 드롭다운·범례·NL 예시 교체. 활성 = 1 코로플레스 + 의료 포인트 토글
- **단위 토글(신규)**: 시군구 ↔ 읍면동 세그먼트. NL 판단 시 자동 전환 + 수동 오버라이드
- **시도 칩 제거·재편**: 부산/경남/전체 칩(1/2/3) 삭제 → 경남 시군구 빠른선택(창원·김해·진주…)으로 대체
- **지표 범례·해석**: 큐브 지표별 동적 범례(단위·산식). 방법론 요약·한 줄 결론·CSV·13개월 추세 재사용, 출처 배지에 제공사(SKT/NH/KCB/공공) 표기
- **breakdown 뷰(선택)**: 동 상세에서 성연령·업종·시간대 미니 차트(있을 때만, 없으면 숨김)
- **부산 흔적 제거**: sido localStorage/공유URL 키, 온보딩 문구, 평가자 가이드 시나리오(경남으로), README·핸드오프

### 모놀리스 분해 (필요한 만큼만)

`copilot-app.tsx`(3,126줄)에서 이번에 손대는 경계만 컴포넌트 추출: `LayerSwitcher`, `AdminLevelToggle`, `LayerLegend`, `BreakdownPanel`. 전면 리팩터 안 함(외과적 변경). 3패널 리사이즈·테마·단축키·접근성·인쇄 CSS·평가자 가이드 골격 보존.

---

## 5. 기존 코드 마이그레이션

- **범위 축소**: `scope.ts` 부산/경남 이원 → 경남 시군구(18개)·읍면동 헬퍼로 재편. `SidoScope`·`sidoBadge`·부산 분기 삭제
- **경계·데이터 재생성**: 부산 feature 제거된 경남 전용 geojson·place-index·demo-snapshot. `boundary-metadata` 갱신
- **의료·인구 레이어화**: `RegionSeries` → `population` 큐브, 시설/취약지수 → `medical`(point) 레이어
- **HIRA sync**: 부산 sido 210000 제거, 경남 380000만. cron·live-sync 경남 전용화
- **하위호환**: `AnalysisSnapshot` 소비처를 큐브 어댑터로 교체, 테스트 픽스처 동반 수정

---

## 6. 테스트 & 검증

- **단위**: 어댑터 파싱·정규화·코드매핑, 동→시군구 집계(sum/weightedAvg), NL 레이어·단위 라우팅, 큐브 제네릭 툴. 기존 356 스위트는 부산 제거분 수정
- **스키마**: 각 큐브 zod 통과 + 동 커버리지 리포트
- **E2E(Playwright)**: 레이어 전환→단위 토글→NL 질의→랭킹 렌더 플로우 1종 추가
- **검증 게이트**: `npm test`·`typecheck`·`build`·`smoke` 그린 + **배포 URL 기준**(로컬만으로 완료 선언 금지)
- **린트 8건**: 해당 파일 손대는 김에 정리(prefer-const·effect setState)

---

## 7. 단계 (phasing)

1. **기반(Phase 1)**: 경남 전환(부산 제거) + 레이어/큐브 타입 + 의료·인구 흡수 + 단위 토글. *검증: 기존 기능이 경남·큐브 위에서 동작*
2. **SKT 파일럿(Phase 2)**: skt-living 어댑터 + 레이어 스위처 + NL 라우팅 + 시군구 집계. *검증: "경남 시군구별 생활인구 순위" NL 동작*
3. **확장(Phase 3+)**: skt-inflow → nh-card(업종·시간대 breakdown) → kcb-credit(격자→동). 어댑터+지표만 추가
4. **운영**: Supabase 레이어 게시 + Vercel 배포 + smoke

**이번 스펙은 Phase 1–2 확정.** Phase 3+는 각자 spec→plan 사이클.

---

## 8. 비목표 (이번 스펙 제외)

- 50m/100m 격자 단위 시각화 (사용자 지시로 후순위)
- 부산 재편입
- 다중 코로플레스 동시비교
- NH/KCB/SKT-inflow 어댑터 (Phase 3+)
- 실시간 스트리밍/업데이트 (월배치 유지)

---

## 9. 리스크 & 대응

| 리스크 | 대응 |
|---|---|
| 코드 매핑 불일치(SKT 8자리 ↔ 앱 10자리) | 경계 geojson 내장 속성으로 사전 생성·검증, 커버리지 리포트로 누락 감지 |
| 356 테스트 대량 수정 부담 | Phase 1에서 부산 제거·큐브 흡수를 먼저 그린화 후 SKT 추가 |
| 모놀리스 확장 난이도 | 신규 컴포넌트만 추출, 전면 리팩터 회피 |
| Vercel 배포 500 재발(기존 함정) | health 경량 유지, 배포 후 20–30초 smoke 재시도 |
| ETL 산출물 용량(레이어별 큐브) | gzip·필요 월만 포함, Supabase 게시 |
