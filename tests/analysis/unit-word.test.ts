import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

import { UNIT_WORD_SOURCES } from "./unit-word-sources";

/*
 * 같은 공간 단위를 화면 한 곳에서는 「읍면동」, 다른 곳에서는 「행정동」이라고 불렀다.
 * 사용자는 「읍면동」이라 적힌 버튼을 누르고 「행정동 305개」라는 답을 받았다 — 같은 것을
 * 말하는지 알 수 없다.
 *
 * 정본은 용어집 표제어인 「행정동」이다(표제어가 「행정동(읍면동)」이라 두 낱말을 잇는
 * 자리는 거기 하나뿐이다). 사용자 **입력**을 알아듣는 낱말 목록은 여기 대상이 아니다 —
 * 사람은 「읍면동」이라고도 친다.
 */
describe("공간 단위 낱말", () => {
  test("화면 문구에 「읍면동」이 남아 있지 않다", () => {
    const stray: string[] = [];
    for (const file of UNIT_WORD_SOURCES) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        if (!line.includes("읍면동")) return;
        // 용어집 표제어만 예외다.
        if (line.includes('term: "행정동(읍면동)"')) return;
        stray.push(`${file}:${index + 1} ${line.trim().slice(0, 70)}`);
      });
    }
    expect(stray).toEqual([]);
  });

  test("모수가 줄지 않았다", () => {
    // 목록에서 파일을 빼면 위 검사는 조용히 초록이 된다.
    expect(UNIT_WORD_SOURCES.length).toBeGreaterThanOrEqual(13);
    for (const file of UNIT_WORD_SOURCES) expect(readFileSync(file, "utf8").length).toBeGreaterThan(0);
  });
});
