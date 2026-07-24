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
    { key: "elderly_ratio", label: "고령비율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "고령인구/총인구×100", limitation: "", triggers: ["고령", "고령비율", "노인"] },
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
    { key: "living_total", label: "총생활인구", unit: "명", aggregation: "sum", formula: "월 전체 시간대 평균 생활인구", limitation: "SKT 추정치, 실거주와 다를 수 있음", triggers: ["생활인구", "유동인구", "활동인구", "체류인구", "머무는", "주간인구"] },
    { key: "elderly_ratio", label: "고령비중", unit: "%", aggregation: "weightedAvg", weightKey: "living_total", formula: "65세 이상 생활인구/총생활인구×100", limitation: "SKT 추정치", triggers: ["생활인구 고령", "고령 생활"] },
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

export const NH_CONSUMPTION_LAYER: Omit<LayerDescriptor, "months"> = {
  id: "nh-consumption",
  label: "카드소비",
  provider: "NH",
  kind: "choropleth",
  coverage: "gyeongnam",
  adminLevels: ["dong", "sgg"],
  sourceNotes: ["NH농협카드 유입지별 카드매출 (행정동, 전체카드 전수화 추정)"],
  metrics: [
    { key: "card_sales", label: "카드매출", unit: "백만원", aggregation: "sum", formula: "전체카드 이용금액 월 합계(전수화)", limitation: "가맹점 소재지 기준 상권 매출, 거주자 소비와 다름", triggers: ["카드매출", "소비매출", "상권매출", "카드소비", "매출", "소비"] },
    { key: "card_txns", label: "카드결제건수", unit: "건", aggregation: "sum", formula: "전체카드 이용건수 월 합계(전수화)", limitation: "2명 미만 레코드는 원자료에서 익명처리됨", triggers: ["결제건수", "결제 건수", "카드건수", "이용건수", "결제"] },
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
    { key: "card_spend", label: "1인 카드소비", unit: "만원/월", aggregation: "weightedAvg", weightKey: "pop_total", formula: "1인 카드 총이용금액의 소비활동인구 가중 평균", limitation: "거주자 소비, 상권 매출(NH)과 다름", triggers: ["1인 소비", "인당 소비", "개인 소비", "1인소비"] },
    { key: "loan_ratio", label: "대출보유율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "대출 보유자 수 ÷ 인구 × 100", limitation: "보유 여부 기준(잔액 아님)", triggers: ["대출", "대출보유", "부채", "빚"] },
    { key: "delinquency_ratio", label: "연체율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "단기+장기 연체자 수 ÷ 인구 × 100", limitation: "5영업일·10만원 이상 또는 90일 이상 연체", triggers: ["연체", "연체율", "연체자"] },
    { key: "highend_ratio", label: "하이엔드 비율", unit: "%", aggregation: "weightedAvg", weightKey: "pop_total", formula: "하이엔드 대상자 수 ÷ 인구 × 100", limitation: "고소득·고소비·전문직·외제차 기준", triggers: ["하이엔드", "고소득층", "부유층"] },
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
    { key: "vulnerability", label: "의료취약지수", unit: "점", aggregation: "weightedAvg", weightKey: "pop_total", formula: "공급35%+고령수요25%+최근접25%+2km무시설15%", limitation: "병원급 중심", triggers: ["의료취약", "취약지", "병원부족"] },
  ],
};
