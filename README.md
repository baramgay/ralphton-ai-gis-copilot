# 부산 AI GIS Copilot

부산 206개 행정동의 의료·인구 접근성을 지도와 자연어로 탐색하는 Next.js 데모입니다. API 키가 전혀 없어도 결정론적 샘플 데이터와 SVG `DemoMap`으로 전체 분석 흐름이 동작합니다.

## 가장 빠른 실행

Windows 탐색기에서 `실행하기.cmd`를 더블클릭합니다.

- 첫 실행에는 Node.js와 npm을 확인하고 필요한 패키지를 설치한 뒤 production build를 만듭니다.
- 3000번부터 사용 가능한 포트를 찾아 서버를 시작하고 브라우저를 엽니다.
- 실행 상태와 포트는 `logs/` 아래에 기록됩니다.
- 종료할 때는 `종료하기.cmd`를 더블클릭합니다. 이 프로젝트가 소유한 프로세스만 확인 후 종료합니다.
- 개발 중에는 `실행하기-개발모드.cmd`를 사용할 수 있습니다.

필수 환경은 Node.js 20.9 이상입니다. 명령줄에서는 다음과 같이 실행할 수 있습니다.

```powershell
npm install
npm run dev
```

## 구현된 기능

- 부산 행정동 206개 경계 기반 choropleth, 시설 marker/cluster, 1·2·3km 접근 반경
- Kakao Maps SDK 선택 연동과 키 없는 SVG `DemoMap` 자동 대체
- 의료 취약, 고령 수요, 인구 증가 압력, 최근접 거리, 반경 접근성, 지역 비교 등 10개 Tool Registry
- 8개 빠른 분석, 행정동 클릭, 순위·상세 지표·13개월 추세 동기화
- “병원”은 약국을 제외한 전체 의료기관으로 해석하고 약국은 명시 요청 때만 포함
- Qwen JSON 의도 파서: primary 재시도, fallback, 규칙 기반 demo 순서의 안전한 폴백
- 오프라인 RAG: 도구·지표·한계 지식 코퍼스 검색(BM25-lite)을 AI 프롬프트·해석 카드에 주입 (`POST /api/rag/search`)
- 공공데이터 정규화 계층과 선택적 Supabase 공개 스냅샷 캐시
- 400px 데스크톱 분석 패널과 모바일 bottom sheet, 키보드 지도 선택, reduced-motion 대응

## 환경 변수

`.env.example`을 `.env.local`로 복사해 필요한 값만 채웁니다. 빈 상태가 정상적인 Demo 모드입니다.

- `NEXT_PUBLIC_KAKAO_MAP_KEY`: Kakao JavaScript 지도 공개 키
- `DATA_GO_KR_SERVICE_KEY`, `KAKAO_REST_API_KEY`: 서버 전용 공공·공간 데이터 키
- `QWEN_API_KEY`, `QWEN_BASE_URL`: 서버 전용 자연어 파서 설정
- `QWEN_PRIMARY_MODEL` (기본 `qwen3.6-flash`), `QWEN_JSON_FALLBACK_MODEL` (기본 `qwen3.7-plus`): 의도 JSON 파싱용 가성비 모델. DashScope OpenAI 호환 endpoint 사용
- `DATA_SYNC_SECRET`: `POST /api/data/sync` 보호용 공유 비밀(없으면 동기화 비활성)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: 공개 스냅샷 읽기
- `SUPABASE_SERVICE_ROLE_KEY`: 서버 전용 동기화 권한

서비스 역할 키와 AI·공공데이터 키는 브라우저 코드에 전달하지 않습니다.

## 데이터와 산식

기본 스냅샷은 기능 시연을 위한 합성 데이터입니다. 인구·세대·시설 값은 실제 정책 판단에 사용할 수 없습니다.

- 기준월: 모든 입력에 공통으로 존재하는 최신 월
- 추세: 13개월 입력으로 최근 12개월 변화 계산
- 자연증가: 출생 − 사망, 전입·전출 미포함
- 대표점: Turf `pointOnFeature`로 행정동 내부에 배치
- 최근접 거리: 대표점에서 시설까지의 대권 직선거리
- 의료취약지수: 공급 부족 35% + 고령 수요 25% + 최근접 거리 25% + 2km 무시설 15%
- 결측 1인가구·운영시간은 0으로 추정하지 않고 “데이터 없음”으로 유지

## 검증 명령

```powershell
npm run data:boundaries
npm run data:seed
npm test
npm run typecheck
npm run lint
npm run build
npm run verify
# optional: VERIFY_E2E=1 npm run verify   (Playwright 포함)
# optional live facilities: DATA_SYNC_SECRET + DATA_GO_KR_SERVICE_KEY 후 POST /api/data/sync
```

Windows 실행기만 확인하려면 다음 명령을 사용합니다.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-windows.ps1
```

## 주요 경로

- `src/lib/analysis/tool-registry.ts`: 허용된 10개 분석 도구
- `src/lib/gis/`: 좌표·거리·반경·취약지수 계산
- `src/components/copilot/`: 분석 패널, Kakao/SVG 지도, 상세 UI
- `scripts/`: 경계 검증, 데모 생성, Windows 검증
- `supabase/migrations/`: 선택적 캐시 스키마와 RLS
- `public/data/`: 검증된 부산 경계와 데모 스냅샷
