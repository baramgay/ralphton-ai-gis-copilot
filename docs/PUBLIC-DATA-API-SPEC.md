# 공공데이터 5종 규격표 (행정안전부 `1741000` 계열)

> 실측/추정 구분을 반드시 지킨다. 안 두드려 본 것을 두드려 본 것처럼 적으면 다음
> 사람이 그 위에 코드를 쌓는다 — 인구 결함이 정확히 그렇게 생겼다.

| 데이터셋 | 엔드포인트 | 접근 상태 | 상태 근거 |
|---|---|---|---|
| 인구·세대(residentPopulation) | `/1741000/admmPpltnHhStus/selectAdmmPpltnHhStus` | ✅ **실측 완료·정상** | HTTP 200, resultCode=0 |
| 고령·청년(ageSexPopulation) | `/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn` | ❌ **HTTP 403 Forbidden** | 실측 |
| 1인가구(onePersonHouseholds) | `/1741000/admmSexdAgeOneHh/selectAdmmSexdAgeOneHh` | ❌ **HTTP 403 Forbidden** | 실측 |
| 출생(births) | `/1741000/admmBrthRegist/selectAdmmBrthRegist` | ❌ **HTTP 500 Unexpected errors** | 실측 |
| 사망(deaths) | `/1741000/admmDthRegist/selectAdmmDthRegist` | ❌ **HTTP 500 Unexpected errors** | 실측 |

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

## 2~5. 나머지 4개 — **전부 접근 자체가 막혀 있다(파라미터 문제 아님)**

`docs/PUBLIC-DATA-SPEC-2026-08-01.md`에 재현 과정을 실었다. 요지:

- **고령·청년·1인가구 2종**: 파라미터를 비우든 채우든 항상 **HTTP 403 Forbidden**
  (본문이 JSON도 아닌 평문 "Forbidden"). data.go.kr은 같은 제공기관(행정안전부)
  안에서도 **데이터셋마다 별도 활용신청·승인이 필요**한 구조다 — 이 서비스키가
  `admmPpltnHhStus`(인구·세대)에는 승인돼 있지만 `admmSexdAgePpltn`·`admmSexdAgeOneHh`
  에는 승인이 안 되어 있을 가능성이 가장 크다(활용신청 화면을 직접 확인 못 했다 —
  **추정**).
- **출생·사망 2종**: 파라미터를 비우든 채우든 항상 **HTTP 500 Unexpected errors**.
  403과 다른 신호라 원인이 다를 수 있다 — 엔드포인트 경로 자체가 실제 카탈로그와
  다르거나, 서비스 쪽 장애일 수 있다(**추정**, 확정 못 함).

**따라서 이 4개의 필수 파라미터·기간 한도·응답 경로·필드명·행 단위·합산 규칙은 전부
"미확인"이다.** 인구와 같은 계열이라 규격이 같을 것이라는 가설은 **검증되지 못했다**
— 접근조차 안 됐기 때문이다. 이 문서를 근거로 인구와 동일한 파서를 이 4개에
그대로 적용하면 안 된다.

### 코드와의 불일치(현재 코드 기준)

`src/lib/data/public-api.ts`의 `PUBLIC_DATA_ENDPOINTS`에 이 4개 경로가 이미
등록돼 있고, `buildPublicDataUrl`이 인구와 동일한 파라미터 형식(`admmCd`,
`srchFrYm`/`srchToYm`)으로 URL을 만든다. **코드 자체는 인구 수정 때 같이
정리됐지만, 실제로 호출하면 위 오류만 돌아온다.** 어댑터(필드명 후보 목록 등)는
아직 인구용 그대로이며 이 4개 전용 필드는 하나도 없다 — 애초에 정상 응답을
못 받아서 확인할 수 없었다.
