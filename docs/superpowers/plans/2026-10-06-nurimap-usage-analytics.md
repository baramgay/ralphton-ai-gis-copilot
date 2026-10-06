# 사용 통계 대시보드 구현 계획

> **For agentic workers:** Use subagent-driven-development with separate backend, dashboard and integration ownership.

**Goal:** 익명 일별 집계와 관리자 대시보드로 방문·성공 분석·데이터 사용을 정확한 정의와 함께 시각화한다.

**Architecture:** 클라이언트 배치 이벤트 → 동일 출처 수집 API → 서버 전용 원자적 Supabase 집계 → 인증된 통계 API → 반응형 SVG 차트·표.

**Tech Stack:** 기존 Next.js/React/TypeScript/Zod/Supabase, 추가 라이브러리 없음.

- [x] 스키마·KST 집계·중복 제거·비허용 필드 테스트 및 구현.
- [x] 관리자 인증·기간 검증·조회 실패 테스트 및 구현.
- [x] 클라이언트 표식 갱신·재전송·수집 장애 테스트 및 성공 분석 연결.
- [x] 대시보드 로그인·일주월·빈 상태·오류·CSV 테스트 및 시각 검증.
- [x] 전용 DB 변경만 적용하고 롤백 트랜잭션으로 합계·권한을 검증.
- [x] 관리자 비밀값을 Git·채팅에 노출하지 않고 Production 환경에 설정.
- [x] 전체 검사·빌드·push·운영 배포 후 실제 이벤트와 관리자 화면 검증.
