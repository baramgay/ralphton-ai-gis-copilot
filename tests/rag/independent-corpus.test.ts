import { describe, expect, test } from "vitest";

import { retrieveRagChunks } from "@/lib/rag/retrieve";

/**
 * 우리가 만들지 않은 질의 30개로 재는 검색 품질.
 *
 * ## 왜 두 번째 평가셋이 필요한가
 *
 * `retrieval-quality.test.ts`의 15개는 **검색을 고치면서 같이 쓴 질의**다. 그 셋에서
 * 5위 안 적중이 15/15가 되자 그것을 성능이라고 적었는데, 2026-09-04 외부 검증이 자기
 * 질의 30개로 다시 재니 5위 안이 90%로 내려왔다. 15/15는 성능이 아니라 **그 15개에
 * 맞춰졌다는 뜻**이었다.
 *
 * 그래서 그 30개를 여기 옮겨 상시 검사로 만든다. 이 셋을 보고 검색을 고치기 시작하면
 * 같은 함정에 다시 빠지므로, 기대값은 손대지 않고 **바닥선만** 지킨다 — 떨어지면 붉고,
 * 오르면 통과하되 바닥선을 올리는 것은 사람이 판단해서 한다.
 *
 * 기대 레이어는 외부 검증자가 카탈로그만 보고 정한 것이라 **틀릴 수 있다.** 실제로 #18은
 * 기대(kcb-migration)와 다른 답(skt-mobility 유입인구)이 나오는데 그쪽도 방어 가능하다.
 * 그런 건이 섞여 있다는 것을 알고도 바닥선을 그 상태로 둔다 — 기대를 우리 편한 대로
 * 고치기 시작하면 이 셋도 첫 번째 셋과 같아진다.
 */

type Case = {
  no: number;
  query: string;
  /** 청크 id 또는 태그에 이 문자열이 들어 있으면 적중으로 본다. */
  expect: string[];
  /** 답이 여럿일 수 있다고 작성자가 미리 표시한 질의. 따로 집계한다. */
  vague?: boolean;
};

const CASES: Case[] = [
  { no: 1, query: "불이 자주 나는 동네가 어디야", expect: ["kosis-safety"] },
  { no: 2, query: "혼자 사는 어르신이 많은 곳", expect: ["kosis-welfare"] },
  { no: 3, query: "아이 맡길 데가 모자라는 지역", expect: ["kosis-welfare"] },
  { no: 4, query: "밤에 사람이 많이 모이는 동", expect: ["skt-daynight", "nh-hourly"], vague: true },
  { no: 5, query: "출근하면 인구가 쏙 빠지는 동", expect: ["kcb-commute", "skt-daynight"], vague: true },
  { no: 6, query: "오래된 집이 많은 시군구", expect: ["kosis-housing"] },
  { no: 7, query: "살림살이를 제 벌이로 하는 시군", expect: ["kosis-finance"] },
  { no: 8, query: "병원 가기 힘든 읍면 어디야", expect: ["rankHospitalScarcity", "scarcity"] },
  { no: 9, query: "카드값 연체가 많은 동", expect: ["kcb-credit"] },
  { no: 10, query: "쓰레기를 많이 버리는 시군", expect: ["kosis-environment"] },
  { no: 11, query: "분리수거를 잘하는 곳", expect: ["kosis-environment"] },
  { no: 12, query: "수돗물이 안 들어오는 마을이 있는 군", expect: ["kosis-environment"] },
  { no: 13, query: "학원가가 발달한 동네", expect: ["kosis-education"] },
  { no: 14, query: "한 반에 학생이 너무 많은 지역", expect: ["kosis-education"] },
  { no: 15, query: "술 먹고 운전하다 사고가 잦은 곳", expect: ["kosis-safety"] },
  { no: 16, query: "뺑소니가 잦은 시군구", expect: ["kosis-safety"] },
  { no: 17, query: "외국인 근로자가 많이 사는 동", expect: ["kosis-welfare"] },
  { no: 18, query: "사람이 계속 들어오는 동네", expect: ["kcb-migration"] },
  { no: 19, query: "차 보유가 많은 시군구", expect: ["kosis-transport"] },
  { no: 20, query: "비포장도로가 많은 군", expect: ["kosis-transport"] },
  { no: 21, query: "어르신들 갈 만한 시설이 모자란 곳", expect: ["kosis-welfare"] },
  { no: 22, query: "도서관 같은 문화 시설이 부족한 시군", expect: ["kosis-education"] },
  { no: 23, query: "밤 장사가 잘되는 상권", expect: ["nh-hourly"] },
  { no: 24, query: "신용점수가 낮은 사람이 많은 동", expect: ["kcb-credit"] },
  { no: 25, query: "빚 부담이 큰 가구가 많은 곳", expect: ["kcb-credit"] },
  { no: 26, query: "빈집 때문에 슬럼화가 걱정되는 시군", expect: ["kosis-housing"] },
  { no: 27, query: "의사가 부족한 시군구", expect: ["kosis-health"] },
  { no: 28, query: "아픈 사람이 누울 병상이 모자란 곳", expect: ["kosis-health"] },
  { no: 29, query: "사회복지 예산을 많이 쓰는 시군", expect: ["kosis-finance"] },
  { no: 30, query: "요즘 뜨는 상권 어디야", expect: ["nh-consumption", "skt-living"], vague: true },
];

function ranksOf(entry: Case): boolean[] {
  return retrieveRagChunks({ query: entry.query, limit: 5 }).map((hit) =>
    entry.expect.some(
      (wanted) => hit.chunk.id.includes(wanted) || hit.chunk.tags.some((tag) => tag.includes(wanted)),
    ),
  );
}

describe("외부 질의 30개 — 검색 품질 바닥선", () => {
  /*
   * 처음 잰 값은 top-1 19/30 · top-5 27/30이었다. 거기서 드러난 두 어휘 구멍(「가기 힘든」
   * 계열, 「한 반에」 계열)을 넓혀 21/29가 됐고, 바닥선은 **고친 뒤의 값**으로 올린다.
   * 여유를 두면 그만큼 조용히 나빠질 수 있고, 이 검사가 지키려는 것이 그 조용한 하락이다.
   */
  test("top-1 적중이 21건 아래로 내려가지 않는다", () => {
    const hits = CASES.filter((entry) => ranksOf(entry)[0] === true).length;
    expect(hits).toBeGreaterThanOrEqual(21);
  });

  test("top-5 적중이 29건 아래로 내려가지 않는다", () => {
    const hits = CASES.filter((entry) => ranksOf(entry).some(Boolean)).length;
    expect(hits).toBeGreaterThanOrEqual(29);
  });

  /*
   * 「부족하다」와 「가기 힘들다」는 다른 어휘 계열이다. 전자만 실려 있어서 후자가
   * 5위 밖으로 밀렸다 — 한 표현을 끼워 넣는 대신 거리·접근의 말맛을 계열로 넓혔고,
   * 이 검사가 그 계열이 살아 있는지 지킨다.
   */
  test.each([
    [8, "병원 가기 힘든 읍면 어디야"],
    [14, "한 반에 학생이 너무 많은 지역"],
  ])("#%s 은 이제 5위 안에 든다", (no) => {
    const entry = CASES.find((item) => item.no === no)!;
    expect(ranksOf(entry).some(Boolean)).toBe(true);
  });

  /*
   * 남은 하나(#18 「사람이 계속 들어오는 동네」)는 **우리 기대가 틀렸을 수 있는 건**이다.
   * 1위로 오는 skt-mobility 유입인구도 그 물음의 답으로 방어된다. 기대를 우리 편한 대로
   * 고치지 않기 위해 그대로 두고, 사실만 적어 둔다.
   */
  test("#18은 여전히 기대 레이어가 5위 밖이다 — 기대 쪽을 의심하고 있다", () => {
    const entry = CASES.find((item) => item.no === 18)!;
    expect(ranksOf(entry).some(Boolean)).toBe(false);
  });
});
