# 누리맵 신뢰도와 사용자 경험 개선 실행 계획

> **For agentic workers:** Use subagent-driven-development to implement and review independent tasks, followed by whole-release verification.

**Goal:** 사용자 중심으로 UI를 전면 개편하고 검색·공식 통계·임베딩·운영 회귀 검증의 확인된 한계를 개선하여 push 및 배포한다.

**Architecture:** 기존 분석과 공유·내보내기 계약을 유지하며 표시 구조를 다시 설계한다. 자료와 검색의 의미 및 유효성을 원천에서 검증하고, 외부 서비스 접근 여부는 실측한다.

**Tech Stack:** Next.js, React, TypeScript, Vitest, Playwright, Supabase, Vercel.

## 제약

미확보 자료 및 미실행 원격 시험은 완료로 표시하지 않는다. 기존 `scripts/adapters/nh-blocks.mjs`와 `supabase/.temp/`를 보존한다. UI·데이터·RAG 담당을 분리하고 공통 파일 수정은 협의한다.

## 단계와 확인 기준

- [ ] RAG 담당: 고정 24개 사례를 보존하고 의역·대조·부정 사례를 추가한다. 실패 재현 후 수정하며 `node scripts/verify-rag.mjs trust-upgrade`와 관련 Vitest에서 품질·무근거 차단을 확인한다.
- [ ] 데이터 담당: 공식 자료와 기준 기간·지역 코드를 확보하여 기존 통계 파이프라인에 연결한다. 원자료 합계·비율·결측을 독립 검증하고 관련 데이터 테스트를 실행한다. 접근할 수 없는 지표는 명시적으로 미완료로 남긴다.
- [ ] UI 담당: 운영의 데스크톱·모바일 화면을 인식하고 사용자 흐름 중심의 구조를 설계한다. 질문, 결과, 지도, 비교, 공유, 내보내기를 전면 재구성하고 관련 컴포넌트 및 E2E와 화면 캡처로 확인한다.
- [ ] Root: 원격 응답·캐시의 잘못된 순서, 비정상 수치, 모델·제공자 변경, 코퍼스 변경과 배치 제한을 실패 테스트로 재현해 수정한다. 같은 평가로 로컬·원격 비교하는 스크립트와 운영 회귀 작업을 추가한다.
- [ ] 통합: `npm test -- --maxWorkers=4`, `npm run typecheck`, `npm run lint`, `npm run build`, `npx playwright test --output logs/nurimap-trust-e2e-output`, `node scripts/verify-nurimap-numerics.mjs public/data/official-snapshot.json`를 실행하고 보고서를 확인한다. 테스트 실패는 원인과 사용자 동작을 기준으로 해결한다.
- [ ] 출시: 검증한 변경만 commit·push하고 운영 설정으로 도메인 연결을 보류한 배포를 검사한다. 성공한 배포를 승격한 다음 운영 검색·파서·네 화면 크기·실데이터·공유·내보내기를 재검증하고 소스 SHA와 배포 ID를 기록한다.
