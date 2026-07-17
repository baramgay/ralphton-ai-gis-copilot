# 부산·경남 AI GIS Copilot

부산광역시·경상남도 행정동(약 511개)의 의료·인구 접근성을 지도와 자연어로 탐색하는 Next.js 앱입니다. API 키가 없어도 결정론적 시연 데이터와 SVG `DemoMap`으로 전체 분석 흐름이 동작합니다.

**프로덕션:** https://ralphton-ai-gis-copilot.vercel.app

## 가장 빠른 실행

Windows 탐색기에서 `실행하기.cmd`를 더블클릭합니다.

- 첫 실행에는 Node.js와 npm을 확인하고 필요한 패키지를 설치한 뒤 production build를 만듭니다.
- 3000번부터 사용 가능한 포트를 찾아 서버를 시작하고 브라우저를 엽니다.
- 종료할 때는 `종료하기.cmd`를 더블클릭합니다.
- 개발 중에는 `실행하기-개발모드.cmd`를 사용할 수 있습니다.

필수 환경은 Node.js 20.9 이상입니다.

```powershell
npm install
npm run dev
```

## 구현된 기능

- **범위:** 부산·경남 행정동 경계 기반 choropleth, 시설 marker/cluster, 1·2·3km 접근 반경
- **지도:** Kakao Maps SDK 선택 연동 · 키 없는 SVG `DemoMap` 자동 대체 · 전체/부산/경남 칩
- **분석:** 의료 취약, 고령 수요, 인구 증가 압력, 최근접 거리, 반경 접근성, 지역 비교 등 Tool Registry
- **UI:** 8개 빠른 분석, 순위·상세·13개월 추세, 구·동 비교, 한 줄 결론, 다크/시스템/고대비
- **NL:** 규칙 파서 + 선택적 Qwen JSON 파서, 하이브리드 RAG, 행정동 지명 사전(place-index)
- **실데이터:** HIRA 병원정보 v2(시도 210000·380000), 주민인구 live 병합, Supabase 공개 스냅샷, cron sync
- **평가자 가이드:** 이용 탭에 3분 시나리오·체크리스트·산식 요약

## 환경 변수

`.env.example`을 `.env.local`로 복사해 필요한 값만 채웁니다. 빈 상태가 정상적인 Demo 모드입니다.

| 변수 | 용도 |
|------|------|
| `NEXT_PUBLIC_KAKAO_MAP_KEY` | Kakao JS 지도 |
| `KAKAO_REST_API_KEY` | 카카오 로컬 REST |
| `DATA_GO_KR_SERVICE_KEY` | 공공데이터(인구 등) |
| `HIRA_HOSP_SERVICE_KEY` | HIRA 병원 API(없으면 DATA_GO 키 재사용) |
| `QWEN_*` | 자연어 파서·임베딩 |
| `DATA_SYNC_SECRET` / `CRON_SECRET` | 동기화·cron |
| `CRON_ALERT_WEBHOOK` | cron 실패 알림 |
| `LIVE_POPULATION_DISABLED=1` | 인구 live 끄기 |
| Supabase 공개/서비스 롤 | 스냅샷 캐시 |

서비스 역할 키와 AI·공공데이터 키는 브라우저에 노출하지 않습니다.

## 데이터와 산식

**시연 모드 기본 스냅샷은 합성 데이터**입니다. 인구·시설 좌표는 실제 정책 판단에 쓸 수 없습니다.

- 의료취약지수: 공급 부족 35% + 고령 수요 25% + 최근접 거리 25% + 2km 무시설 15%
- 거리: 행정동 대표점(`pointOnFeature`) 기준 대권 직선거리
- 자연증가: 출생 − 사망 (전입·전출 미포함)
- 결측 운영시간·진료과는 0으로 추정하지 않음

실데이터 모드: HIRA `getHospBasisList` + 주민인구 최신월 병합(선택).

## 검증

```powershell
npm test
npm run typecheck
npm run build
npm run smoke   # 기본: 프로덕션 URL
```

평가자 3분 시나리오는 앱 **이용 탭 → 평가자 점검 가이드**에 있습니다.
