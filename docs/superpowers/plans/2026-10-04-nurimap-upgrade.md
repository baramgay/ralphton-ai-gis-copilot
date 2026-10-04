# 누리맵 고도화 구현 계획

> **For agentic workers:** Use parallel agents for the independent tasks below. The user explicitly requested parallel implementation and active use of subagents.

**Goal:** 첫 방문·분석 결과·데이터 신선도와 동기화 신뢰성을 개선한다.

**Architecture:** 기존 Next.js 앱과 분석 엔진을 유지한다. UI, 해석 데이터, 운영 저장소를 파일 단위로 분리해 병렬 수정하고 통합 후 검증한다.

**Tech Stack:** Next.js 16.2.10, React 19, TypeScript, Supabase, Vercel, Vitest, Playwright.

## 공통 제약

- 기존 미추적 `scripts/adapters/nh-blocks.mjs`를 수정하지 않는다.
- 공유 Supabase의 다른 서비스 테이블과 데이터를 변경하지 않는다.
- 신규 회원제·결제·데이터 공개 정책을 추가하지 않는다.
- 데이터 기준월과 합성값 표시는 분석에 실제 사용한 자료를 따른다.
- 사용자 승인: 2026-10-04, 1차 개선안에 대한 병렬 구현 요청.

## 작업 1: 진입과 결과 UI

담당 파일: `src/components/copilot/copilot-app.tsx`, `query-hero.tsx`, `app-topbar.tsx`, `src/app/globals.css`, UI·E2E 테스트.

- [x] 분석 전 자동 지역 선택과 빈 결과 내보내기를 제거한다.
- [x] 짧은 시작 안내, 이해하기 쉬운 패널 버튼, 합성 통계 표시를 적용한다.
- [x] 모바일 질의 안내와 지도 범례·도구의 겹침을 줄인다.
- [x] 좁은 데스크톱의 패널 배치를 개선하고 키보드 접근성을 유지한다.
- [x] 관련 UI 회귀 테스트와 4개 화면 크기의 브라우저 검증을 실행한다.

## 작업 2: 해석과 내보내기의 기준월

담당 파일: `src/lib/analysis/*`, `src/components/copilot/interpretation-card.tsx`, 해당 분석 테스트. 작업 1 담당 파일은 수정하지 않는다.

- [x] 생활인구 2025-12 분석에 2026-06을 표시하는 현상을 테스트로 재현한다.
- [x] 해석·공유·내보내기의 지표, 단위, 출처, 기준월을 실제 분석 자료와 일치시킨다.
- [x] 혼합 자료의 서로 다른 기준월을 구분하고 분석 실패·자료 없음과 합성값을 정확히 표현한다.
- [x] 관련 분석·내보내기 회귀 테스트를 실행한다.

## 작업 3: Supabase와 Cron 운영

담당 파일: `src/lib/supabase/*`, `src/lib/data/sync-status.ts`, `src/app/api/health/route.ts`, `src/app/api/data/snapshot/route.ts`, `src/app/api/cron/sync/route.ts`, Supabase 마이그레이션과 해당 테스트.

- [x] 동일 ID 갱신 후 최신 시각과 최신 자료 선택을 검증하는 테스트를 추가한다.
- [x] `updated_at`을 갱신 시각으로 사용하고 기존 API 호환성을 유지한다.
- [x] 누리맵 전용 동기화 상태를 Supabase에 영속화하고 최소 권한을 적용한다.
- [x] 위조 `x-vercel-cron` 헤더를 거부하는 테스트를 추가하고 인증 우회 분기를 제거한다.
- [x] 실패·미게시를 성공으로 기록하지 않도록 수정하고 관련 테스트를 실행한다.
- [x] 필요한 마이그레이션을 공유 DB의 누리맵 범위에만 적용하고 읽기·쓰기·권한을 확인한다.

## 통합과 완료 기준

- [x] 변경 diff를 리뷰하고 중요 결함을 해결한다.
- [x] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`를 통과한다.
- [x] 로컬 브라우저에서 390×844, 768×1024, 1280×800, 1440×900을 확인한다.
- [x] 생활인구·카드매출·소득·유입인구, 공유 링크, 표·보고서 주요 흐름을 검증한다.
- [ ] 운영 환경으로 도메인 할당을 보류한 Vercel 배포를 확인하고, 운영 반영 후 주요 흐름과 동기화 상태를 검증한다.
