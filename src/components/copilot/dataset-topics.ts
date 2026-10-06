/** 목적 분류는 출처와 별개다. 제공기관은 각 자료의 출처로 표시한다. */
export const DATASET_TOPICS = [
  { id: "people", label: "사람과 이동", description: "사람이 어디에 살고, 머물고, 이동하는지 살펴보세요.", layerIds: ["population", "skt-living", "skt-mobility", "skt-daynight", "kcb-migration", "kcb-commute"] },
  { id: "commerce", label: "상권과 소비", description: "매출, 소비층, 시간대와 업종으로 상권을 살펴보세요.", layerIds: ["nh-consumption", "nh-demographics", "nh-hourly", "nh-industry", "nh-storetype"] },
  { id: "economy", label: "소득과 지역경제", description: "소득·신용, 기업과 지방재정의 지역 차이를 살펴보세요.", layerIds: ["kcb-credit", "kcb-grid-500m", "gn-business", "kosis-finance"] },
  { id: "services", label: "생활과 공공서비스", description: "의료, 복지, 안전과 생활환경을 살펴보세요.", layerIds: ["medical", "kosis-safety", "kosis-welfare", "kosis-health", "kosis-housing", "kosis-transport", "kosis-environment", "kosis-education"] },
] as const;

export type DatasetTopicId = (typeof DATASET_TOPICS)[number]["id"];

export const DATASET_DESCRIPTIONS: Record<string, string> = {
  population: "주민등록 인구, 세대와 고령인구를 봅니다.",
  "skt-living": "지역에 머무는 생활인구의 추정치를 봅니다.",
  "skt-mobility": "다른 시군구에서 오고 나가는 사람의 흐름을 봅니다.",
  "skt-daynight": "낮과 밤에 머무는 인구를 비교합니다.",
  "nh-consumption": "가맹점 소재지 기준 카드매출과 결제건수를 봅니다.",
  "nh-demographics": "연령·성별에 따른 카드소비 구성을 봅니다.",
  "nh-hourly": "낮과 밤의 카드매출을 비교합니다.",
  "nh-industry": "업종별 카드매출 구성을 봅니다.",
  "nh-storetype": "음식점·소매 등 생활업종별 소비를 봅니다.",
  "kcb-credit": "지역의 추정 소득과 신용 특성을 봅니다.",
  "kcb-migration": "거주자의 전입과 전출을 봅니다.",
  "kcb-commute": "통근 인구와 출퇴근 지역을 봅니다.",
  "kcb-grid-500m": "도시부 500m 격자의 성인인구·소득·신용을 봅니다.",
  "gn-business": "2015–2019년 기업정보를 시군구별로 봅니다.",
  medical: "의료기관 위치와 지역의 의료 접근성을 봅니다.",
  "kosis-safety": "화재와 교통사고 등 안전 지표를 봅니다.",
  "kosis-welfare": "복지 대상과 지원 지표를 봅니다.",
  "kosis-health": "지역의 보건의료 지표를 봅니다.",
  "kosis-housing": "주택과 빈집 등 주거 지표를 봅니다.",
  "kosis-finance": "재정자립도 등 지방재정 지표를 봅니다.",
  "kosis-transport": "지역의 교통 지표를 봅니다.",
  "kosis-environment": "지역의 환경 지표를 봅니다.",
  "kosis-education": "교육·문화시설과 지역 지표를 봅니다.",
};
