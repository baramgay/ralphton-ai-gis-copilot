# 기존 LLM 해석 고도화 구현 계획

> **For agentic workers:** Use subagent-driven-development to implement independently scoped tasks.

**Goal:** 원격 임베딩 없이 질문 해석의 지역 정확도·응답 검증을 높이고 불필요한 LLM 호출과 대기를 줄인다.

**Architecture:** 기존 규칙 우선 흐름을 유지한다. 지역 사전 확인, 근거 한정 프롬프트, 출력 검증과 보정 요청을 추가한다.

**Tech Stack:** Next.js, TypeScript, Zod, Vitest, Playwright, 기존 DeepSeek API.

## 제약

새 의존성·모델 업그레이드·유료 Vercel·DB 변경을 추가하지 않는다. 사용자 파일과 이전 검증 기록을 보존한다.

- [ ] 실제 운영 HTTP 기준 질문의 변경 전 결과·지연을 기록한다.
- [ ] 동명이동 확인과 정식 지역 선택을 독립 테스트로 재현·수정한다.
- [ ] LLM 지역 조건·근거 검증 및 한 번의 보정 요청을 실패 테스트부터 구현한다.
- [ ] DeepSeek thinking 비활성화·출력 한도·응답 완료/본문 제한·총 시간 예산을 테스트한다.
- [ ] UI의 직접 레이어 분석에도 지역 모호성 확인을 적용하고 테스트한다.
- [ ] 관련 검사, 전체 단위, 타입, lint, 빌드와 실제 HTTP 비교를 수행한다.
- [ ] 변경 및 제한을 보고서에 기록하고 push·운영 배포·실제 운영 검증을 수행한다.
