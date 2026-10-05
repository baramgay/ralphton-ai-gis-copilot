# 그록봇 전달 지시서: 누리맵 원격 임베딩 연결

## 대상과 목적

운영 사이트는 https://gnbc.site/ 이다. Vercel 팀은 `na-da-s-projects`, 프로젝트는 `ralphton-ai-gis-copilot`, 프로젝트 ID는 `prj_rjSs4K0daYP0lJfGeZH27ZIB25Eb`이다. 코드의 로컬 검색, UI 개편, 공식 통계 연결과 배포는 개발 에이전트가 진행한다. 그록봇은 사용자의 계정에서 원격 임베딩의 접근 설정만 수행한다.

2026-10-05 실제 Vercel AI Gateway OIDC 요청이 HTTP 403, `customer_verification_required`를 반환했다. 서비스 응답은 결제수단 등록을 요구했다. 모델 사용량은 0이며 실제 원격 검색 품질 평가는 실행되지 않았다. 비밀키, 토큰, 결제정보를 채팅·문서·스크린샷·Git에 기록하지 않는다.

## 권장 경로: Vercel AI Gateway

1. https://vercel.com/na-da-s-projects 에서 정확한 팀인지 확인한다. AI Gateway 화면에서 현재 등록 상태와 사용 가능 여부를 확인한다. 공식 안내는 https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc 이다.
2. 계정이 결제수단을 요구하면 사용자가 직접 입력하도록 한다. 자동 결제정보 추정, 구독 변경, 잔액 충전 또는 과금 확대를 수행하지 않는다.
3. AI Gateway가 사용 가능해지면 필요한 API 키를 만든다. 모델은 현재 지원되는 `openai/text-embedding-3-small`을 모델 목록에서 확인한다. 키 값은 직접 Vercel 환경변수 입력란에 넣고 대화로 반환하지 않는다.
4. 프로젝트 Settings → Environment Variables에서 Production에 아래 세 변수를 설정한다. Preview나 다른 프로젝트에는 운영 키를 복제하지 않는다.

| 변수 | 값 |
| --- | --- |
| `EMBED_API_KEY` | 방금 만든 AI Gateway 키. 문서에 실제 값을 넣지 않는다. |
| `EMBED_BASE_URL` | `https://ai-gateway.vercel.sh/v1` |
| `EMBED_MODEL` | `openai/text-embedding-3-small` |

5. 품질 비교 전에는 `RAG_REMOTE_EMBED=1`을 추가하지 않는다. 개발 에이전트가 동일 질문으로 정확도·무근거 차단·지연을 확인한 뒤 운영 활성화 여부를 결정한다. 기존 코드는 `EMBED_MODEL` 존재도 활성화 조건으로 사용하므로, 위 환경변수의 저장만 하고 직접 재배포하지 않는다. 에이전트에 설정 완료를 알리고 검증·배포를 맡긴다.

## 대안: 기존 임베딩 서비스

이미 접근 가능한 OpenAI 호환 임베딩 서비스가 있으면 새 서비스 가입 없이 그 서비스의 키·기본 URL·정확한 모델 ID를 같은 `EMBED_*` 변수에 설정한다. 현재 채팅용 DeepSeek 키를 임베딩 키로 재사용하지 않는다. 모델의 한국어 지원, 입력 한도, 가격, `/embeddings` 호환 여부를 공식 문서로 확인한다. 값을 설정한 후 모델 ID와 설정 완료 여부만 알려준다.

## 개발 에이전트가 수행할 완료 검증

설정 후 다음 명령을 실행한다. 로컬 환경변수를 최신화할 때는 사용자 `.env.local`을 덮어쓰지 않고 별도 파일에 받으며, 평가 프로세스에만 안전하게 전달한다.

```powershell
node scripts/verify-rag-remote.mjs
node scripts/verify-rag-remote-api.mjs https://gnbc.site
node scripts/verify-rag.mjs release --assert
node scripts/verify-nurimap-rag-api.mjs https://gnbc.site
```

로컬 원격 평가는 `test-results/nurimap-rag-remote.json`에 상태, 요청 수, 토큰 사용량, 같은 질문의 로컬·원격 순위, p50/p95 지연을 저장한다. Production의 민감한 키를 로컬로 내려받을 수 없으면 `verify-rag-remote-api.mjs`로 배포된 서버를 직접 비교한다. 이 경우 `test-results/nurimap-rag-remote-api.json`의 실제 원격 적용과 HTTP 지연을 확인하고 비용·토큰은 제공자 대시보드에서 별도로 확인한다. 종료 코드 0은 실제 원격 적용과 품질 회귀 없음, 1은 품질 회귀, 2는 자격·서비스·시간 제한으로 실제 평가 미완료다. 로컬 fallback을 실제 원격 성공으로 보고하지 않는다. 운영 재배포 후 검색 응답의 `remoteEmbed: true`와 파서 근거를 확인해야 한다.

## 그록봇이 반환할 내용

- 접속한 팀과 프로젝트 이름
- Gateway 사용 가능 여부 또는 정확한 실패 상태
- Production에 설정한 변수 이름과 모델 ID. 실제 키는 제외
- 직접 결제·계정 인증이 남아 있다면 해당 화면과 필요한 조치
- 설정 저장 여부. 재배포와 품질 확인은 개발 에이전트가 수행한다.

## 복사해서 전달할 메시지

> 첨부한 `nurimap-grokbot-instructions.md`대로 누리맵의 Vercel 원격 임베딩 연결 설정을 진행해 주세요. 대상은 `na-da-s-projects / ralphton-ai-gis-copilot`입니다. 실제 연결은 `403 customer_verification_required`로 차단됐으므로 Gateway 사용 가능 상태부터 확인하세요. 결제정보는 제가 직접 입력하게 하고, 키는 Production의 `EMBED_API_KEY`, URL은 `EMBED_BASE_URL`, 확인한 모델은 `EMBED_MODEL`에 직접 저장하세요. 비밀값은 대화·스크린샷에 남기지 마세요. 다른 프로젝트·Supabase·기존 채팅키는 변경하지 말고 직접 재배포도 하지 마세요. 완료하면 설정한 변수 이름, 모델 ID, 서비스 사용 가능 여부만 알려주세요. 코드 개선과 품질 비교·배포는 개발 에이전트가 이어서 진행합니다.

공식 참고: https://vercel.com/docs/ai-gateway/modalities/embeddings , https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/embeddings .
