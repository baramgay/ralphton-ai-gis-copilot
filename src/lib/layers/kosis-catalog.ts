import type { LayerDescriptor } from "./types";

/**
 * KOSIS e-지방지표 레이어.
 *
 * 원자료가 **시군구까지만** 있으므로 모든 지표에 `scope: "sgg"`를 준다. 이것이 없으면
 * 읍면동으로 줄을 세울 때 같은 값 30개를 두고 "상위 3곳"이라 답한다.
 *
 * 창원시는 KOSIS에서 한 행이라 5개 구가 시 전체 값을 나눠 갖는다. 그래서 여기 실린
 * 지표는 전부 **율·지수**다 — 건수였다면 창원만 5배로 부풀었을 것이다. 각 지표의
 * `limitation`에 그 사실을 적는다(어댑터 `scripts/adapters/_kosis-core.mjs` 참고).
 *
 * 연간 자료라 큐브의 월 축은 `YYYY-12`다. 추세를 물으면 "연간"임이 보이도록 한계에 적는다.
 */

const CITY_LEVEL_NOTE =
  "창원시는 원자료가 시 단위라 5개 구가 같은 값을 갖는다(구별 자료가 아니다)";
const ANNUAL_NOTE = "연 1회 공표라 큐브의 월 축은 연말(12월)로 적는다";

function kosisLayer(
  id: string,
  label: string,
  sourceNote: string,
  metrics: Array<{
    key: string;
    label: string;
    unit: string;
    formula: string;
    limitation: string;
    triggers: string[];
  }>,
): Omit<LayerDescriptor, "months"> {
  return {
    id,
    label,
    provider: "KOSIS",
    kind: "choropleth",
    coverage: "gyeongnam",
    adminLevels: ["dong", "sgg"],
    sourceNotes: [sourceNote],
    metrics: metrics.map((metric) => ({
      key: metric.key,
      label: metric.label,
      unit: metric.unit,
      /*
       * 같은 시군구의 읍면동이 모두 같은 값을 가지므로, 가중치 없는 평균으로 시군구로
       * 되접으면 원래 값이 그대로 나온다. `sum`을 쓰면 읍면동 수만큼 곱해진다.
       */
      aggregation: "weightedAvg" as const,
      formula: metric.formula,
      limitation: `${metric.limitation} · ${CITY_LEVEL_NOTE} · ${ANNUAL_NOTE}`,
      /*
       * 지표명 자체를 트리거에 넣는다. 리졸버는 **가장 긴 트리거**를 이긴 것으로 보는데,
       * 「뺑소니 교통사고율」을 물으면 짧은 「뺑소니」보다 다른 지표의 「교통사고」가 길어
       * 그쪽으로 갔다(계약 검사가 잡았다). 이름을 그대로 물었을 때 자기 지표로 오는 것은
       * 어느 지표에서나 참이어야 하므로 손으로 적지 않고 여기서 붙인다.
       */
      triggers: [...new Set([metric.label, ...metric.triggers])],
      scope: "sgg" as const,
    })),
  };
}

export const KOSIS_SAFETY_LAYER = kosisLayer(
  "kosis-safety",
  "안전",
  "KOSIS e-지방지표 (소방청·경찰청 원자료, 시군구·연간)",
  [
    {
      key: "fire_rate",
      label: "주민 만명당 화재",
      unit: "건/만명",
      formula: "화재발생 건수 ÷ 주민등록인구 × 10,000",
      limitation: "인구 대비라 인구가 적은 군은 한두 건에도 크게 흔들린다",
      triggers: ["화재", "화재율", "화재발생", "불", "소방", "화재 많은"],
    },
    {
      key: "accident_rate",
      label: "자동차 천대당 교통사고",
      unit: "건/천대",
      formula: "교통사고 발생건수 ÷ 자동차 등록대수 × 1,000",
      limitation: "등록대수 기준이라 통과 차량이 많은 지역은 실제 위험도보다 낮게 나온다",
      triggers: ["교통사고", "교통사고율", "사고 많은", "교통 위험"],
    },
    {
      key: "hitrun_rate",
      label: "뺑소니 교통사고율",
      unit: "%",
      formula: "뺑소니 교통사고 ÷ 전체 교통사고 × 100",
      limitation: "신고·검거 기준이라 실제 발생과 다를 수 있다",
      triggers: ["뺑소니", "뺑소니율"],
    },
    {
      key: "drunk_rate",
      label: "음주운전 교통사고 비율",
      unit: "%",
      formula: "음주운전 교통사고 ÷ 전체 교통사고 × 100",
      limitation: "경찰 접수 기준",
      triggers: ["음주운전", "음주사고", "음주운전 사고"],
    },
  ],
);

export const KOSIS_WELFARE_LAYER = kosisLayer(
  "kosis-welfare",
  "복지",
  "KOSIS e-지방지표 (보건복지부·행정안전부 원자료, 시군구·연간)",
  [
    {
      key: "welfare_facility",
      label: "인구 십만명당 사회복지시설",
      unit: "개/십만명",
      formula: "사회복지시설 수 ÷ 주민등록인구 × 100,000",
      limitation: "시설 규모·정원은 반영하지 않은 개수 기준",
      triggers: ["사회복지시설", "복지시설", "복지 인프라", "복지시설 수"],
    },
    {
      key: "senior_leisure",
      label: "노인 천명당 노인여가복지시설",
      unit: "개/천명",
      formula: "노인여가복지시설 수 ÷ 60세 이상 인구 × 1,000",
      limitation: "경로당·노인복지관·노인교실을 합친 개수",
      triggers: ["경로당", "노인복지관", "노인여가시설", "노인여가복지시설", "노인 시설"],
    },
    {
      key: "childcare",
      label: "유아 천명당 보육시설",
      unit: "개/천명",
      formula: "보육시설 수 ÷ 0~5세 인구 × 1,000",
      limitation: "정원이 아니라 시설 개수라, 큰 어린이집이 많은 곳은 낮게 나온다",
      triggers: ["어린이집", "보육시설", "보육 인프라", "아이 맡길"],
    },
    {
      key: "solo_elderly",
      label: "독거노인가구 비율",
      unit: "%",
      formula: "65세 이상 1인가구 ÷ 전체 일반가구 × 100",
      limitation: "주민등록 기준이라 실제 동거 여부와 다를 수 있다",
      triggers: ["독거노인", "홀몸노인", "독거노인가구", "혼자 사는 노인"],
    },
    {
      key: "foreign_rate",
      label: "인구 천명당 등록외국인",
      unit: "명/천명",
      formula: "등록외국인 ÷ 주민등록인구 × 1,000",
      limitation: "등록 기준이라 단기 체류·미등록은 빠진다",
      triggers: ["외국인", "등록외국인", "외국인 비율", "다문화"],
    },
  ],
);

export const KOSIS_HEALTH_LAYER = kosisLayer(
  "kosis-health",
  "보건의료",
  "KOSIS e-지방지표 (보건복지부 원자료, 시군구·연간)",
  [
    {
      key: "doctors",
      label: "인구 천명당 의사",
      unit: "명/천명",
      formula: "의료기관 종사 의사 수 ÷ 주민등록인구 × 1,000",
      limitation: "근무지 기준이라 대형병원이 있는 시군에 몰린다",
      triggers: ["의사", "의사수", "의사 수", "인구당 의사", "의사 부족"],
    },
    {
      key: "beds",
      label: "인구 천명당 병상",
      unit: "개/천명",
      formula: "총 병상 수 ÷ 주민등록인구 × 1,000",
      limitation: "요양병상을 포함해 급성기 의료 접근성과는 다르다",
      triggers: ["병상", "병상수", "병상 수", "입원 병상"],
    },
  ],
);

export const KOSIS_HOUSING_LAYER = kosisLayer(
  "kosis-housing",
  "주거",
  "KOSIS e-지방지표 (국토교통부·통계청 원자료, 시군구·연간)",
  [
    {
      key: "old_housing",
      label: "노후주택 비율",
      unit: "%",
      formula: "준공 30년 이상 주택 ÷ 전체 주택 × 100",
      limitation: "준공연도 기준이라 수선·리모델링은 반영되지 않는다",
      triggers: ["노후주택", "오래된 집", "낡은 주택", "노후 주택", "노후도"],
    },
    {
      key: "vacant",
      label: "빈집 비율",
      unit: "%",
      formula: "미거주주택(빈집) ÷ 전체 주택 × 100",
      limitation: "인구주택총조사의 미거주 기준이라 신축 미분양·별장도 포함된다",
      triggers: ["빈집", "공가", "빈집 비율", "빈집 많은"],
    },
    {
      key: "ownership",
      label: "주택소유가구 비율",
      unit: "%",
      formula: "주택 소유 가구 ÷ 전체 일반가구 × 100",
      limitation: "가구 기준이라 다주택·타지 소유가 섞여 있다",
      triggers: ["자가보유", "주택소유", "자가율", "주택소유율", "내 집"],
    },
  ],
);

export const KOSIS_FINANCE_LAYER = kosisLayer(
  "kosis-finance",
  "지방재정",
  "KOSIS e-지방지표 (행정안전부 지방재정, 시군구·연간)",
  [
    {
      key: "fiscal_independence",
      label: "재정자립도",
      unit: "%",
      formula: "지방세+세외수입 ÷ 일반회계 예산 × 100 (세입과목 개편 후 기준)",
      limitation: "예산 기준이라 결산과 다르다",
      triggers: ["재정자립도", "재정 자립", "자립도"],
    },
    {
      key: "fiscal_autonomy",
      label: "재정자주도",
      unit: "%",
      formula: "자체수입+자주재원 ÷ 일반회계 예산 × 100 (세입과목 개편 후 기준)",
      limitation: "교부세·조정교부금을 자주재원으로 본다",
      triggers: ["재정자주도", "재정 자주", "자주도"],
    },
    {
      key: "welfare_budget",
      label: "사회복지 결산비중",
      unit: "%",
      formula: "(사회복지분야+보건분야 결산액) ÷ 일반회계 전체 결산액 × 100",
      limitation: "결산 기준이라 최근 연도는 늦게 확정된다",
      triggers: ["복지예산", "사회복지 예산", "복지 결산", "복지 비중"],
    },
    {
      key: "admin_budget",
      label: "일반공공행정 결산비중",
      unit: "%",
      formula: "일반공공행정분야 결산액 ÷ 일반회계 전체 결산액 × 100",
      limitation: "인건비·청사 운영이 큰 비중이라 인구가 적은 군에서 높게 나온다",
      triggers: ["행정예산", "일반행정 예산", "행정 비중"],
    },
  ],
);

export const KOSIS_TRANSPORT_LAYER = kosisLayer(
  "kosis-transport",
  "교통",
  "KOSIS e-지방지표 (국토교통부 원자료, 시군구·연간)",
  [
    {
      key: "car_per_person",
      label: "1인당 자동차 등록",
      unit: "대",
      formula: "자동차 등록대수 ÷ 주민등록인구",
      limitation: "법인·렌터카 등록지가 실제 운행지와 다를 수 있다",
      triggers: ["자동차 등록", "자동차 보유", "차량 등록", "1인당 자동차", "차 많은"],
    },
    {
      key: "road_paved",
      label: "도로포장률",
      unit: "%",
      formula: "포장도로 연장 ÷ 전체 개통 도로 연장 × 100",
      limitation: "연장 기준이라 폭·차로 수는 반영되지 않는다",
      triggers: ["도로포장률", "포장도로", "도로 포장"],
    },
  ],
);

export const KOSIS_ENVIRONMENT_LAYER = kosisLayer(
  "kosis-environment",
  "환경",
  "KOSIS e-지방지표 (환경부 원자료, 시군구·연간)",
  [
    {
      key: "recycle",
      label: "생활폐기물 재활용률",
      unit: "%",
      formula: "총 재활용량 ÷ 생활계폐기물 총발생량 × 100",
      limitation: "선별 후 잔재물 처리는 반영되지 않은 반입 기준",
      triggers: ["재활용률", "재활용", "분리배출", "재활용 잘하는"],
    },
    {
      key: "waste_per_person",
      label: "1인당 생활폐기물 배출",
      unit: "kg/일",
      formula: "생활계폐기물 발생량 ÷ 주민등록인구",
      limitation: "관광객·사업장 폐기물이 섞여 관광지가 높게 나온다",
      triggers: ["쓰레기", "폐기물", "생활폐기물", "쓰레기 배출"],
    },
    {
      key: "waterworks",
      label: "상수도 보급률",
      unit: "%",
      formula: "상수도 급수인구 ÷ 총인구 × 100",
      limitation: "마을상수도를 포함해 수질·수압은 반영되지 않는다",
      triggers: ["상수도", "수돗물", "상수도 보급", "물 공급"],
    },
  ],
);

export const KOSIS_EDUCATION_LAYER = kosisLayer(
  "kosis-education",
  "교육·문화",
  "KOSIS e-지방지표 (교육부·문화체육관광부 원자료, 시군구·연간)",
  [
    {
      key: "academy",
      label: "인구 천명당 사설학원",
      unit: "개/천명",
      formula: "사설학원 수 ÷ 주민등록인구 × 1,000",
      limitation: "교습소·개인과외는 빠진 등록 학원 기준",
      triggers: ["학원", "사설학원", "학원 수", "학원가"],
    },
    {
      key: "class_size",
      label: "학급당 학생수",
      unit: "명",
      formula: "전체 학생 수 ÷ 전체 학급 수 (유·초·중·고 합계)",
      limitation: "학교급을 합친 값이라 초등 과밀과 고교 소규모가 상쇄된다",
      triggers: ["학급당 학생", "학급 규모", "과밀학급", "학급당"],
    },
    {
      key: "culture",
      label: "인구 십만명당 문화기반시설",
      unit: "개/십만명",
      formula: "문화기반시설 수 ÷ 주민등록인구 × 100,000",
      limitation: "도서관·박물관·미술관·문예회관 등을 합친 개수",
      triggers: ["문화시설", "문화기반시설", "도서관", "박물관", "문화 인프라"],
    },
  ],
);

/** 새 KOSIS 레이어를 붙일 때 여기 한 곳만 고치면 된다. */
export const KOSIS_LAYERS = [
  KOSIS_SAFETY_LAYER,
  KOSIS_WELFARE_LAYER,
  KOSIS_HEALTH_LAYER,
  KOSIS_HOUSING_LAYER,
  KOSIS_FINANCE_LAYER,
  KOSIS_TRANSPORT_LAYER,
  KOSIS_ENVIRONMENT_LAYER,
  KOSIS_EDUCATION_LAYER,
] as const;
