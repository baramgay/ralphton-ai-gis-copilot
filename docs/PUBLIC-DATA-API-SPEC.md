# 공공데이터 5종 규격표 (행정안전부 `1741000` 계열)

> 실측/추정 구분을 반드시 지킨다. 안 두드려 본 것을 두드려 본 것처럼 적으면 다음
> 사람이 그 위에 코드를 쌓는다 — 인구 결함이 정확히 그렇게 생겼다.

> **2026-08-04 개정 — 아래 표는 대조군 실험으로 다시 썼다.** 이전 판은 4종을 전부
> "접근 자체가 막힘, 원인 미확정"으로 적었는데, 그중 **2종은 경로가 틀린 코드 결함**이었고
> 사망은 올바른 경로로 부르면 **이미 승인돼 있어 바로 200**이 온다. 아래 "오라클" 참고.

| 데이터셋 | 엔드포인트 | 접근 상태 | 상태 근거 |
|---|---|---|---|
| 인구·세대(residentPopulation) | `/1741000/admmPpltnHhStus/selectAdmmPpltnHhStus` | ✅ **정상** | HTTP 200, resultCode=0 |
| 사망(deaths) | `/1741000/admmSexdAgeErsr/selectAdmmSexdAgeErsr` | ✅ **정상 — 경로만 고치면 됨** | HTTP 200 (실측 2026-08-04) |
| 고령·청년(ageSexPopulation) | `/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn` | 🔑 **경로 있음, 이 키 미승인** | 403 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` |
| 1인가구(onePersonHouseholds) | `/1741000/admmSexdAgeOneHh/selectAdmmSexdAgeOneHh` | 🔑 **경로 있음, 이 키 미승인** | 403 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` |
| 출생(births) | ❓ **미확인** (코드의 `admmBrthRegist`는 없는 경로) | ❌ 경로 이름을 모른다 | 후보 15개 전부 `NO_OPENAPI_SERVICE_ERROR` |

**코드가 들고 있던 사망 경로 `/1741000/admmDthRegist/selectAdmmDthRegist`는 존재하지
않는다.** 실제 이름은 `admmSexdAgeErsr`(사망**말소**자수)다. 출생도 마찬가지로 코드의
`admmBrthRegist`가 없는 경로이며, 올바른 이름은 아직 못 찾았다
([포털 15108075](https://www.data.go.kr/data/15108075/openapi.do)의 "요청주소"를 직접
봐야 한다 — 로그인 없이 보이는지 미확인).

## 오라클 — 세 응답을 가르면 원인이 갈린다

키를 일부러 틀리게 준 요청, 없는 경로(`admmZZZZZZ`) 요청을 대조군으로 두고 실측했다.

| 응답 | 뜻 |
|---|---|
| `HTTP 200` | 경로 있음 + 이 키 승인됨 |
| `HTTP 403` + `SERVICE_KEY_IS_NOT_REGISTERED_ERROR` | **경로는 있고** 이 키가 그 오퍼레이션에 미승인 |
| `HTTP 400` + `NO_OPENAPI_SERVICE_ERROR` | **그 경로에 오픈API 자체가 없음** (이름이 틀림) |

> **교훈: 두 실패가 다른 원인인지 보려면 일부러 틀린 요청을 하나 끼워 넣어라.**
> 이전 판은 정상 요청만 여러 번 던져 "전부 막혔다"까지만 봤다. 무엇에 막혔는지는
> **틀린 키·없는 경로와 비교해야** 보인다. 대조군 없이 얻은 실패는 증상이지 진단이 아니다.
>
> 이전 판이 본 `HTTP 500 Unexpected errors`는 지금 재현되지 않는다(일시적이었다).
> 지금은 없는 경로 대조군과 **완전히 같은** 400을 낸다.

재현: `.probe-403-control.mjs`, `.probe-endpoints.mjs` (키 값은 출력하지 않는다).

---

## 1. 인구·세대(residentPopulation) — 실측 완료, 코드에 이미 반영됨(`229f531`)

| 항목 | 값 | 구분 |
|---|---|---|
| 필수 파라미터 | `serviceKey`, `admmCd`(읍면동 10자리), `srchFrYm`, `srchToYm` | 실측 |
| 기간 한도 | 4개월(5개월부터 `QUERY_PERIOD_LIMIT_EXCEEDED`) | 실측 |
| 응답 경로 | `Response.items.item[]` · 헤더 `Response.head` | 실측 |
| 행 단위 | 통·반(겹치지 않음 → 단순 합산 가능) | 실측 |
| 인구 필드 | `totNmprCnt` | 실측 |
| 세대 필드 | `hhCnt` | 실측 |
| 공개 지연 | 없음(202606 조회됨) | 실측 |

세부: `docs/POPULATION-API-FINDINGS.md` 참고.

---

## 2. 사망(deaths) — 경로만 고치면 **바로 쓸 수 있다**

`/1741000/admmSexdAgeErsr/selectAdmmSexdAgeErsr` · 인구와 같은 파라미터
(`admmCd`·`srchFrYm`·`srchToYm`)로 **HTTP 200**이 온다. 데이터셋 이름은
"행정동별(통반단위) 성/연령별 **사망말소자수**"
([포털 15108077](https://www.data.go.kr/data/15108077/openapi.do)).

**아직 확인 안 한 것**: 필드명, 행 단위(통·반인지 성×연령인지), **합계 행 유무**.
성/연령별이라 소계·합계 행이 섞여 있으면 단순 합산이 사망자를 부풀린다 — 인구에서
`totNmprCnt`를 못 찾아 0행으로 읽던 것과 같은 함정이다. 실제 행을 눈으로 보고 나서
어댑터를 짠다.

## 3~4. 고령·청년, 1인가구 — 경로는 맞고 **활용신청이 필요하다**

두 경로 모두 `SERVICE_KEY_IS_NOT_REGISTERED_ERROR`다. 정상 키와 일부러 틀린 키가
**같은 응답**을 내므로, 이 메시지는 "이 키가 이 오퍼레이션에 등록돼 있지 않다"는 뜻이다.
data.go.kr은 같은 제공기관 안에서도 오퍼레이션마다 별도 활용신청이 필요하다.

→ **조치: data.go.kr 마이페이지에서 해당 API 활용신청** (계정 보유자만 가능).
승인되면 코드 수정 없이 바로 호출된다.

같은 계열에서 앞으로 쓸 만한 것도 미승인 상태다: 인구증감 `admmSexdPpltnIrds`.

## 5. 출생(births) — 경로 이름을 모른다

코드의 `admmBrthRegist`는 없는 경로다. 이름 후보 15개
(`admmSexdBrth`·`admmSexdBrthRegist`·`admmSexdBrthRgst`·`admmSexdBirth`·`admmSexdNtvt` 등)
를 전부 두드렸으나 모두 `NO_OPENAPI_SERVICE_ERROR`였다. 사망이 `admmSexdAgeErsr`인 것으로
보아 명명 규칙을 추측으로 맞히기는 어렵다.

→ **조치: [포털 15108075](https://www.data.go.kr/data/15108075/openapi.do)의 "요청주소"를
직접 확인.** 웹 검색으로는 사망(15108077)만 나오고 출생은 안 나왔다.

### 남은 공통 미확인 사항

4종 모두 **필드명·행 단위·합산 규칙·최신 가용월**은 미확인이다. 인구와 같은 계열이라
규격이 같을 것이라는 가설은 여전히 **검증되지 않았다** — 사망 하나만 200을 받았을 뿐
응답 본문을 아직 안 뜯었다. 이 문서를 근거로 인구용 파서를 그대로 적용하면 안 된다.
