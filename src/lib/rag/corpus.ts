/**
 * Curated knowledge corpus for offline RAG.
 * Each chunk is short, factual, and tied to tools/domains used by the copilot.
 */

export type RagChunk = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  keywords: string[];
};

export const RAG_CORPUS: RagChunk[] = [
  {
    id: "tool-scarcity",
    title: "의료 취약지수",
    body: "의료 취약지수는 공급 부족 35% + 고령 수요 25% + 최근접 거리 25% + 2km 무시설 15%로 합성합니다. 점수가 높을수록 상대적으로 취약합니다. tool=rankHospitalScarcity.",
    tags: ["rankHospitalScarcity", "medical", "access"],
    keywords: ["취약", "부족", "공백", "의료취약", "병원 부족"],
  },
  {
    id: "tool-elderly-medical",
    title: "고령 수요 대비 의료 공급",
    body: "고령 인구 비중과 의료 공급 지표를 함께 볼 때 rankElderlyUnderserved를 사용합니다. 노인·어르신·고령화 + 병원 부족 질의에 적합합니다.",
    tags: ["rankElderlyUnderserved", "elderly", "medical"],
    keywords: ["고령", "노인", "어르신", "고령화", "의료 부족"],
  },
  {
    id: "tool-death-birth",
    title: "출생·사망·자연증감",
    body: "출생 수는 rankBirthCount, 사망 수는 rankDeathCount, 자연감소(사망−출생)는 rankNaturalDecrease입니다. 전입·전출은 포함하지 않습니다.",
    tags: ["rankDeathCount", "rankBirthCount", "rankNaturalDecrease", "vital"],
    keywords: ["사망", "출생", "자연감소", "자연증가", "출산"],
  },
  {
    id: "tool-population",
    title: "인구·밀도·증감",
    body: "총인구 rankPopulationSize, 인구밀도 rankPopulationDensity, 12개월 증가 rankPopulationGrowthPressure, 감소 rankPopulationDeclineRisk. 밀도는 총인구÷면적(km²).",
    tags: [
      "rankPopulationSize",
      "rankPopulationDensity",
      "rankPopulationGrowthPressure",
      "rankPopulationDeclineRisk",
      "population",
    ],
    keywords: ["인구", "밀도", "증가", "감소", "밀집", "주민"],
  },
  {
    id: "tool-single-elderly-ratio",
    title: "1인가구·고령화율",
    body: "1인가구 비율은 rankSingleHouseholdRisk, 고령인구 비율은 rankElderlyRatio. 결측은 0으로 추정하지 않고 데이터 없음으로 둡니다.",
    tags: ["rankSingleHouseholdRisk", "rankElderlyRatio", "population"],
    keywords: ["1인가구", "고령화율", "노인 비율", "단독가구"],
  },
  {
    id: "tool-access",
    title: "접근성·반경·최근접 거리",
    body: "반경 1·2·3km 내 시설 수는 countFacilitiesWithinRadius, 대표점 기준 최근접 의료기관 직선거리는 nearestFacilityDistance. 도로 거리·소요시간이 아닙니다.",
    tags: ["countFacilitiesWithinRadius", "nearestFacilityDistance", "access"],
    keywords: ["반경", "km", "키로", "최근접", "거리", "접근성", "이내"],
  },
  {
    id: "tool-facilities",
    title: "시설 목록·약국·야간",
    body: "filterFacilitiesByTypeAndHours로 유형·야간·주말 조건을 적용합니다. '병원'은 약국 제외 의료기관 전체, 약국·치과·한의원은 명시 시에만.",
    tags: ["filterFacilitiesByTypeAndHours", "medical", "pharmacy", "kakao"],
    keywords: ["병원", "약국", "치과", "한의원", "야간", "주말", "위치", "목록"],
  },
  {
    id: "tool-compare-detail",
    title: "지역 비교·상세",
    body: "구·군 2곳 비교는 compareRegions(합산 롤업). 한 지역 현황·상세는 getRegionDetails. 해운대→해운대구, 기장→기장군처럼 별칭을 정규화합니다.",
    tags: ["compareRegions", "getRegionDetails", "region"],
    keywords: ["비교", "vs", "상세", "현황", "어때", "해운대", "기장"],
  },
  {
    id: "data-demo-live",
    title: "데모·실데이터 한계",
    body: "기본 스냅샷은 시연용 합성 데이터일 수 있습니다. live 모드는 시설 API 보강이 가능하나 인구 시계열은 기준 스냅샷을 유지할 수 있습니다. 정책 최종 판단에는 원천 통계를 쓰세요.",
    tags: ["data", "demo", "live", "caveat"],
    keywords: ["데모", "실데이터", "한계", "출처", "합성", "정책"],
  },
  {
    id: "data-geometry",
    title: "행정동 경계·대표점",
    body: "부산·경남 511개 행정동 경계를 사용합니다. 대표점은 pointOnFeature로 동 내부에 둡니다. 분석 거리는 대표점 기준 Turf 대권 직선거리입니다.",
    tags: ["gis", "boundary", "geometry"],
    keywords: ["행정동", "경계", "대표점", "511", "부산", "경남", "직선거리", "turf"],
  },
  {
    id: "kakao-live",
    title: "카카오 실시간 장소",
    body: "근처·주변 질의는 스냅샷 시설과 카카오 로컬 REST 장소 검색을 함께 쓸 수 있습니다. JS 지도 키와 REST 키·웹 도메인 등록이 필요합니다.",
    tags: ["kakao", "nearby", "filterFacilitiesByTypeAndHours"],
    keywords: ["카카오", "근처", "주변", "실시간", "장소", "로컬"],
  },
  {
    id: "unsupported",
    title: "미지원 질의",
    body: "전입·전출, 도로망 거리, 응급의료 통계, 날씨, 교통 혼잡 등은 현재 tool 카탈로그에 없습니다. 지원 지표로 재질문하도록 안내합니다.",
    tags: ["unsupported", "safety"],
    keywords: ["전입", "전출", "날씨", "응급", "도로", "교통", "unsupported"],
  },
  {
    id: "follow-up",
    title: "후속 질의",
    body: "‘이 동만’, ‘반경 3km로’, ‘이 결과에서’ 같은 후속 질의는 이전 선택 지역·반경·시설 유형을 유지한 채 재분석합니다.",
    tags: ["follow-up", "conversation"],
    keywords: ["이 동", "이 결과", "반경", "후속", "이어서", "여기만"],
  },
  {
    id: "busan-scope",
    title: "분석 공간 범위",
    body: "본 코파일럿은 부산광역시와 경상남도 행정동 단위 분석입니다. 시설은 HIRA 병원정보서비스(전국 API 중 부산·경남 필터)를 사용합니다. 그 외 시·도 질의는 지원하지 않습니다.",
    tags: ["region", "busan", "gyeongnam"],
    keywords: ["부산", "경남", "시군구", "행정동", "범위", "창원", "김해"],
  },
  {
    id: "hira-hospitals",
    title: "HIRA 병원 데이터",
    body: "의료시설 live 원천은 건강보험심사평가원 병원정보서비스 v2(getHospBasisList, XML)입니다. 시도코드 210000(부산)·380000(경남). 약국·운영시간은 이 API에 없을 수 있습니다.",
    tags: ["hira", "medical", "live"],
    keywords: ["HIRA", "심평원", "병원", "요양기관", "시설", "live"],
  },
  {
    id: "dong-gazetteer",
    title: "행정동 지명 해석",
    body: "질의에 동 이름(예: 우동, 송정동, 중앙동)이 있으면 place-index(부산·경남 행정동)로 adm_cd2를 해석해 regions 필터에 넣습니다. 시·구 이름과 함께 쓰면 해당 지역 내 동으로 범위를 좁힙니다.",
    tags: ["region", "dong", "getRegionDetails", "place-index"],
    keywords: ["동", "행정동", "우동", "송정동", "중앙동", "지명", "창원"],
  },
  {
    id: "hybrid-rag",
    title: "하이브리드 RAG",
    body: "지식 검색은 BM25-lite 어휘 점수와 해시 임베딩 코사인 유사도를 가중합합니다. 네트워크 없이도 동작하며, DashScope 임베딩 API가 있으면 서버에서 선택적으로 보강할 수 있습니다.",
    tags: ["rag", "hybrid", "embedding"],
    keywords: ["RAG", "검색", "임베딩", "근거", "지식"],
  },
  {
    id: "export-share",
    title: "내보내기·공유",
    body: "분석 결과는 CSV 내보내기와 URL 공유(tool·region·radius·q)를 지원합니다. 출처·기준월 메타가 CSV 상단에 포함됩니다.",
    tags: ["export", "share"],
    keywords: ["CSV", "내보내기", "공유", "링크"],
  },
];
