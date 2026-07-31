# 인구 live 피드는 한 번도 동작한 적이 없다 (2026-07-31 실측)

`mode: "live"` 스냅샷의 인구·세대가 계속 합성값인 이유를 추적한 결과. 결론부터:
**월 공개 지연 문제가 아니다. 요청 자체가 API 규격과 다르다.**

행정안전부 주민등록 인구·세대현황
`/1741000/admmPpltnHhStus/selectAdmmPpltnHhStus`

## 서로 독립된 결함 4개 — 하나만 있어도 0행이 된다

| # | 코드가 보내는 것 | API가 요구하는 것 | 증상 |
|---|---|---|---|
| 1 | `stdgMtrYm=202606` | `srchFrYm`·`srchToYm` (필수) | `NO_MANDATORY_REQUEST_PARAMETERS_ERROR` |
| 2 | `ctpvCd=48` (시도) | `admmCd` **10자리 읍면동** (필수) | 시도·시군구 코드는 `NODATA_ERROR` |
| 3 | `response.body.items` 탐색 | `Response.items.item` | 파싱 0행(응답은 정상) |
| 4 | `totNmpr`·`ppltnCnt`·`totPop` | `totNmprCnt` | 인구 필드를 못 읽음 |

`buildPublicDataUrl`(`public-api.ts`)이 1·2를, `fetchAllPublicDataPages`가 3을,
`asPopulation`(`population-live.ts`)이 4를 담당한다.

재현 순서 (오류 코드가 단계마다 바뀌는 것이 증거다):

```
파라미터 없음               → code=11 NO_MANDATORY_REQUEST_PARAMETERS
+ ctpvCd=48                → code=11  (여전히 필수 누락)
+ admmCd=48                → code=10 INVALID_REQUEST_PARAMETER  ← admmCd가 필수임이 드러남
+ admmCd=4800000000, 6개월  → code=13 QUERY_PERIOD_LIMIT_EXCEEDED ← 코드 형식은 통과
+ 1개월, 시도/시군구 코드     → code=3  NODATA_ERROR
+ 1개월, 읍면동 10자리        → code=0  NORMAL_SERVICE  total=61   ✅
```

## 확인된 규격

- **필수**: `serviceKey`, `admmCd`(읍면동 10자리), `srchFrYm`, `srchToYm`
- **기간 한도**: 한 번에 **최대 4개월** (5개월부터 `QUERY_PERIOD_LIMIT_EXCEEDED`)
- **응답 경로**: `Response.items.item` / 헤더는 `Response.head`
- **행 단위**: 통·반. 한 읍면동·한 달에 40~70행(대형 동은 수백)
- **집계**: 통·반 행은 서로 겹치지 않으므로 **단순 합산이 맞다**.
  통 합계·동 합계 같은 중복 행은 없다. `tong`·`ban`이 빈 행이 하나 있는데
  거주불명자로 보이며 합산 대상이다(문산읍 202603: 61행 합계 7,396명, 그중 빈 행 8명).
- **필드**: `admmCd`, `statsYm`, `totNmprCnt`(총인원), `hhCnt`(세대), `hhNmpr`(세대당 인구),
  `maleNmprCnt`, `femlNmprCnt`, `ctpvNm`, `sggNm`, `dongNm`, `tong`, `ban`

## 공개 지연은 없다

`202606`(스냅샷 기준월)이 그대로 조회된다. `monthCandidates`의 3개월 폴백은 이 API에는
필요 없다 — 그 전제(1~2개월 지연)는 다른 데이터셋 경험에서 온 것으로 보인다.

## 호출량

읍면동당 4개월씩 끊어 13개월을 채우면 **동당 4회**(4+4+4+1). 경남 305개 읍면동 →

```
305 × 4 = 1,220회   (인구·세대 13개월 전체)
```

대부분 1페이지(`numOfRows=1000`)로 끝난다. 대형 동은 `totalCount`로 페이지를 판단해야 한다.

고령·청년(`ageSexPopulation`), 출생(`births`), 사망(`deaths`), 1인가구(`onePersonHouseholds`)도
같은 `1741000` 계열이라 **같은 규격일 가능성이 높다**(미확인). 전부 채우면 5배 ≈ 6,100회.

## 합성값이 실제와 얼마나 다른가

```
양산시 물금읍  실데이터 116,610명   vs   스냅샷(합성) 50,000명   — 2.3배
```

물금읍은 전국에서 손꼽히는 대형 읍이다. 합성 스냅샷은 규모 자체를 못 담고 있다.
지금 화면의 인구 순위는 **실제 순위와 다르다**.

## 그래서 무엇을 해야 하나

1. `buildPublicDataUrl`에 `admmCd`·`srchFrYm`·`srchToYm`을 넣고 `ctpvCd`/`stdgMtrYm` 경로를 걷어낸다
2. 응답 파서에 `Response.items.item` 경로를 추가한다
3. `asPopulation` 후보에 `totNmprCnt`를 넣는다
4. `fetchAndMergeRegionalPopulation`을 **읍면동 순회**로 바꾼다(현재는 시도 1회 호출 전제)
5. `mergeLatestPopulation`(최신월 한 칸)을 **시계열 백필**로 확장한다

**순서가 중요하다.** 1~4만 하고 5를 안 하면 실측 1개월 + 합성 12개월이 되어, 12개월 추세가
실측과 합성의 단차를 줄 세운다 — 지금보다 나쁘다.

## 확인 방법

`.env.local`의 `DATA_GO_KR_SERVICE_KEY`로 아래를 던지면 위 결과가 재현된다.

```
GET https://apis.data.go.kr/1741000/admmPpltnHhStus/selectAdmmPpltnHhStus
    ?serviceKey=…&type=json&pageNo=1&numOfRows=1000
    &admmCd=4817025000&srchFrYm=202603&srchToYm=202603
```
