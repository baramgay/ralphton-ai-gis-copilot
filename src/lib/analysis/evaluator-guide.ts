/**
 * Independent evaluator-facing checklist (public-sector / contest style).
 * Shown in Help tab — not a marketing claim list.
 */

export type EvaluatorCriterion = {
  id: string;
  title: string;
  weight: string;
  lookFor: string;
  howToVerify: string;
};

export const EVALUATOR_CRITERIA: EvaluatorCriterion[] = [
  {
    id: "scope",
    title: "분석 범위",
    weight: "필수",
    lookFor: "경상남도 행정동(약 305개)만 대상으로 하는지",
    howToVerify: "데이터 탭 통계 · 지도 칩 · 질의 「창원 의료 취약」",
  },
  {
    id: "honesty",
    title: "데이터 정직성",
    weight: "필수",
    lookFor: "시연 합성 vs 실데이터(HIRA·인구) 구분이 화면·출처에 드러나는지",
    howToVerify: "헤더 시연/실데이터 뱃지 · 결과 출처 카드 · 데이터 탭 소스 노트",
  },
  {
    id: "method",
    title: "방법론 투명성",
    weight: "높음",
    lookFor: "의료취약지수 가중치·직선거리·자연증가 한계가 설명되는지",
    howToVerify: "결과 「산식 · 해석 기준」 · 한눈에 보기 한계 섹션",
  },
  {
    id: "nl",
    title: "자연어·빠른 분석",
    weight: "높음",
    lookFor: "키 없어도 빠른 분석 8종, 키 있으면 질의 파서 동작",
    howToVerify: "의료 취약 클릭 · 「창원 vs 김해」 · 「창원 의료 취약」 입력",
  },
  {
    id: "map",
    title: "지도·결과 연동",
    weight: "높음",
    lookFor: "순위·지도 색·선택 동이 동기화되고 비교·드릴다운이 되는지",
    howToVerify: "순위 클릭 · 구 비교 · 동 순위 보기 · j/k 이동",
  },
  {
    id: "ops",
    title: "운영 가능성",
    weight: "중간",
    lookFor: "health·동기화 상태·cron·키 없는 폴백",
    howToVerify: "데이터 탭 연결 상태 · /api/health · /evaluator 인쇄 · 키 제거 후 DemoMap",
  },
];

export const EVALUATOR_SCRIPT = [
  "1. 첫 화면에서 「의료 취약」 실행 → 지도·순위·한 줄 결론 확인",
  "2. 지도 칩 「경남」 → 순위가 경남 위주로 좁혀지는지 확인",
  "3. 질의창에 「창원 vs 김해」 → 비교 결과",
  "4. 데이터 탭에서 시연/실데이터·HIRA·행정동 수 확인",
  "5. 화면 설정에서 다크 모드 · Shift+D 단축키",
  "6. CSV·공유 링크로 결과 반출",
  "7. /evaluator 인쇄 1페이지로 체크리스트 확인",
] as const;

export const METHOD_SUMMARY =
  "의료취약지수 = 공급 부족 35% + 고령 수요 25% + 최근접 거리 25% + 2km 무시설 15%. 거리=행정동 대표점 직선거리. 자연증가=출생−사망(전입·전출 제외).";
