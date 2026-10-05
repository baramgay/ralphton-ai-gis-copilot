# 누리맵 운영과 검증

누리맵은 Vercel의 `ralphton-ai-gis-copilot` 프로젝트와 공유 Supabase `eum-jido`의 누리맵 전용 테이블을 사용한다. 다른 서비스의 테이블은 누리맵 배포 과정에서 수정하지 않는다.

## 게시 자료와 갱신 시각

`data_snapshots.created_at`은 최초 생성 시각, `updated_at`은 같은 자료를 갱신한 시각이다. 최신 게시 자료는 `updated_at` 순서로 선택한다. 공개 API의 `publishedAt`과 `X-Published-At`은 갱신 시각을 사용한다. `createdAt`은 기존 응답 호환성을 위해 생성 시각으로 유지한다.

통계의 기준월은 게시일과 다르다. 예를 들어 2025-12 생활인구 자료를 오늘 게시하더라도 통계 기준월은 2025-12다. 시설 갱신이 성공해도 인구·세대·출생·사망의 합성값이 실제 통계로 바뀌지는 않는다.

## 동기화 상태와 권한

`nurimap_sync_status`는 동기화 실행 상태를 Vercel 인스턴스 사이에서 공유한다. RLS를 활성화하고 공개 클라이언트의 권한을 제거했으며 서버의 서비스 역할에 SELECT·INSERT·UPDATE만 허용한다. 공개 API는 내부 오류를 이용자용 문구로 바꿔 반환한다. 로컬 파일·메모리는 오프라인 개발용 대체 경로다.

필요한 마이그레이션:

- `20261004102605_nurimap_sync_status.sql`
- `20261004102957_nurimap_sync_status_service_privileges.sql`

Supabase의 기본 권한이 서비스 역할에 넓은 권한을 부여할 수 있어 두 번째 마이그레이션에서 권한을 제거한 뒤 필요한 세 가지만 부여한다.

## Vercel Cron

운영 환경의 `CRON_SECRET`을 사용한다. Vercel은 Cron 호출에 `Authorization: Bearer <CRON_SECRET>`을 보낸다. 사용자 지정 Cron 헤더만으로 인증하지 않는다. 기존 수동 운영 경로는 `DATA_SYNC_SECRET` 검증을 유지한다. 비밀값은 소스·브라우저·로그에 기록하지 않는다.

일일 Cron은 시설 자료만 갱신하며 기존 게시 자료를 이어받는다. 인구·출생·사망의 대량 백필은 기존 수동 단계 실행 경로를 사용한다. 갱신 실패 시 마지막 정상 게시 자료를 유지한다. 게시되지 않은 실행은 최근 성공 시각을 변경하지 않는다.

## 배포 전 확인

```powershell
npm test -- --maxWorkers=4
npm run typecheck
npm run lint
npm run build
npm run start -- -p 3110
```

별도 터미널에서 주요 이용 흐름을 검사한다.

```powershell
node scripts/verify-nurimap-upgrade.mjs http://127.0.0.1:3110
npm run test:e2e
```

주요 이용 흐름 검사는 네 화면 크기, 추천 질문 실행, 네 가지 민간자료 질의, 표·보고서, 공유 링크 복원을 확인한다. 캡처는 `test-results/nurimap-upgrade`에 저장한다.

Vercel Preview에 운영 환경 변수가 없다면 정상적인 시연 모드로 동작한다. 실제 운영 설정 검증에는 운영 환경으로 도메인 할당을 보류한 배포를 사용한다. 생성된 배포 URL에서 API를 확인한 후 운영 도메인을 연결하고 실제 지도·브라우저 흐름을 다시 검증한다.

공식 참고: [Vercel 배포 환경](https://vercel.com/docs/deployments/environments), [Cron 인증](https://vercel.com/docs/cron-jobs/manage-cron-jobs), [Supabase API 보호](https://supabase.com/docs/guides/api/securing-your-api).

## 2026-10-04 변경 검증

단위 테스트 145개 파일의 1,958개 테스트, 타입 검사와 프로덕션 빌드를 통과했다. ESLint는 오류 0개, 기존 경고 51개다. 최종 코드 리뷰의 주요 결함을 해결했다. 추가 화면 검증에서 발견한 모바일 시작 안내와 하단 버튼 겹침은 화면 크기별 실제 클릭 도달성을 확인해 수정했다.

최신 빌드의 Playwright E2E 26개가 통과했다. 별도 검증으로 390×844, 768×1024, 1280×800, 1440×900 화면과 생활인구·카드매출·평균소득·유입인구의 CSV·보고서·공유 복원을 확인했다. 화면·해석·파일명·내보내기 안의 기준월과 제공기관이 일치한다.

두 마이그레이션은 누리맵 전용 테이블에 적용했다. 공개 익명 접근은 거부되며, 서비스 역할의 조회·추가·수정은 트랜잭션 안에서 확인 후 롤백했다. 서비스 역할의 최종 권한은 SELECT·INSERT·UPDATE다. 운영 Cron 비밀값을 설정했다.

## 2026-10-05 운영 반영

검증된 코드 커밋은 `98aacb1cd7a92ab118ea7cf54ef9aa4403919851`, 운영 배포는 `dpl_HXhgCnT4VNdPZmJhoMxgRKS5JJtK`다. 도메인을 할당하지 않은 운영 배포에서 health와 게시 시각을 확인하고, 위조 Cron 헤더가 HTTP 401로 거부됨을 확인한 뒤 `gnbc.site`로 승격했다. 변경 코드는 `codex/nurimap-upgrade-20261004` 브랜치에 보관한다.

인증된 시설 갱신을 실제 실행해 HTTP 200, `published: true`, 시설 4,254개를 확인했다. 인구 갱신은 0개다. 게시 갱신 시각은 2026-10-05 00:19:58.936 KST, 최근 성공은 00:20:03.023 KST다. 후속 health와 snapshot 응답에서 새 갱신 시각, `stale: false`, `recommendSync: false`를 확인했다. 인구·세대 등 합성 통계는 계속 합성값으로 안내한다.

독립 운영 검증에서 Supabase의 영속 상태와 새 health 요청 5회의 일관성을 확인했다. 시설 외 게시 자료의 digest는 `92e8be476f0f3491b6c8eff40fcd9221`로 갱신 전후 동일하다. 실제 운영 브라우저의 네 화면 크기에서 카카오 지도, 시작 안내 아래 버튼 클릭, 네 민간자료 분석과 CSV·보고서·공유 복원이 통과했다. JavaScript 페이지 오류는 0개다.

## 2026-10-05 2·3·4·5차와 후속 보완

운영 코드는 `c5e2a49af25f1c1d646f36e2a60da4091d2e6c14`, 배포는 `dpl_BYFGxJwKxYgmKNXus9Xh1LLQLPhA`이며 `gnbc.site`로 승격했다. 소스와 검증 기록은 `codex/nurimap-phases-2-5-20261005` 브랜치에 보관한다.

지역·단위·집계 분모와 실제 관측월, 검색·순위·내보내기·공유·키보드 조작, RAG의 문맥·근거 선택을 보완했다. 배경 자료 조회는 한 개씩 처리하고 요청한 분석 자료는 바로 조회한다. 최종 전체 2,059개 테스트, 타입·빌드, E2E 28개, 운영의 네 화면 크기와 검색 30개·파서 8개 검증을 통과했다. 상세 결과와 성능의 실제 한계는 `nurimap-verification-phases-2-5.md`, 수치·RAG 검증 보고서에 기록한다.

이 단계는 Supabase 테이블·게시 자료를 변경하지 않았다. 시설 실데이터 4,254개와 정상 동기화 상태를 확인했다. 인구·세대는 합성 자료이며 원격 임베딩은 미설정이다. 실제 생성 모델의 규칙 미스 질의 1개를 별도로 확인했다.
