/**
 * 자료가 **어느 창구로** 들어왔는가.
 *
 * 제공기관(SKT·NH·KCB·경상남도)과 제공 창구(경남빅데이터허브플랫폼)는 다른 것이다.
 * 지금까지 화면에는 기관 이름만 적혀 있어서, 이 도구가 쓰는 자료 열두 갈래가 어느
 * 플랫폼을 통해 들어온 것인지 **어디에도 남지 않았다**. 출처를 물으면 「SKT」라고만
 * 답하는 셈이라, 자료를 내준 쪽이 화면에 없다.
 *
 * 그래서 창구를 기관과 나란히 적는다. 기관 이름은 그대로 둔다 — 창구가 기관을
 * 대신하는 것이 아니라 한 줄 더 붙는 것이다.
 *
 * 어디에 붙는가(전부 이 상수 하나를 본다):
 *   - 레이어를 바꿀 때 뜨는 출처 문구(`providerSourceLabel`)
 *   - 활용 데이터 패널의 제공기관 묶음과 요약
 *   - 레이어 목록의 「민간」 묶음 설명
 *   - 검색 코퍼스(창구 이름으로 물어도 답이 나오게)
 */

export const HUB_PLATFORM = "경남빅데이터허브플랫폼";

export const HUB_PLATFORM_URL = "https://bigdata.gyeongnam.go.kr";

/** 창구가 무엇인지 한 줄. 이름만 적으면 처음 보는 사람은 무엇인지 모른다. */
export const HUB_PLATFORM_NOTE =
  "경상남도가 운영하는 데이터 창구입니다. 이 도구가 쓰는 이동통신·카드·신용·기업 자료를 여기서 받았습니다.";

/**
 * 이 창구로 들어온 제공기관.
 *
 * 주민등록 인구·의료기관(공공)과 국가통계포털(KOSIS)은 각자의 창구에서 직접 받는다.
 * 안 온 것을 왔다고 적으면 출처가 틀리는 것이므로 넷만 넣는다.
 */
const HUB_PROVIDERS: ReadonlySet<string> = new Set(["SKT", "NH", "KCB", "경상남도"]);

export function isHubProvider(provider: string): boolean {
  return HUB_PROVIDERS.has(provider);
}

/** 이 창구로 들어온 제공기관 이름들(표시 순서는 부르는 쪽이 정한다). */
export function hubProviders(): string[] {
  return [...HUB_PROVIDERS];
}

/**
 * 출처 문구 끝에 창구를 붙인다.
 *
 * 내보낸 표·보고서의 「출처」 한 줄은 그대로 공공기관 자료에 인용된다. 기관 약칭만
 * 적히면 그 자료를 내준 플랫폼이 인용문에서 사라진다. 창구 없는 자료(주민등록·의료기관·
 * 국가통계)만 쓴 결과에는 붙이지 않는다 — 안 온 곳을 적으면 출처가 틀린다.
 *
 * 결과를 만든 자리마다 제공기관을 이미 알고 있으므로 그것을 넘긴다. 완성된 문장을
 * 되짚어 기관 이름을 찾는 방식은 문구를 다듬는 순간 조용히 어긋난다.
 */
export function withHubChannel(source: string, providers: readonly string[]): string {
  return providers.some(isHubProvider) ? `${source} · ${HUB_PLATFORM}` : source;
}
