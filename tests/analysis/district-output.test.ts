import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { DemoSnapshotSchema } from "@/lib/domain/schemas";
import { executeAnalysisIntent } from "@/lib/analysis/tool-registry";
import { resolveQueryWithRules } from "@/lib/analysis/query-rules";

/*
 * 실제 스냅샷으로 앱 경로를 그대로 태운다. 이 두 결함은 리졸버 단위 테스트로는 안 잡힌다 —
 * 라우팅은 "시군구"라고 정확히 말하는데 **그 뒤에 나오는 결과**가 어긋나 있었다.
 *
 * 1) 도구 13개가 각자 "N개 행정동을 …" 하고 요약문을 만든다. 시군구로 합쳐 놓고 이 문장을
 *    그대로 두면 위쪽 안내는 "시군구", 결과 패널은 "행정동"이라 말한다 — 같은 화면 안에서
 *    두 문장이 모순된다(prod 실측).
 * 2) 기본 상한 20은 305개 읍면동용이다. 시군구는 22개뿐이라 2개가 화면에도 CSV에도 없이
 *    사라졌다. "더 보기"도 안 뜬다 — 더 볼 것이 없다고 판단하므로.
 */
const snapshotPath = path.join(process.cwd(), "public", "data", "demo-snapshot.json");
const snapshot = DemoSnapshotSchema.parse(JSON.parse(readFileSync(snapshotPath, "utf8")));

function run(query: string) {
  const parsed = resolveQueryWithRules(query);
  expect(parsed.intent, `"${query}" 가 도구로 라우팅되지 않았다`).not.toBeNull();
  return { parsed, result: executeAnalysisIntent(parsed.intent!, snapshot) };
}

describe("시군구 결과가 스스로를 시군구라 부른다", () => {
  test.each([
    "총인구 많은 시군구",
    "고령비율 높은 시군구",
    "세대수 많은 시군구",
    "출생 많은 시군구",
    "1인가구 많은 시군구",
  ])("%s — 요약문에 '행정동'이 남지 않는다", (query) => {
    const { result } = run(query);
    expect(result.summary).not.toMatch(/행정동/);
    expect(result.summary).toMatch(/시군구/);
    for (const note of result.formulaNotes ?? []) {
      expect(note).not.toMatch(/행정동/);
    }
  });

  test("행정동 질의의 요약문은 그대로 '행정동'이다", () => {
    const { result } = run("총인구 많은 동");
    expect(result.summary).toMatch(/행정동/);
  });
});

describe("시군구 22개가 잘리지 않는다", () => {
  test.each(["총인구 많은 시군구", "고령비율 높은 시군구", "세대수 많은 시군구"])(
    "%s — 20개가 아니라 전부 나온다",
    (query) => {
      const { result } = run(query);
      expect(result.rankedRegions.length).toBeGreaterThan(20);
    },
  );

  test("행정동은 상위 20개만 — 305개를 다 쏟지 않는다", () => {
    const { result } = run("총인구 많은 동");
    expect(result.rankedRegions).toHaveLength(20);
  });

  test("합쳐진 이름이 시군구다 — 읍면동 이름이 섞여 있지 않다", () => {
    const { result } = run("총인구 많은 시군구");
    for (const region of result.rankedRegions) {
      expect(region.adm_nm).not.toMatch(/[읍면동]$/);
      expect(region.adm_nm).toMatch(/[시군구]$/);
    }
  });
});

describe("방법론이 그 질의의 산식을 말한다", () => {
  /*
   * 공공 도구 결과는 `activeLayerId`가 "medical"인 채로 렌더돼, 화면 아래 "방법론" 칸이
   * 무엇을 물어도 의료취약지수 공식만 보여 주고 있었다(prod 실측). "세대수 많은 동"을
   * 물었는데 "공급 부족 35% + 고령 수요 25% …"가 붙어 나왔다 — 오도성이 크다.
   *
   * 도구마다 이미 제 산식을 formulaNotes로 낸다. 그것이 비어 있으면 화면이 기본값으로
   * 떨어질 수밖에 없으므로, 여기서는 **각 도구가 제 산식을 실제로 채우는지**를 잠근다.
   */
  test.each([
    "세대수 많은 동",
    "총인구 많은 동",
    "고령비율 높은 동",
    "출생 많은 동",
    "1인가구 많은 동",
    "고령비율 상승하는 동",
    "인구 늘어나는 동",
  ])("%s — 제 산식이 있고 의료취약지수가 아니다", (query) => {
    const { result } = run(query);
    expect(result.formulaNotes.length).toBeGreaterThan(0);
    expect(result.formulaNotes.join(" ")).not.toMatch(/의료취약지수|공급 부족 35%/);
  });

  test("의료 취약 질의는 제 산식을 말한다", () => {
    const { result } = run("의료 취약한 동");
    expect(result.formulaNotes.length).toBeGreaterThan(0);
  });
});

describe("조사까지 바꾼다", () => {
  test("\"22개 행정동을\"이 \"22개 시군구을\"이 되지 않는다", () => {
    // 동은 받침이 있고 구는 없다. 낱말만 갈아 끼우면 조사가 깨진다(prod 실측).
    const { result } = run("총인구 많은 시군구");
    expect(result.summary).not.toMatch(/시군구을|시군구은|시군구이 |시군구과/);
    expect(result.summary).toMatch(/시군구를|시군구는|시군구가|시군구 순/);
  });
});
