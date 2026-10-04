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
