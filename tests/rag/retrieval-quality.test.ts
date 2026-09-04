import { describe, expect, test } from "vitest";

import { metricChunkId } from "@/lib/rag/catalog-chunks";
import { expandSynonyms, retrieveRagChunks } from "@/lib/rag/retrieve";
import { stripParticle, tokenize } from "@/lib/rag/tokenize";

/**
 * 검색 품질 회귀선.
 *
 * 코퍼스가 79개 지표로 늘면서 "있다"와 "찾힌다"의 거리가 벌어졌다. 계약 검사
 * (`catalog-coverage`)는 **지표 자기 낱말**로 찾히는지만 본다 — 사람은 그렇게 묻지
 * 않는다. 여기서는 지표 이름을 한 번도 쓰지 않은 말로 묻고, 정답이 몇 위에 오는지 센다.
 *
 * 숫자를 못 박아 두는 이유는 검색을 손볼 때마다 **좋아졌는지 나빠졌는지**를 눈이 아니라
 * 값으로 판정하기 위해서다. 실제로 동의어 하나를 잘못 넓혔다가 되던 질의를 3위 밖으로
 * 밀어낸 적이 있다(「병원이 부족한 동」이 공공 의료취약 도구를 놓쳤다).
 */
const CASES: Array<[string, string, string]> = [
  ["불이 자주 나는 지역이 어디야", "kosis-safety", "fire_rate"],
  ["교통사고가 잦은 시군", "kosis-safety", "accident_rate"],
  ["아이 맡길 데가 부족한 곳", "kosis-welfare", "childcare"],
  ["혼자 사시는 어르신이 많은 지역", "kosis-welfare", "solo_elderly"],
  ["의사가 모자란 시군", "kosis-health", "doctors"],
  ["집이 비어 있는 곳이 많은 시군", "kosis-housing", "vacant"],
  ["재정이 취약한 지자체", "kosis-finance", "fiscal_independence"],
  ["차를 많이 가진 지역", "kosis-transport", "car_per_person"],
  ["쓰레기를 많이 버리는 시군", "kosis-environment", "waste_per_person"],
  ["학원이 몰려 있는 곳", "kosis-education", "academy"],
  ["낮에 사람이 많은 동네", "skt-daynight", "day_population"],
  ["장사가 잘되는 상권", "nh-consumption", "card_sales"],
  ["잘 사는 동네", "kcb-credit", "avg_income"],
  ["빚이 많은 지역", "kcb-credit", "loan_ratio"],
  ["출퇴근으로 빠져나가는 동네", "kcb-commute", "outbound_ratio"],
];

function rankOf(query: string, layerId: string, metricKey: string): number {
  const want = metricChunkId(layerId, metricKey);
  return retrieveRagChunks({ query, limit: 5 }).findIndex((hit) => hit.chunk.id === want);
}

describe("검색 품질 — 지표 이름을 쓰지 않은 말로 물었을 때", () => {
  const ranks = CASES.map(([q, l, m]) => rankOf(q, l, m));
  const within = (k: number) => ranks.filter((rank) => rank >= 0 && rank < k).length;

  test("절반 이상이 1위로 온다", () => {
    // 현재 10/15. 하나쯤 흔들려도 붉어지지 않게 9로 두되, 그 아래로는 회귀로 본다.
    expect(within(1)).toBeGreaterThanOrEqual(9);
  });

  test("대부분이 3위 안에 온다", () => {
    expect(within(3)).toBeGreaterThanOrEqual(12);
  });

  test("5위 안에 하나도 빠지지 않는다", () => {
    const missed = CASES.filter((_, i) => ranks[i] < 0).map(([q]) => q);
    expect(missed).toEqual([]);
  });
});

describe("한국어 어간", () => {
  test.each([
    ["빚이", "빚"],
    ["불이", "불"],
    ["차를", "차"],
    ["재정이", "재정"],
    ["시군에서", "시군"],
    ["소득으로", "소득"],
  ])("%s → %s", (word, stem) => {
    expect(stripParticle(word)).toBe(stem);
  });

  test("조사가 없으면 뗄 것이 없다", () => {
    expect(stripParticle("화재")).toBeNull();
    expect(stripParticle("a")).toBeNull();
  });

  test("한 글자 어간이 색인에 들어간다", () => {
    /*
     * 예전에는 `length >= 2` 문턱 때문에 카탈로그의 「빚」트리거가 **코퍼스 쪽에서도**
     * 통째로 빠져 있었다 — 질의를 아무리 고쳐도 닿을 수 없는 상태였다.
     */
    expect(tokenize("빚이 많은 지역")).toContain("빚");
    expect(tokenize("빚")).toContain("빚");
  });
});

describe("질의 동의어", () => {
  test("사람 말을 코퍼스 말로 넓힌다", () => {
    expect(expandSynonyms("어르신이 많은 곳")).toContain("노인");
    expect(expandSynonyms("지자체 살림")).toContain("시군구");
  });

  test("원문을 지우지 않고 덧붙인다", () => {
    expect(expandSynonyms("어르신이 많은 곳")).toContain("어르신");
  });

  test("해당 없으면 그대로 둔다", () => {
    expect(expandSynonyms("생활인구")).toBe("생활인구");
  });

  test("병원·의사는 넓히지 않는다 — 넓혔더니 되던 질의가 깨졌다", () => {
    /*
     * 「병원이 부족한 동 어디야」의 정답은 공공 의료취약지수 도구다. 「의사·병원」을
     * 의료기관 쪽으로 넓혔더니 KOSIS 의사수 지표가 그 도구를 3위 밖으로 밀어냈다.
     * (「부족」쪽 확장은 그대로 둔다 — 그것이 밀어낸 것이 아니었다.)
     */
    expect(expandSynonyms("병원이 부족한 동")).not.toContain("의료기관");
    const hits = retrieveRagChunks({ query: "병원이 부족한 동 어디야", limit: 3 });
    expect(hits.map((hit) => hit.chunk.id)).toContain("tool-scarcity");
  });
});

describe("지표 청크가 레이어 청크보다 앞선다", () => {
  /*
   * 레이어 청크는 그 레이어의 지표 이름을 전부 싣고 있어서 어느 질의에나 조금씩 걸린다.
   * 그 넓이가 좁고 정확한 지표 청크를 이기면, 모델이 받는 첫 문서가 「안전 레이어에는
   * 지표가 4종 있다」가 되어 정작 어느 지표인지 못 고른다.
   *
   * ⚠️ 이 검사는 위 문턱과 **따로** 있어야 한다. 문턱만으로는 우선순위를 없애도 초록이
   * 나온다(결함 주입으로 확인). 기전을 지키려면 기전을 직접 봐야 한다.
   */
  test.each([
    ["교통사고가 잦은 시군", "kosis-safety", "accident_rate"],
    ["학원이 몰려 있는 곳", "kosis-education", "academy"],
  ])("%s — 지표가 레이어보다 위", (query, layerId, metricKey) => {
    const ids = retrieveRagChunks({ query, limit: 5 }).map((hit) => hit.chunk.id);
    const metricAt = ids.indexOf(metricChunkId(layerId, metricKey));
    const layerAt = ids.indexOf(`layer-${layerId}`);

    expect(metricAt).toBeGreaterThanOrEqual(0);
    if (layerAt >= 0) expect(metricAt).toBeLessThan(layerAt);
  });
});
