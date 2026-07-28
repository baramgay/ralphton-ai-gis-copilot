# Sonnet 위임 지시서 — 랄프톤 검증·반복 작업

이 문서를 **별도 세션에서 Sonnet에게 그대로 붙여** 쓴다. 결과는 Opus가 크로스체크한다.

프로젝트: `C:\업무\랄프톤` · prod: https://ralphton-ai-gis-copilot.vercel.app

---

## 0. 이 프로젝트에서 절대 어기면 안 되는 것

1. **로컬만 확인하고 "완료"라고 하지 않는다.** 검증은 배포 URL 기준이다. 유닛테스트 통과는
   정합성의 증거가 아니다 — 이 프로젝트의 주요 결함은 **거의 전부** 유닛테스트가 전부
   통과하는 상태에서 prod 브라우저로만 드러났다.
2. **`DATA_SYNC_SECRET`(.env.local) 값을 출력하지 않는다.**
3. **한글을 curl 인라인 `-d`로 보내지 않는다.** Git Bash가 UTF-8이 아니라 깨진다.
   node `fetch`나 `--data-binary @파일`을 쓴다.
4. **`npx next start`가 떠 있는 상태에서 `npm run build`를 하지 않는다.** 실행 중인 서버가
   사라진 청크를 서빙해서 CSS 없는 화면이 나온다(실제로 겪었고 원인 찾는 데 오래 걸렸다).
   서버를 먼저 죽인다. `pkill`은 이 환경에 없다:
   ```powershell
   Get-NetTCPConnection -LocalPort 3110 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
   ```
5. **테스트를 통과시키려고 테스트를 고치지 않는다.** 고쳐야 한다면 반드시 **결함을 되주입**해
   그 테스트가 실패하는 것을 먼저 확인하고, 확인 사실을 보고에 적는다.

---

## 1. 정기 회귀 (배포할 때마다)

상시 회귀 스크립트는 **`scripts/prod-checks/`에 버전관리**돼 있다. 기대값과 읽는 법은
그 안의 `README.md`가 정본이다. 일회성 재현 스크립트만 `.prod-*.mjs`(gitignore)로 둔다.

```bash
cd /c/업무/랄프톤
node scripts/prod-checks/sweep.mjs      # 라우팅 56건 — 질의가 의도한 지표로 가는가
node scripts/prod-checks/values.mjs     # 값 대조 46건 — 화면 1위 = 큐브에서 독립 계산한 1위
node scripts/prod-checks/hard.mjs       # 방향·지역·범위 밖
node scripts/prod-checks/round5.mjs     # 정책 시나리오 12건
node scripts/prod-checks/round6.mjs     # 실무 표현 14건
node scripts/prod-checks/round7.mjs     # 개수 지정·오검출·선택 추종
node scripts/prod-checks/round8.mjs     # 다중조건(3지표 이상)
node scripts/prod-checks/surfaces.mjs   # 내보내기·공유·프로파일
```

**기대값**
| 스크립트 | 통과 기준 |
|---|---|
| sweep | 56/56 |
| values | 46/46 |
| hard | 방향 6/6 |
| round5 | 답함 11 · 되물음 1 · 실패 0 |
| round6 | 답함 14 · 되물음 0 · 실패 0 |
| round7 | 개수 3/3 · 오검출 0 · 선택 1위 |
| round8 | 5/5 |
| 전부 | **JS 에러 0건** |

로컬 스위트:
```bash
npx tsc --noEmit                    # 0
npx vitest run                      # 1,135개 전부 통과
npx eslint src --max-warnings=9999  # 0 errors (warning 6건은 기존)
npm run build                       # 통과
npx playwright test                 # 16개 전부 통과
```

**숫자가 하나라도 어긋나면 그 자리에서 멈추고 보고한다.** 스스로 고치려 들지 말고,
어떤 질의가 어떻게 틀렸는지(화면 글자 그대로) 옮겨 적는다.

---

## 2. 새 자연어 질의 검증 (반복 업무)

목적은 "되는 걸 확인"이 아니라 **틀리는 걸 찾는 것**이다.

### 방법
`.prod-round6.mjs`를 복사해 질의 목록만 바꾼다. 화면에서 읽을 것:
- `[data-testid=query-notice]` — 어떻게 해석했다고 말하는가
- `[data-testid=one-line-conclusion]` — 한 줄 결론
- `.rank-row` 개수와 `.rank-name` / `.rank-value`
- `[data-testid=stale-answer-notice]` — 이게 보이면 **답하지 못한 것**이다

### 판정 기준 (중요)
- **행이 0인데 안내가 정상**이면 실패다. 사용자는 "데이터가 없구나"로 읽는다.
- **물어본 것보다 적게 답하면** 실패다. 지표 셋을 물었는데 하나로 답하는 식.
- **방향이 반대면** 실패다. "적은 곳"에 가장 많은 곳이 1위로 나오는 식.
- **경고 없이 범위 밖을 답하면** 실패다. "부산 소득"에 경남 순위를 주는 식.
- 되물음(`혹시 …인가요`)은 실패가 아니다. 틀린 답보다 낫다.

### 아직 안 밟은 표현들 (여기서 시작하라)
```
"작년보다 소비 늘고 인구 준 동"
"20대가 많이 사는 동네"
"주말에 사람 몰리는 곳"
"출퇴근 인구 차이 큰 시군구"
"1인가구 많고 소득 낮은 동"
"창원이랑 김해 중 어디가 나은가"
"의료도 부족하고 소비도 적은 곳 5곳만"
"격자로 봤을 때 소득 낮은 블록"
"고령 비중 높은데 병원은 없는 동"
"카드매출 대비 생활인구가 적은 곳"
```

---

## 3. 반복 작업 위임 규칙

### 해도 되는 것
- 위 회귀 스크립트 실행과 결과 정리
- 새 질의 목록으로 검증 스크립트 만들어 돌리기
- 스크린샷 촬영(`.prod-uishot.mjs`, `SHOT_TAG=이름 node .prod-uishot.mjs`)
- 실패 재현 절차 정리(어떤 질의 → 어떤 화면 글자)

### 하지 말 것 (Opus 확인 후)
- `src/components/copilot/copilot-app.tsx` 수정 — 4,400줄이고 상태 배선이 얽혀 있다
- `src/lib/layers/catalog.ts`의 트리거 추가 — 다른 지표를 뺏어갈 수 있다.
  실제로 "상권 성장"이 인구로 새고 "약국 없는 동"이 시설 검색으로 샌 적이 있다
- 어댑터(`scripts/adapters/*.mjs`) 재실행 — 원자료 경로·인코딩 함정이 많다
- git commit / push
- 검증 스크립트의 **판정 로직** 수정

---

## 4. 보고 형식

```
## 실행한 것
(스크립트명과 결과 숫자만)

## 어긋난 것
질의: "…"
기대: …
실제: (화면 글자 그대로 붙여넣기)
재현: 1) … 2) …

## 판단이 필요한 것
(고쳐야 할지 애매한 것. 스스로 고치지 말고 여기 적는다)
```

---

## 5. 지금 열려 있는 과제 (참고)

- **데이터 거버넌스 미결**: 민간데이터가 public GitHub 레포에 커밋돼 있다.
  Vercel 환경변수만으로는 안 닫힌다. 사용자 결정 대기.
- **농촌 210개 읍면동이 격자 레이어에서 빠짐**: KCB 비식별 기준(3명 미만 누락) 탓.
  도 담당자 확인 대기.
- **배포 직후 첫 방문자 콜드스타트 8초대**(이후 1.2초).
