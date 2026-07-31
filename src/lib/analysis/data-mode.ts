/**
 * 스냅샷이 "실데이터"라고 말할 때, 무엇이 실데이터인지 가른다.
 *
 * `mode: "live"`는 **시설 동기화가 됐다**는 뜻이지 모든 계열이 실측이라는 뜻이 아니다.
 * prod 실측(2026-07-31): `mode`는 live인데 sourceNotes가 "인구·세대·출생·사망 값은
 * 합성값", "인구·세대 시계열은 검증된 기준 스냅샷을 유지합니다"라고 말하고 있었고,
 * 실제로 양산시 물금읍의 고령비율은 13개월 내내 11.35로 고정이었다. 그런데 상단
 * 배지·배너는 그냥 "실데이터"라고 적혀 있었다.
 *
 * 공공기관 보고서에 옮겨지는 숫자다. 배지 한 낱말이 인구 통계의 출처를 규정한다.
 */

/** 인구·세대 계열이 실측인가. 스냅샷이 스스로 밝힌 각주로 판별한다. */
export function populationIsLive(mode: string, sourceNotes: readonly string[]): boolean {
  if (mode !== "live") return false;
  /*
   * 각주 문구로 가른다. 별도 필드를 두면 각주와 어긋날 수 있고, 어긋나는 순간
   * 어느 쪽이 참인지 알 수 없다 — 각주는 사용자도 읽는 것이라 그쪽을 정본으로 삼는다.
   */
  return !sourceNotes.some((note) => /합성값|기준 스냅샷을 유지/.test(note));
}

/** 상단 배지에 쓸 짧은 말. 좁은 화면에서도 잘려선 안 되므로 최대한 짧게. */
export function dataModeLabel(mode: string, sourceNotes: readonly string[]): string {
  if (mode !== "live") return "시연";
  return populationIsLive(mode, sourceNotes) ? "실데이터" : "시설 실데이터";
}

/** 배지 위에 뜨는 설명(title). 배지가 짧은 만큼 여기서 정확히 말한다. */
export function dataModeTitle(mode: string, sourceNotes: readonly string[]): string {
  if (mode !== "live") return "데이터: 시연용 합성값";
  return populationIsLive(mode, sourceNotes)
    ? "데이터: 실데이터"
    : "데이터: 시설만 실데이터 · 인구·세대는 기준 스냅샷(합성값)";
}
