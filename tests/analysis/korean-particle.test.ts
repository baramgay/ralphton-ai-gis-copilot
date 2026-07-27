import { describe, expect, test } from "vitest";

import { subjectOf, topicOf } from "@/lib/analysis/korean-particle";

/**
 * "진주시은 …", "김해시이(가) …"가 그대로 화면과 보고서에 실리고 있었다.
 * 공공기관 보고서로 나가는 문장이라 조사 하나가 눈에 띈다.
 */
describe("조사", () => {
  test.each([
    ["김해시", "김해시가", "김해시는"],
    ["진주시", "진주시가", "진주시는"],
    ["진영읍", "진영읍이", "진영읍은"],
    ["물금읍", "물금읍이", "물금읍은"],
    ["창원시성산구", "창원시성산구가", "창원시성산구는"],
    ["북상면", "북상면이", "북상면은"],
  ])("%s", (word, subject, topic) => {
    expect(subjectOf(word)).toBe(subject);
    expect(topicOf(word)).toBe(topic);
  });

  test("한글이 아닌 끝글자는 받침 있는 쪽으로 둔다", () => {
    // 격자 이름처럼 숫자로 끝나는 경우가 있다. 틀리더라도 한쪽으로 일관되게.
    expect(topicOf("500m격자 3")).toBe("500m격자 3은");
  });
});

describe("교차 해석 문장의 조사", () => {
  test("괄호로 끝나도 앞 글자로 판단하지 않는다", () => {
    // "전입인구(KCB)이 가장 부족한"처럼 나가고 있었다. 괄호는 한글이 아니라
    // 받침 있는 쪽으로 일관 처리한다(둘 다 어색하지만 한쪽으로 고정).
    expect(subjectOf("전입인구(KCB)")).toBe("전입인구(KCB)이");
  });
});
