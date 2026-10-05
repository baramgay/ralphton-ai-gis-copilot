# 공식 주민등록 자료 연결 및 갱신

2026-10-05에 행정안전부 주민등록 인구통계의 공개 다운로드 폼과 실제 응답을 확인했다. 사이트의 최신 선택 월은 2026-09였다. 2025-09~2026-09의 13개월을 확보했고, 기존 지도 경계 305개 행정동에 연결했다. 전국 원본 CSV는 임시 디렉터리에 보관하며 저장소에는 경남 분석 스냅샷과 원본 SHA-256 manifest만 포함한다.

## 출처·정의·이용 조건

- [주민등록 인구 및 세대현황](https://jumin.mois.go.kr/statMonth.do): 총인구(명), 세대(세대), 행정동 10자리 코드, 매월 말일 기준. 거주자·거주불명자·재외국민을 포함하고 외국인은 제외한다.
- [연령별 인구현황](https://jumin.mois.go.kr/ageStatMonth.do): 1세 단위 0~99세 및 100세 이상. 유소년 0~14세, 생산연령 15~64세, 고령 65세 이상으로 합산한다. 각 동의 101개 연령 합계가 총인구와 같아야 한다.
- [세대원수별 세대수](https://jumin.mois.go.kr/etcStatHouseholds.do): `1인세대`(세대)를 사용한다. 주민등록 세대 기준이며 통계청 인구주택총조사의 1인가구와 같지 않다.
- [주민등록기준 출생등록](https://jumin.mois.go.kr/etcStatBirth.do), [주민등록기준 사망말소](https://jumin.mois.go.kr/etcStatDeath.do): 해당 월의 등록·말소 인원(명). 실제 발생일 기준 출생·사망 사건 통계와 다르다. 자연증가는 출생등록−사망말소로 계산한다.

행정안전부의 대응 [인구·세대 API](https://www.data.go.kr/data/15108065/openapi.do), [연령별 인구 API](https://www.data.go.kr/data/15108072/openapi.do), [세대원수별 세대 API](https://www.data.go.kr/data/15108081/openapi.do), [출생등록 API](https://www.data.go.kr/data/15108075/openapi.do), [사망말소 API](https://www.data.go.kr/data/15108077/openapi.do)의 공공데이터포털 이용 조건은 무료, 이용허락범위 제한 없음이다. 출처는 산출물에 명시한다. 원본 개인 자료를 수집하지 않고 공개 집계 자료만 사용한다.

## 출장소와 누락 검증

인구·연령·세대·출생·사망 다운로드에는 305개 경계 동과 별도 출장소 5곳이 있다. 출장소는 부모 동 수치에 중복 포함되지 않는다. 부모 동에 합산한 뒤 시군구 및 경남도 직접 통계행과 대조했다.

| 원본 코드 | 출장소 | 지도 경계 코드 | 합산 관할 | 공식 관할 근거 |
|---|---|---|---|---|
| 4824089000 | 신수 | 4824051000 | 동서동 | [한국에너지공단 공식 공고의 동서동 관할 신수동 표](https://zeb.energy.or.kr/BC/down/2025%EB%85%84%20%EC%8B%A0%EC%9E%AC%EC%83%9D%EC%97%90%EB%84%88%EC%A7%80%EB%B3%B4%EA%B8%89%28%EC%A3%BC%ED%83%9D%EC%A7%80%EC%9B%90%29%EC%82%AC%EC%97%85%20%EA%B3%B5%EA%B3%A0.pdf) |
| 4827025100 | 삼랑진임천 | 4827025000 | 삼랑진읍 | [밀양시 삼랑진읍 일반현황·임천출장소 업무](https://www.miryang.go.kr/twn/index.do?mnNo=1020000&owd=samrangjin) |
| 4831036600 | 사등면가조 | 4831036000 | 사등면 | [거제시 사등면 업무안내](https://www.geoje.go.kr/index.geoje?menuCd=DOM_000008911006002000) |
| 4831038500 | 하청면칠천 | 4831038000 | 하청면 | [거제시 하청면 관할 설명](https://geoje.go.kr/index.geoje?menuCd=DOM_000008911008001003) |
| 4831039500 | 장목면외포 | 4831039000 | 장목면 | [거제시 장목면 청사안내](https://www.geoje.go.kr/index.geoje?menuCd=DOM_000008911009002002) |

성/연령별 1인세대 다운로드는 신수출장소를 제공하지 않았고 사천시 직접 합계와 13개월 모두 69~73세대 차이가 났다. 이를 0으로 처리하거나 잔차로 추정하지 않았다. 대신 실제 신수출장소 행을 제공하는 세대원수별 세대수의 1인세대 열을 사용했다. 새 자료의 모든 시군구·경남도 합계가 일치한다.

## 제공 경로와 갱신 절차

`public/data/official-snapshot.json`은 305개 동, 13개월 공식 인구 전계열과 기존 운영 HIRA 시설 4,254곳을 담는다. 시설 기준은 운영 게시 시각 `2026-10-04T15:42:29.14+00:00`이며 인구 수집일이나 기준월로 바꾸지 않는다. 시설 출처·원본 hash·게시 시각은 `public/data/official-residents-manifest.json`에 보존한다. 공유 데이터베이스에는 쓰지 않았다.

`auto`·`live` 스냅샷 API는 공식 인구를 우선 사용하면서 게시된 시설을 유지한다. 저장소 장애 시 번들 공식 인구와 운영에서 확보한 HIRA 시설을 사용한다. 명시적으로 요청한 `demo`만 시연 자료를 제공한다. 출처가 명확하고 모든 계열·월·지역이 완전한 더 최신 공식 게시 인구는 번들로 되돌리지 않는다. 출처 불명·합성·부분 자료는 공식 번들로 대체한다. 다른 큐브의 월은 각 큐브 기준을 그대로 사용한다.

인구 갱신은 배포에 포함하는 월별 수동 갱신이다. HIRA 시설 동기화와 독립적이다. 자동 월별 원자료 수집 작업은 이 변경에서 추가하지 않았다. 다음 월 공개 후 실제 제공 월을 사이트에서 확인하고 다음 순서로 갱신한다.

```powershell
# 앞 단계에서 실제 운영 스냅샷을 로컬 파일로 확보하고, source/acquiredAt/publishedAt/createdAt를
# 같은 이름의 .meta.json 파일로 저장한다. API 키와 인증 URL은 파일에 넣지 않는다.
node scripts/adapters/mois-residents.mjs 2026-09 "$env:TEMP/nurimap-current-production-snapshot.json"
python scripts/verify-official-residents.py "$env:TEMP/nurimap-official-residents-verification.json"
npx vitest run tests/data/mois-residents.test.ts tests/data/official-residents.test.ts tests/data/snapshot-route.test.ts tests/data/population-live.test.ts tests/api/health-route.test.ts
npm run typecheck
```

다운로드 실패, 누락 코드·월, 중복 코드, 잘못된 정수, 연령합 불일치는 생성 실패로 처리한다. 성공 후에도 독립 검증을 통과하기 전 배포하지 않는다. 행정구역 변경이나 새 출장소가 생겨 직접 합계가 맞지 않으면 공식 관할 근거를 확인한 뒤 매핑과 회귀 테스트를 수정한다.

## API 활용신청이 필요한 경우

공식 CSV 확보에는 로그인이나 서비스 신청이 필요하지 않다. 기존 API 백필을 별도로 사용하려면 현재 키에서 미승인으로 확인된 서비스는 다음과 같다. 공공데이터포털에서 해당 계정의 서비스키로 각각 활용신청해야 한다. 계정 소유자의 신청을 대신 수행하지 않았다.

| 서비스 | 신청 URL | 엔드포인트 |
|---|---|---|
| 행정동별(통반단위) 성/연령별 주민등록 인구수 | https://www.data.go.kr/data/15108072/openapi.do | `/1741000/admmSexdAgePpltn/selectAdmmSexdAgePpltn` |
| 행정동별(통반단위) 성/연령별 주민등록 1인세대수 | https://www.data.go.kr/data/15108083/openapi.do | `/1741000/admmSexdAgeOneHh/selectAdmmSexdAgeOneHh` |

개발계정 자동승인·일일 10,000회 조건은 각 포털 페이지에서 확인한다. 승인 후 `node scripts/prod-checks/public-api-access.mjs`로 정상 키의 HTTP 상태와 실제 응답을 확인한다. 키는 출력하지 않는다. HTTP 200만으로 전체 자료 완전성을 판정하지 않고 실제 월·코드·건수를 검증한다. 인구·사망 API는 이번 확인에서 200이었으며 출생 API 한 요청은 timeout이었다. CSV 65개는 실제 정상 응답으로 확보했다.

## 독립 검증 결과

2026-10-05 Python 표준 `csv`와 정수 연산으로 원본을 다시 읽어 732,347개 검사를 통과했다. JavaScript 어댑터를 import하지 않는다. 원본 SHA-256 65개, 305동×13월의 모든 산출 값, 101개 개별 연령, 출장소 포함 시군구 22곳 및 경남도 직접 합계 5지표를 확인했다. 상세 실행 보고서는 `%TEMP%/nurimap-official-residents-verification.json`이다.

2026-09 경남 합계는 인구 3,190,549명, 세대 1,559,208세대, 1인세대 665,508세대, 유소년 321,822명, 생산연령 2,090,083명, 고령 778,644명, 출생등록 1,368명, 사망말소 2,111명, 자연증가 −743명이다. 모든 값은 원자료의 직접 합계와 대조했다.
