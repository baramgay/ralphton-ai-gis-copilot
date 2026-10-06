# 누리맵 직관적 분석 화면 구현 계획

> **For agentic workers:** Use subagent-driven-development with isolated catalog, brand, analysis-method and root integration ownership.

**Goal:** 목적별 자료 탐색과 현재 조건 중심 사이드바로 첫 사용자의 기능 파악과 분석 실행을 단순화한다.

**Architecture:** 기존 실행 핸들러는 루트에 유지한다. 자료 탐색·분석 방식은 표시와 선택만 맡는 컴포넌트로 분리한다. 실제 결과의 조건과 출처를 표시하고 내부 의료 레이어 상태가 다른 분석에 노출되는 것을 막는다.

**Tech Stack:** 기존 Next.js/React/TypeScript/Vitest/Playwright, native dialog, SVG/PNG/ICO. 새 의존성 없음.

- [x] 운영 화면과 초기·추세·수동 선택의 컨텍스트 문제를 재현한다.
- [x] 목적별 자료 탐색과 키보드 동작을 구현·검증한다.
- [x] 분석 방식 선택과 필요한 프리셋만 표시한다.
- [x] 로고·파비콘을 통일하고 작은 크기와 metadata를 확인한다.
- [x] 사이드바·질문 영역·현재 실행 조건을 통합하고 테마·모바일 레이아웃을 개편한다.
- [x] 기존 의미 있는 테스트를 새 동선으로 갱신하고 전체 검사·E2E·수치·RAG 회귀를 실행한다.
- [x] 실제 화면과 사용자 시나리오를 검증하고 push·배포·운영 확인을 마친다.
