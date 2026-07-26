import type { LayerDescriptor } from "@/lib/layers/types";

export const POPULATION_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "population",
  label: "인구",
  provider: "공공",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["주민등록 인구·세대 (시연 스냅샷은 합성)"],
  metrics: [
    { key: "pop_total", label: "총인구", unit: "명", aggregation: "sum", formula: "월별 주민등록 인구", limitation: "외국인 제외", triggers: ["인구", "총인구", "인구수"] },
    { key: "households", label: "세대수", unit: "세대", aggregation: "sum", formula: "월별 세대 수", limitation: "", triggers: ["세대", "가구"] },
    { key: "density", label: "인구밀도", unit: "명/㎢", aggregation: "weightedAvg", weightKey: "pop_total", formula: "인구/면적", limitation: "", triggers: ["밀도", "인구밀도"] },
    { key: "elderly_ratio", label: "고령비율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "고령인구/총인구×100", limitation: "", triggers: ["고령인구 비율", "고령 인구", "고령인구", "고령비율", "고령화율", "고령", "노인"] },
    { key: "natural_change", label: "자연증가", unit: "명", aggregation: "sum", formula: "출생−사망", limitation: "전입·전출 미포함", triggers: ["자연증가", "출생", "사망"] },
  ],
};

export const SKT_LIVING_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "skt-living",
  label: "생활인구",
  provider: "SKT",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["SKT 생활인구 (행정동, 시간대별 추정치의 월별 일평균)"],
  metrics: [
    { key: "living_total", label: "총생활인구", unit: "명", aggregation: "sum", formula: "월 전체 시간대 평균 생활인구", limitation: "SKT 추정치, 실거주와 다를 수 있음", triggers: ["생활인구", "유동인구", "활동인구", "체류인구", "머무는"] },
    { key: "elderly_ratio", label: "생활인구 고령비중", unit: "%", aggregation: "weightedAvg", weightKey: "living_total", formula: "65세 이상 생활인구/총생활인구×100", limitation: "SKT 추정치", triggers: ["생활인구 고령", "고령 생활", "생활인구 고령비중", "체류 고령"] },
  ],
};

export const SKT_MOBILITY_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "skt-mobility",
  label: "이동인구",
  provider: "SKT",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["SKT 유입·유출 인구 (행정동, 거주지 시군구별 일평균 추정치)"],
  metrics: [
    { key: "inflow_total", label: "유입인구", unit: "명", aggregation: "sum", formula: "타 지역에서 유입된 일평균 생활인구", limitation: "SKT 추정치, 통근·방문 등 일시 체류 포함", triggers: ["유입인구", "유입 인구", "들어오는", "유입되는", "유입"] },
    { key: "outflow_total", label: "유출인구", unit: "명", aggregation: "sum", formula: "타 지역으로 유출된 일평균 거주자", limitation: "SKT 추정치", triggers: ["유출인구", "유출 인구", "빠져나가는", "빠져나가", "유출"] },
    { key: "net_flow", label: "순유입(유입−유출)", unit: "명", aggregation: "sum", formula: "유입인구 − 유출인구", limitation: "양수=순유입, 음수=순유출. SKT 추정치", triggers: ["순유입 인구", "순유입인구", "순유입", "순이동", "순인구이동"] },
  ],
};

export const SKT_DAYNIGHT_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "skt-daynight",
  label: "주야간인구",
  provider: "SKT",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["SKT 생활인구 시간대 분해 (주간 09~18시 · 야간 22~05시 시간당 평균)"],
  metrics: [
    { key: "day_population", label: "주간인구", unit: "명", aggregation: "sum", formula: "09~18시 시간당 평균 생활인구", limitation: "SKT 추정치, 통근·방문 등 일시 체류 포함", triggers: ["주간인구", "낮 인구", "낮인구", "주간 생활인구", "낮에 사람 많", "낮에만 사람"] },
    { key: "night_population", label: "야간인구", unit: "명", aggregation: "sum", formula: "22~05시 시간당 평균 생활인구", limitation: "SKT 추정치, 실거주 인구와 다를 수 있음", triggers: ["야간인구", "밤 인구", "밤인구", "야간 생활인구", "심야인구", "밤에 사람 많"] },
    { key: "day_night_ratio", label: "주야비", unit: "%", aggregation: "weightedAvg", weightKey: "night_population", formula: "주간인구 ÷ 야간인구 × 100", limitation: "100 초과=낮에 인구가 늘어나는 상권·업무지구, 100 미만=정주지역", triggers: ["주간인구 대비 야간인구", "야간인구 대비 주간인구", "주야간 인구 비율", "주야간 인구", "주야간 비율", "주간 대비 야간", "낮밤 비율", "주야비", "상권 성격"] },
  ],
};

export const NH_CONSUMPTION_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "nh-consumption",
  label: "카드소비",
  provider: "NH",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["NH농협카드 유입지별 카드매출 (행정동, 전체카드 전수화 추정)"],
  metrics: [
    { key: "card_sales", label: "카드매출", unit: "백만원", aggregation: "sum", formula: "전체카드 이용금액 월 합계(전수화)", limitation: "가맹점 소재지 기준 상권 매출, 거주자 소비와 다름", triggers: ["카드매출", "소비매출", "상권매출", "카드소비", "장사 잘되", "장사가 잘", "돈 많이 쓰", "소비 활발", "매출", "소비"] },
    { key: "card_txns", label: "카드결제건수", unit: "건", aggregation: "sum", formula: "전체카드 이용건수 월 합계(전수화)", limitation: "2명 미만 레코드는 원자료에서 익명처리됨", triggers: ["결제건수", "결제 건수", "카드건수", "이용건수", "결제"] },
  ],
};

export const NH_DEMOGRAPHICS_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "nh-demographics",
  label: "소비주체",
  provider: "NH",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["NH농협카드 성연령별 카드매출 (행정동, 전체카드 금액 구성비)"],
  metrics: [
    { key: "youth_share", label: "청년 소비비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "20~39세 카드금액 ÷ 개인 카드금액 × 100", limitation: "가맹점 소재지 기준이며 법인 결제는 분모에서 제외", triggers: ["청년 소비비중", "청년 소비", "젊은 층 소비", "젊은층 소비", "젊은 사람 소비", "20대 소비", "30대 소비", "청년층 소비"] },
    { key: "middle_share", label: "중장년 소비비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "40~59세 카드금액 ÷ 개인 카드금액 × 100", limitation: "법인 결제는 분모에서 제외", triggers: ["중장년 소비", "40대 소비", "50대 소비"] },
    { key: "senior_share", label: "고령 소비비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "60세 이상 카드금액 ÷ 개인 카드금액 × 100", limitation: "법인 결제는 분모에서 제외", triggers: ["고령 소비", "노년 소비", "60대 소비", "어르신 소비"] },
    { key: "female_share", label: "여성 소비비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "여성 카드금액 ÷ 개인 카드금액 × 100", limitation: "법인 결제는 분모에서 제외", triggers: ["여성 소비", "여성 비중"] },
    { key: "corporate_share", label: "법인 소비비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "법인 카드금액 ÷ 전체 카드금액 × 100", limitation: "업무·접대 결제가 많은 상권일수록 높다", triggers: ["법인 소비", "법인카드", "기업 소비"] },
  ],
};

export const NH_HOURLY_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "nh-hourly",
  label: "시간대 소비",
  provider: "NH",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["NH농협카드 시간대별 카드매출 (주간 09~18시 · 야간 22~05시, SKT 주야간인구와 동일 구간)"],
  metrics: [
    { key: "day_sales", label: "주간 카드매출", unit: "백만원", aggregation: "sum", formula: "09~18시 전체카드 이용금액 월 합계", limitation: "가맹점 소재지 기준 상권 매출", triggers: ["주간 매출", "낮 매출", "주간 카드매출", "낮 소비"] },
    { key: "night_sales", label: "야간 카드매출", unit: "백만원", aggregation: "sum", formula: "22~05시 전체카드 이용금액 월 합계", limitation: "가맹점 소재지 기준 상권 매출", triggers: ["야간 카드매출", "야간 매출", "밤 매출", "심야 매출", "심야 소비", "밤 소비"] },
    { key: "night_share", label: "야간 소비비중", unit: "%", aggregation: "weightedAvg", weightKey: "day_sales", formula: "야간(22~05시) 매출 ÷ 전체 매출 × 100", limitation: "19~21시 매출도 분모에 포함되므로 주간+야간 비중의 합은 100%가 아니다", triggers: ["야간 소비비중", "야간 상권", "심야 상권", "밤 상권"] },
  ],
};

export const NH_INDUSTRY_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "nh-industry",
  label: "업종구성",
  provider: "NH",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["NH농협카드 업종별 카드매출 (표준산업분류 11차 대분류 기준 매출 비중)"],
  metrics: [
    { key: "food_share", label: "음식·숙박 비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "숙박·음식점업(I) 매출 ÷ 전체 카드매출 × 100", limitation: "5개 업종군 외(제조·건설 등)도 분모에 포함되므로 업종군 비중의 합은 100%가 아니다", triggers: ["음식·숙박 비중", "음식 숙박", "숙박 음식", "요식업 비중", "음식업", "숙박업", "외식 상권", "먹자골목"] },
    { key: "retail_share", label: "도소매 비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "도매 및 소매업(G) 매출 ÷ 전체 카드매출 × 100", limitation: "가맹점 소재지 기준", triggers: ["도소매 비중", "소매 비중", "도소매업", "소매업", "유통 상권", "판매업 비중"] },
    { key: "health_share", label: "보건·의료 소비비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "보건업 및 사회복지 서비스업(Q) 매출 ÷ 전체 카드매출 × 100", limitation: "병원 결제 기준이라 의료기관 수(공공 의료 레이어)와는 다른 관점", triggers: ["보건·의료 소비비중", "의료 소비", "병원 소비", "보건 소비", "보건업", "의료비 비중"] },
    { key: "leisure_share", label: "여가·문화 비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "예술·스포츠·여가 서비스업(R) 매출 ÷ 전체 카드매출 × 100", limitation: "가맹점 소재지 기준", triggers: ["여가·문화 비중", "여가 소비", "문화 소비", "여가 비중", "레저 소비"] },
    { key: "education_share", label: "교육 소비비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "교육 서비스업(P) 매출 ÷ 전체 카드매출 × 100", limitation: "학원·교습 결제 중심이며 공교육 지출은 포함되지 않는다", triggers: ["교육 소비", "학원 소비", "사교육 소비", "교육업", "교육비 비중"] },
  ],
};

export const NH_STORETYPE_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "nh-storetype",
  label: "생활업종",
  provider: "NH",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["NH농협카드 업태별 카드매출 (표준산업분류 11차 소분류 기준 매출 비중)"],
  metrics: [
    { key: "restaurant_share", label: "음식점 비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "한식·간이·중식·일식 등 음식점 매출 ÷ 전체 카드매출 × 100", limitation: "선정한 생활업종 외 매출도 분모에 포함되므로 업태 비중의 합은 100%가 아니다", triggers: ["음식점 비중", "음식점 업태", "식당 비중", "한식 비중"] },
    { key: "cafe_share", label: "카페·제과 비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "커피 전문점·제과점 매출 ÷ 전체 카드매출 × 100", limitation: "가맹점 소재지 기준", triggers: ["카페 비중", "커피 소비", "카페 상권", "제과"] },
    { key: "pub_share", label: "주점 비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "일반·유흥 주점업 매출 ÷ 전체 카드매출 × 100", limitation: "가맹점 소재지 기준. 야간 상권 성격을 보조 설명", triggers: ["주점 비중", "술집 비중", "유흥 상권", "유흥업"] },
    { key: "grocery_share", label: "식료품 소매 비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "슈퍼마켓·편의점·종합소매 매출 ÷ 전체 카드매출 × 100", limitation: "가맹점 소재지 기준", triggers: ["식료품 소매 비중", "식료품 소매", "식료품 비중", "편의점 비중", "마트 비중", "슈퍼마켓"] },
    { key: "fuel_share", label: "주유소 비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "운송장비용 주유소 매출 ÷ 전체 카드매출 × 100", limitation: "경남 카드매출 1위 업태지만 통과 교통량에 좌우돼 생활 소비와 성격이 다르다", triggers: ["주유소 비중", "주유소 소비", "주유소", "주유 소비", "기름 소비"] },
    { key: "medical_store_share", label: "병의원·약국 비중", unit: "%", aggregation: "weightedAvg", weightKey: "card_sales", formula: "종합병원·병의원·약국 매출 ÷ 전체 카드매출 × 100", limitation: "결제 기준이라 의료기관 수(공공 의료 레이어)와는 다른 관점", triggers: ["병의원 비중", "약국 비중", "의료 업태"] },
  ],
};

export const KCB_CREDIT_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "kcb-credit",
  label: "소득·신용",
  provider: "KCB",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["KCB 신용정보 행정동 통계 (거주자 기준, 연령구간 인구가중 집계)"],
  metrics: [
    { key: "avg_income", label: "평균소득", unit: "만원/월", aggregation: "weightedAvg", weightKey: "pop_total", formula: "연령구간 월소득 평균의 인구가중 평균", limitation: "KCB 추정 거주자 소득, 세전 개인 기준", triggers: ["평균소득", "소득수준", "월소득", "부자", "소득"] },
    { key: "credit_score", label: "신용평점", unit: "점", aggregation: "weightedAvg", weightKey: "pop_total", formula: "신용평점(0~1000) 인구가중 평균", limitation: "KCB 평점 기준", triggers: ["신용평점", "신용점수", "신용도"] },
    { key: "card_spend", label: "1인 카드소비", unit: "만원/월", aggregation: "weightedAvg", weightKey: "pop_total", formula: "카드 총이용금액 합 ÷ 소비활동 대상자 수", limitation: "거주자 기준이라 상권 매출(NH)과 다르며, 신용판매·현금서비스·할부를 모두 포함한 카드 이용액이라 생활 소비만은 아니다", triggers: ["1인 카드소비", "인당 카드소비", "1인당 카드소비", "1인 소비", "인당 소비", "개인 소비", "1인소비"] },
    { key: "loan_ratio", label: "대출보유율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "대출 보유자 수 ÷ 인구 × 100", limitation: "보유 여부 기준(잔액 아님)", triggers: ["대출", "대출보유", "부채", "빚"] },
    { key: "delinquency_ratio", label: "연체율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "단기+장기 연체자 수 ÷ 인구 × 100", limitation: "5영업일·10만원 이상 또는 90일 이상 연체", triggers: ["연체", "연체율", "연체자"] },
    { key: "highend_ratio", label: "하이엔드 비율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "하이엔드 대상자 수 ÷ 인구 × 100", limitation: "고소득·고소비·전문직·외제차 기준", triggers: ["하이엔드", "고소득층", "부유층"] },
  ],
};

export const KCB_MIGRATION_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "kcb-migration",
  label: "거주이동",
  provider: "KCB",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["KCB 전입·전출 통계 (분기, 2년 전 거주지 대비 시군구 경계를 넘은 이동만)"],
  metrics: [
    { key: "move_in", label: "전입인구", unit: "명", aggregation: "sum", formula: "2년 전 거주 시군구가 다른 전입자 수(행정동 기준)", limitation: "같은 시군구 내 이동·미이동자는 제외. SKT 유입인구(일시 체류)와 달리 실제 거주지 이전", triggers: ["전입", "전입인구", "이사 온", "이주해 온"] },
    { key: "move_out_sgg", label: "전출인구(시군구)", unit: "명", aggregation: "weightedAvg", weightKey: "move_in", formula: "소속 시군구를 떠난 전출자 수", limitation: "원자료가 출발지를 시군구까지만 제공해 행정동 단위로 나눌 수 없다. 같은 시군구 내 이동은 제외", triggers: ["전출", "전출인구", "떠난", "이사 간"], scope: "sgg" },
  ],
};

export const KCB_COMMUTE_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "kcb-commute",
  label: "통근",
  provider: "KCB",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["KCB 통근통계 (분기, 자택-직장 행정동 기준)"],
  metrics: [
    { key: "jobs_in", label: "일자리 유입", unit: "명", aggregation: "sum", formula: "그 행정동으로 출근하는 취업자 수(거주지 무관)", limitation: "KCB 직장 위치는 본사 주소로 잡히는 경우가 있어 실제 근무지와 다를 수 있다", triggers: ["일자리", "일자리 유입", "직장 인구", "출근 인구", "종사자"] },
    { key: "job_ratio", label: "주간 일자리 배율", unit: "%", aggregation: "weightedAvg", weightKey: "jobs_in", formula: "일자리 유입 ÷ 취업 거주자 × 100", limitation: "100 초과=직장 중심지, 100 미만=베드타운. 본사 주소 등록 영향 가능", triggers: ["일자리 배율", "직장 중심", "베드타운", "주간 일자리"] },
    { key: "outbound_ratio", label: "관외 통근율", unit: "%", aggregation: "weightedAvg", weightKey: "jobs_in", formula: "거주 시군구 밖으로 통근하는 취업자 ÷ 취업 거주자 × 100", limitation: "같은 시군구 안에서의 통근은 관내로 본다", triggers: ["관외 통근", "통근율", "외지로 출퇴근", "타지 통근", "출퇴근"] },
  ],
};

export const KCB_GRID_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "kcb-grid-500m",
  label: "500m 격자",
  provider: "KCB",
  kind: "choropleth",
  coverage: "gyeongnam",
  // 격자 코드는 "gx_gy"라 앞 5자리를 잘라도 시군구가 되지 않는다. 읍면동 단위만 쓴다.
  adminLevels: ["dong"],
  sourceNotes: [
    "KCB 100m 격자 통계(부울경) 중 경남만, 500m로 재집계",
    "KCB가 (격자×5세연령구간) 인구 3명 미만은 제공하지 않아 농촌이 크게 누락된다. 격자 표본이 읍면동 인구의 90% 이상인 도시부(12개 시군구·95개 읍면동)만 싣는다",
    "성인 30명 미만 칸은 평균·비율을 내지 않는다(표본 부족·재식별 방지)",
  ],
  metrics: [
    { key: "pop_total", label: "격자 성인인구", unit: "명", aggregation: "sum", formula: "만18~104세 KCB 집계인구 합", limitation: "3명 미만 연령구간이 빠져 실제 인구보다 적다. 도시부에서도 과소 추정이므로 절대 인구로 읽지 말 것", triggers: ["격자 인구", "격자 성인인구"] },
    { key: "avg_income", label: "격자 평균소득", unit: "만원/월", aggregation: "weightedAvg", weightKey: "pop_total", formula: "연령구간 월소득 평균의 인구 가중평균", limitation: "성인 30명 이상 칸만 산출. 3명 미만 연령구간이 빠져 저소득 소수 가구가 덜 반영될 수 있다", triggers: ["격자 소득", "격자 평균소득", "블록 소득", "동네 안 소득"] },
    { key: "credit_score", label: "격자 신용평점", unit: "점", aggregation: "weightedAvg", weightKey: "pop_total", formula: "연령구간 신용평점의 인구 가중평균", limitation: "성인 30명 이상 칸만 산출", triggers: ["격자 신용", "격자 신용평점"] },
    { key: "card_spend", label: "격자 1인 카드소비", unit: "만원/월", aggregation: "weightedAvg", weightKey: "pop_total", formula: "카드 총이용금액 합 ÷ 소비활동 대상자 수", limitation: "성인 30명 이상 칸만 산출. 거주자 기준이라 상권 매출(NH)과 다르다", triggers: ["격자 1인 카드소비", "격자 카드소비", "격자 소비"] },
    { key: "loan_ratio", label: "격자 대출보유율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "대출 보유자 ÷ 성인인구 × 100", limitation: "성인 30명 이상 칸만 산출", triggers: ["격자 대출"] },
    { key: "delinquency_ratio", label: "격자 연체율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "연체자 ÷ 성인인구 × 100", limitation: "성인 30명 이상 칸만 산출", triggers: ["격자 연체"] },
    { key: "highend_ratio", label: "격자 하이엔드 비율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "하이엔드 등급자 ÷ 성인인구 × 100", limitation: "성인 30명 이상 칸만 산출", triggers: ["격자 하이엔드", "격자 고소득"] },
  ],
};

export const MEDICAL_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "medical",
  label: "의료",
  provider: "공공",
  kind: "point",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["HIRA 병원정보서비스 (경남 sido 380000)"],
  metrics: [
    { key: "vulnerability", label: "의료취약지수", unit: "점", aggregation: "weightedAvg", weightKey: "pop_total", formula: "공급35%+고령수요25%+최근접25%+2km무시설15%", limitation: "병원급 중심", triggers: ["의료취약지수", "의료 취약", "의료취약", "의료 사각", "취약지", "병원 부족", "병원부족"] },
  ],
};

/**
 * 큐브로 뒷받침되는 전체 레이어(공공 인구 + 민간). 교차분석 후보이자, 값 범위 계약과
 * 프리셋 검증이 참조하는 단일 출처다.
 *
 * 이 목록을 앱과 테스트가 따로 유지하던 동안 실제로 어긋난 적이 있다(테스트 목록에
 * 업종구성·생활업종·통근이 빠져 프리셋 가드가 앱 동작을 검증하지 못했다). 레이어를
 * 새로 붙일 때 여기 한 곳만 고치면 되도록 모아 둔다.
 */
export const CUBE_LAYERS = [
  POPULATION_LAYER,
  SKT_LIVING_LAYER,
  SKT_MOBILITY_LAYER,
  SKT_DAYNIGHT_LAYER,
  NH_CONSUMPTION_LAYER,
  NH_DEMOGRAPHICS_LAYER,
  NH_HOURLY_LAYER,
  NH_INDUSTRY_LAYER,
  NH_STORETYPE_LAYER,
  KCB_CREDIT_LAYER,
  KCB_MIGRATION_LAYER,
  KCB_COMMUTE_LAYER,
  KCB_GRID_LAYER,
] as const;

/** 자연어로 직접 전환 가능한 민간 제공기관 레이어(공공 인구 제외). */
export const PRIVATE_LAYERS = CUBE_LAYERS.filter((layer) => layer.provider !== "공공");

/**
 * 교차분석 후보. 큐브 레이어에 의료취약지수를 더한다.
 *
 * 의료는 원격 큐브가 아니라 스냅샷에서 계산되는 값이라 CUBE_LAYERS(=레이어 전환·원격
 * 로딩 목록)에는 넣지 않는다. 그러나 "소득 낮고 의료 취약한 지역"처럼 민간×공공의료를
 * 겹쳐 보는 것이 이 도구에서 가장 자연스러운 정책 질의라, 교차 후보에는 반드시 있어야 한다.
 * (`medicalCubeFromSnapshot`이 같은 모양의 큐브를 만들어 준다.)
 */
export const CROSS_CANDIDATE_LAYERS = [...CUBE_LAYERS, MEDICAL_LAYER] as const;
