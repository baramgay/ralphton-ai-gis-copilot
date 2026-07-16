# AI GIS Copilot 설계 명세

## 목적

부산 206개 행정동의 인구와 의료 접근성을 한 화면에서 탐색하고, 자연어 질문 또는 빠른 분석 한 번으로 지도·순위·요약·상세를 함께 갱신하는 제출 가능한 웹앱을 만든다. 외부 키와 네트워크가 전혀 없어도 전체 분석 흐름을 시연할 수 있어야 하며, 실데이터 연결 시에도 동일한 도메인 모델과 검증 규칙을 사용한다.

## 선택한 접근

오프라인 우선 하이브리드 구조를 채택한다.

- DB 우선형은 최신 데이터 운용에는 유리하지만 현장 네트워크, 계정, RLS 설정에 시연 성공 여부가 묶인다.
- 정적 데모형은 안정적이지만 공공데이터·Supabase·AI 연결 요구를 충족하기 어렵다.
- 하이브리드형은 검증된 로컬 경계와 결정론적 샘플을 기준선으로 사용하고, Route Handler의 서버 전용 어댑터가 있을 때만 실데이터와 AI를 추가한다. 동일한 화면과 Tool Registry가 두 모드 모두를 처리한다.

## 시스템 경계

### 데이터 파이프라인

`scripts/fetch-boundaries.mjs`가 GitHub API에서 `verYYYYMMDD` 디렉터리 중 최신 버전을 찾고, 원본 `HangJeongDong_verYYYYMMDD.geojson`을 `data/source`에 저장한다. 부산 Feature만 추출한 공개 파일과 SHA-256 메타데이터를 원자적으로 쓴다. 검증은 FeatureCollection, CRS84/EPSG:4326, 최소 150개 부산 Feature, 필수 속성, 코드 중복, geometry 존재, Polygon/MultiPolygon, 좌표 범위, Turf 기반 geometry 유효성 검사를 포함한다.

메타데이터는 `public/data/boundary-metadata.json`에 UTC ISO-8601 다운로드 시각으로 저장하고, SHA-256은 최종 부산 공개 GeoJSON의 실제 바이트를 대상으로 한다. `npm run data:boundaries`는 온라인에서 최신본을 갱신하며, production build는 네트워크를 호출하지 않고 캐시된 공개본과 메타데이터를 다시 검증해 오프라인 재현성을 유지한다.

`scripts/seed-demo-data.mjs`는 부산 경계의 행정동 코드와 실제 중심점을 사용해 결정론적인 12개월 인구·연령·출생·사망·시설 샘플을 생성한다. 같은 코드와 seed는 항상 같은 결과를 만든다. 206개 행정동을 모두 포함하고, 시설은 부산 경계 내부에 배치하며, 약국과 의료기관 분류·진료과·운영시간을 별도 필드로 둔다.

### 도메인 모델과 Tool Registry

도메인 데이터는 `RegionMetric`, `Facility`, `MonthlyPopulation`, `AnalysisIntent`, `AnalysisResult`로 정규화한다. 모든 집계는 `adm_cd2` 10자리 행정기관코드를 기본 키로 사용하고 중복을 거부한다.

Tool Registry는 다음 검증된 순수 함수만 노출한다.

- `rankHospitalScarcity`
- `rankElderlyUnderserved`
- `rankPopulationGrowthPressure`
- `rankPopulationDeclineRisk`
- `rankSingleHouseholdRisk`
- `filterFacilitiesByTypeAndHours`
- `compareRegions`
- `nearestFacilityDistance`
- `countFacilitiesWithinRadius`
- `getRegionDetails`

거리, 반경, 면적, 중심점, point-in-polygon은 Turf.js로 계산한다. 의료취약지수는 인구당 공급 부족, 고령 수요, 최근접 거리, 2km 접근성 부족을 0~100 정규화한 가중합으로 계산하며 세부 산식을 UI에 표시한다. 출생-사망은 자연증가로만 표시하고 전입·전출 미포함을 함께 노출한다.

연령 구간은 유소년 0~14세, 생산연령 15~64세, 고령 65세 이상으로 고정하고, 총부양비는 `(유소년+고령)/생산연령×100`, 인구밀도는 `총인구/행정동 면적(km²)`로 계산한다. 최신 공통 기준월은 필수 데이터셋 모두에 존재하는 가장 늦은 `YYYY-MM`이며, 12개월 증감은 기준월과 정확히 12개월 전을 비교한다. 추세 그래프용 데이터는 기준월을 포함한 최근 12개 월을 사용하므로 생성·수집에는 최소 13개 월이 필요하다.

행정동 대표점은 Turf `pointOnFeature`로 경계 내부에 둔다. 최근접 거리는 대표점에서 시설까지의 직선거리, 1/2/3km 접근성은 대표점을 중심으로 한 반경 안 시설 수다. 의료취약지수는 전체 부산 행정동의 winsorized min-max 점수로 `인구 1만 명당 의료기관 부족 35% + 고령화 수요 25% + 최근접 거리 25% + 2km 무시설 15%`를 적용한다. 동률은 `adm_cd2` 오름차순으로 정렬한다. 1인가구는 행정안전부 `admmSexdAgeOneHh/selectAdmmSexdAgeOneHh`를 선택적 실데이터 원천으로 사용한다. 해당 자료가 없는 행정동은 값을 추정하지 않고 위험 순위에서 제외하며, 데모 데이터는 명시적으로 샘플 1인가구 수를 포함한다.

### 실데이터와 Supabase

공공데이터 어댑터는 Route Handler 안에서만 인증키를 읽는다. 의료기관/약국 운영시간, 행정동 인구·세대, 성·연령 인구(`admmSexdAgePpltn/selectAdmmSexdAgePpltn`), 성·연령별 1인세대(`admmSexdAgeOneHh/selectAdmmSexdAgeOneHh`), 사망말소, 출생등록 응답을 공급자별 파서로 정규화하며, 공통으로 존재하는 최신 기준월과 전년 동월을 선택한다. 응답 실패·열 누락·월 불일치 시 추측하지 않고 해당 데이터셋을 제외하거나 검증된 데모 스냅샷으로 전환한다.

Supabase는 선택적 읽기 캐시다. 클라이언트는 publishable/anon 수준의 공개 읽기만 수행하고, service-role 클라이언트는 서버 함수 안에서 지연 생성한다. 스키마 SQL은 RLS를 활성화하고 읽기 전용 공개 정책과 최소 권한 GRANT를 함께 정의한다. 앱 빌드와 데모는 Supabase가 없어도 성공해야 한다.

스키마는 `data_snapshots`(출처·기준월·모드·체크섬), `region_metrics`(스냅샷+행정동별 정규화 지표), `facilities`(스냅샷+좌표·분류·운영시간) 세 테이블로 제한한다. anon은 명시적으로 공개된 demo/live 스냅샷의 `SELECT`만 허용하고 쓰기는 모두 거부한다. 동기화·upsert는 서버 전용 service-role 경로에서만 가능하다.

### AI 의도 파싱

`POST /api/ai/parse`는 입력 길이를 제한하고 Zod 스키마로 본문을 검증한다. 서버는 `qwen3.7-max`에 JSON 모드와 비사고 모드를 요청하고, 파싱 또는 Zod 검증 실패 시 한 번 재시도한다. 이후 `qwen3.7-plus`로 한 번 fallback한다. 모든 실패 또는 키 없음에서는 같은 `AnalysisIntent`를 내는 결정론적 한국어 규칙 파서를 사용하고 데모 모드를 표시한다.

모델이 반환할 수 있는 것은 Tool Registry 이름과 허용된 인자뿐이다. SQL, JavaScript, shell, URL, 임의 GIS 코드 필드는 스키마에 존재하지 않으며 알 수 없는 키는 거부한다. UI에는 제공사, 모델, 키, 내부 프롬프트를 표시하지 않는다.

### 지도

지도 어댑터는 동일한 `MapViewModel`을 두 렌더러에 전달한다.

1. `KakaoMap`: SDK를 `autoload=false`로 동적 로드하고 `services,clusterer,drawing` 라이브러리를 요청한다. GeoJSON `[lng, lat]`를 `LatLng(lat, lng)`로 변환해 폴리곤, 선택 상태, 시설 마커/클러스터, 1/2/3km 원을 그린다.
2. `DemoMap`: 실제 부산 GeoJSON을 SVG path로 투영해 단계구분도, 시설 점, 선택, 거리 원, 범례를 렌더링한다. 키·SDK·네트워크·브라우저 API 실패 시 자동 사용된다.

선택 행정동, 지표, 필터, 범위, 비교 대상은 두 렌더러에서 동일하다. 지도 클릭은 상세 패널을 갱신하고, 목록 선택은 지도의 선택과 포커스를 갱신한다.

## 인터페이스 설계

데스크톱은 왼쪽 400px 분석 패널과 오른쪽 가변 지도다. 모바일은 지도를 배경으로 유지하고 하단에 직접 조작 가능한 Bottom Sheet를 둔다. 세 탭은 `분석`, `이용방법`, `데이터 정보`이며 WAI-ARIA tabs 키보드 패턴을 따른다.

분석 탭 상단에는 질문 입력과 실행 버튼, 이어서 8개 빠른 분석 칩, 결과 요약, 상위 순위, 선택 행정동 상세를 배치한다. 빠른 분석은 pointer-down 시 즉시 시각 피드백을 주고 150ms 이내에 상태를 반영한다. 활성 항목은 `aria-pressed`, 아이콘, 색상, 텍스트로 중복 표현한다.

상세 카드에는 값, 단위, 기준월, 산식, 해석 한계를 함께 표시한다. 시설 데이터에 진료과·시간 필드가 없으면 해당 조건을 만족한다고 추측하지 않고 “데이터 없음”을 보여준다. “병원”은 약국을 제외한 모든 의료기관을, “약국”은 명시된 경우에만 포함한다.

이용방법 탭은 30초 안에 이해 가능한 빠른 시작, 실행 버튼이 있는 추천 분석, 클릭 가능한 질문 예시, 지도 읽는 법, 기준월·직선거리·자연증가·시설 분류 한계를 아코디언 카드로 제공한다. 데이터 정보 탭은 출처, 기준월, 경계 버전, SHA-256, 데모 여부, 계산 한계를 보여준다.

시각 언어는 시스템 글꼴, 흰색/안개색 표면, 절제된 부산 블루, 명확한 공간 위계를 사용한다. 큰 그라데이션, 네온, 장식 차트는 사용하지 않는다. 반투명 소재는 패널 chrome 한 계층에만 쓰고 본문 카드는 불투명하게 유지한다. `prefers-reduced-motion`, `prefers-reduced-transparency`, `prefers-contrast`, 고대비 포커스 링, 44px 터치 타깃을 지원한다.

## 상태와 데이터 흐름

1. 서버 페이지가 공개 메타데이터와 데모 데이터 버전을 읽어 초기 shell을 렌더링한다.
2. 클라이언트 앱이 경계·분석 데이터 JSON을 병렬 로드하고 스키마를 검증한다.
3. 빠른 분석 또는 자연어 의도가 단일 reducer의 `AnalysisSelection`으로 정규화된다.
4. Registry executor가 허용된 도구만 호출하고 `AnalysisResult`를 만든다.
5. 지도, 범례, 순위, 요약, 상세는 같은 결과 객체를 구독해 한 번에 갱신된다.
6. 행정동/시설 선택은 reducer로 되돌아가 양방향 동기화된다.

## 오류와 회복

- 경계·샘플 파일 검증 실패는 빌드 실패다.
- 선택적 외부 연결 실패는 전체 화면을 중단하지 않고 데모 배지와 원인별 비민감 안내를 표시한다.
- API 오류 응답에는 키, 제공사 원문 본문, 스택을 포함하지 않는다.
- SDK 중복 로드를 한 Promise로 합치고 실패 후 DemoMap으로 전환한다.
- 입력 오류는 질문 필드 가까이에 설명하고 포커스를 유지한다.
- Error Boundary와 빈 상태, skeleton을 제공한다.

## Windows 실행

PowerShell 실행기가 앱별 PID 파일과 포트 파일을 `logs`에 관리한다. Node/npm 확인, 의존성 설치 필요 여부, `.env.local` 템플릿 복사, production build, 3000부터 포트 탐색, 서버 준비 endpoint 확인, Chrome 우선 실행, 기본 브라우저 fallback, UTF-8 로그, 중복 실행 방지를 담당한다. 종료기는 PID와 프로세스 command line이 이 프로젝트를 가리키는지 재검증한 뒤 해당 프로세스 트리만 종료한다. CMD 파일은 서명 없는 PowerShell 실행을 안전하게 호출하는 얇은 래퍼다.

Node 최소 버전은 20.9, 포트 범위는 3000~3099, 준비 대기는 최대 60초다. `logs/app.pid`, `logs/app.port`, `logs/app.log`를 사용하고 5MB를 넘은 로그는 시작 시 한 세대(`app.previous.log`)만 보존한다. `package-lock.json`과 `node_modules`가 일치하면 설치를 생략하고, lockfile은 있으나 의존성이 없거나 불완전하면 `npm ci`, 최초 lockfile이 없을 때만 `npm install`을 사용한다.

## 보안 기준

- 원문 프롬프트에 포함된 자격증명은 노출된 것으로 취급하며 코드·문서·로그·Git·브라우저 번들로 복사하지 않는다.
- `.env.example`은 요구된 변수명과 비밀이 아닌 기본 모델명만 포함한다.
- `.env.local`, 로그, PID, 원본 프롬프트, 임시 다운로드는 Git에서 제외한다.
- 공개 번들에는 Kakao JavaScript 키와 Supabase 공개 키도 값으로 커밋하지 않는다. 사용자가 로컬 환경에서 명시적으로 넣을 때만 Next.js가 주입한다.
- 서버 어댑터는 timeout, 입력 길이 제한, 허용 도메인, Zod 스키마, 안전한 오류 메시지를 사용한다.
- Supabase 공개 스키마는 RLS와 최소 권한을 기본으로 한다.

## 검증 전략

- 단위: GeoJSON 좌표 변환, 코드 중복, 인구 통·반 중복 제거, 최신 공통월, 자연증가, 거리, 반경 수, 취약지수, 모든 Registry 도구와 질의 규칙.
- 컴포넌트: 8개 빠른 분석, `aria-pressed`, 탭/Enter/Space/화살표 키, 지도-상세 동기화, 카드 산식·단위·기준월, 데모 배지.
- API: AI 성공·재시도·fallback·규칙 파서, 금지 필드 거부, 공공데이터 정규화와 키 없음 fallback.
- E2E: 병원, 고령, 인구 증가, 기장군-강서구, 2km, 종합병원, 야간, 약국 질문; 모바일 시트; SDK 실패; 콘솔 오류 없음.
- 실행기: 첫 실행, 중복 실행, 3000 점유, Chrome 없음, 준비 확인, 앱 프로세스만 종료.
- 최종 게이트: `npm run data:boundaries`, `npm run data:seed`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify`와 브라우저 smoke test가 모두 새 실행에서 성공해야 한다.

## 완료 기준

마스터 프롬프트의 모든 명명된 파일, 도구, 버튼, 탭, 질의, 검증 명령이 존재하는 것만으로는 충분하지 않다. 각 항목은 자동화 테스트 또는 실제 브라우저/프로세스 관찰로 동작이 입증되어야 하며, 키 없는 새 환경에서 production build와 전체 분석 데모가 작동해야 한다.
