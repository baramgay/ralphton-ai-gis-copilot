# Kimi 독립 평가셋 30개 — 2026-09-04 작성

**이 파일은 `tests/rag/retrieval-quality.test.ts`를 열기 전에 먼저 확정한 것이다.**
작성 시점에 내가 본 것: 의뢰서 문서, 레이어 카탈로그(kosis-catalog.ts·layers/ JSON 파일명),
`src/lib/rag/` 파일 목록뿐. 의뢰자의 15개 질의·기대값·점수는 모른다.

방식: 경남 시·군 공무원이 실제로 칠 법한 구어체. 지표명(「재정자립도」처럼 카탈로그에
있는 말)을 직접 쓰지 않되, 일부는 관성적 표현(「자립」 등)이 섞일 수 있음을 인정한다.
기대값은 내가 카탈로그를 보고 정한 것이라 틀릴 수 있다 — 그 경우 내 기대가 틀린 것이지
검색이 틀린 게 아니므로, 판정 시 하나하나 논한다.

| # | 질의 | 내 기대(레이어.지표) | 비고 |
|---|---|---|---|
| 1 | 불이 자주 나는 동네가 어디야 | kosis-safety.fire_rate | |
| 2 | 혼자 사는 어르신이 많은 곳 | kosis-welfare.solo_elderly | |
| 3 | 아이 맡길 데가 모자라는 지역 | kosis-welfare.childcare | |
| 4 | 밤에 사람이 많이 모이는 동 | skt-daynight 또는 nh-hourly | 애매함 인정 |
| 5 | 출근하면 인구가 쏙 빠지는 동 | kcb-commute 또는 skt-daynight | 애매함 인정 |
| 6 | 오래된 집이 많은 시군구 | kosis-housing.old_housing | |
| 7 | 살림살이를 제 벌이로 하는 시군 | kosis-finance.fiscal_independence | |
| 8 | 병원 가기 힘든 읍면 어디야 | 의료취약 도구 | |
| 9 | 카드값 연체가 많은 동 | kcb-credit.delinquency_ratio | |
| 10 | 쓰레기를 많이 버리는 시군 | kosis-environment.waste_per_person | |
| 11 | 분리수거를 잘하는 곳 | kosis-environment.recycle | |
| 12 | 수돗물이 안 들어오는 마을이 있는 군 | kosis-environment.waterworks | |
| 13 | 학원가가 발달한 동네 | kosis-education.academy | |
| 14 | 한 반에 학생이 너무 많은 지역 | kosis-education.class_size | |
| 15 | 술 먹고 운전하다 사고가 잦은 곳 | kosis-safety.drunk_rate | |
| 16 | 뺑소니가 잦은 시군구 | kosis-safety.hitrun_rate | |
| 17 | 외국인 근로자가 많이 사는 동 | kosis-welfare.foreign_rate | |
| 18 | 사람이 계속 들어오는 동네 | kcb-migration.move_in | |
| 19 | 차 보유가 많은 시군구 | kosis-transport.car_per_person | |
| 20 | 비포장도로가 많은 군 | kosis-transport.road_paved | |
| 21 | 어르신들 갈 만한 시설이 모자란 곳 | kosis-welfare.senior_leisure | |
| 22 | 도서관 같은 문화 시설이 부족한 시군 | kosis-education.culture | |
| 23 | 밤 장사가 잘되는 상권 | nh-hourly.night_share | |
| 24 | 신용점수가 낮은 사람이 많은 동 | kcb-credit.credit_score | |
| 25 | 빚 부담이 큰 가구가 많은 곳 | kcb-credit.loan_ratio | |
| 26 | 빈집 때문에 슬럼화가 걱정되는 시군 | kosis-housing.vacant | |
| 27 | 의사가 부족한 시군구 | kosis-health.doctors | |
| 28 | 아픈 사람이 누울 병상이 모자란 곳 | kosis-health.beds | |
| 29 | 사회복지 예산을 많이 쓰는 시군 | kosis-finance.welfare_budget | |
| 30 | 요즘 뜨는 상권 어디야 | nh-consumption 또는 skt-living | 애매함 인정 |

측정 정의: 각 질의를 retrieve에 넣어 1위 청크의 레이어가 기대 레이어와 같으면 top-1 적중,
5위 안에 있으면 top-5 적중. 애매함 인정 3개(4·5·30)는 별도 집계한다.
