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
   *
   * "기준 스냅샷"이 들어간 각주는 전부 걸러야 한다. live-sync는 두 문장을 쓴다:
   * 전부 실패하면 "인구·세대 시계열은 검증된 기준 스냅샷을 유지합니다", 일부 성공하면
   * "인구: 경남 최신월 일부 live 반영(N개 동). 나머지 시계열은 기준 스냅샷." — 후자가
   * 더 위험하다. `mergeLatestPopulation`은 **최신월 한 칸만** 바꾸므로, 그 상태의
   * 12개월 추세는 실측 1개월과 합성 12개월을 비교하는 셈이 된다.
   */
  /*
   * **인구·세대를 말하는** 각주만 본다. 백필이 성공하면 출생·사망은 여전히 합성값이라
   * "출생·사망 값은 합성값입니다" 각주가 남는데, 그걸로 인구까지 합성이라 판정하면
   * 영영 "실데이터"가 되지 못한다. 반대로 대상을 안 가리고 "실데이터"라 부르면
   * 합성 인구가 보고서에 실린다 — 양쪽 다 틀린다.
   */
  return !sourceNotes.some(
    (note) => /인구|세대/.test(note) && /합성|기준 스냅샷/.test(note),
  );
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

/**
 * 제공기관을 출처 문구로. 「SKT 민간데이터」와 「KOSIS 국가통계」는 성격이 다르므로
 * 한 낱말로 뭉뚱그리면 안 된다 — 공공기관 보고서에 그대로 인용되는 문장이다.
 */
export function providerSourceLabel(provider: string): string {
  if (provider === "KOSIS") return "KOSIS 국가통계";
  if (provider === "공공") return "공공데이터";
  return `${provider} 민간데이터`;
}

/** 화면 배너의 정본 문장. 인구 파생 순위를 내보낼 때 산출물에도 그대로 싣는다. */
export const POPULATION_CITATION_WARNING =
  "인구·세대·출생·사망은 합성값이라 대외 수치로 인용하지 마세요.";

/**
 * 지금 내보내는 순위가 스냅샷 인구·세대·출생·사망에서 나왔는가.
 *
 * 시설·KOSIS·SKT·NH·KCB 순위에는 합성 인구 경고를 붙이지 않는다. 그쪽은 실측이다.
 */
export function isSnapshotPopulationRanking(input: {
  isFacilityResult?: boolean;
  layerId?: string;
  title?: string;
  formulaNotes?: readonly string[];
}): boolean {
  if (input.isFacilityResult) return false;
  const layerId = input.layerId ?? "";
  if (/^(skt-|nh-|kcb-|kosis)/.test(layerId) || layerId === "cross") return false;
  if (layerId === "population") return true;
  const text = `${input.title ?? ""} ${(input.formulaNotes ?? []).join(" ")}`;
  if (/취약지수|의료 접근성/.test(text)) return false;
  return /고령화율|고령비율|인구밀도|1인.?가구|자연증가|출생|사망|총인구|세대수|주민등록 인구/.test(
    text,
  );
}

/**
 * 산출물·결과 칩에 쓸 자료 성격.
 *
 * 스냅샷 mode 만 보면 고령화율도 KOSIS도 같이 「실데이터」가 된다. 인구가 합성인데
 * 지금 순위가 그 인구에서 나왔을 때만 「시설 실데이터」다.
 */
export function exportModeLabel(
  mode: string,
  sourceNotes: readonly string[],
  populationDerived: boolean,
): string {
  if (mode !== "live") return dataModeLabel(mode, sourceNotes);
  if (populationDerived && !populationIsLive(mode, sourceNotes)) return "시설 실데이터";
  return "실데이터";
}

/** 산출물에 내부 저장소 이름을 싣지 않는다. 없으면 그 줄을 뺀다. */
export function exportSourceLabel(source: string): string | null {
  if (source === "supabase-cache" || source === "loading") return null;
  if (source === "demo" || source === "demo-fallback") return "시연 자료";
  return source;
}

export function populationCitationWarning(
  mode: string,
  sourceNotes: readonly string[],
  populationDerived: boolean,
): string | null {
  if (!populationDerived) return null;
  if (populationIsLive(mode, sourceNotes)) return null;
  return POPULATION_CITATION_WARNING;
}
