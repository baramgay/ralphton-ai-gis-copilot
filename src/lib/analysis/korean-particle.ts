/**
 * 받침에 맞는 조사.
 *
 * "진주시은 …", "김해시이(가) …"처럼 나가면 그대로 보고서에 실린다. 한글 음절은
 * 0xAC00부터 종성 28개 단위로 배열돼 있어, 나머지가 0이면 받침이 없다.
 * 한글이 아닌 글자로 끝나면 판단하지 않고 받침 있는 쪽을 쓴다(숫자·영문 혼용 대비).
 */
function hasFinalConsonant(word: string): boolean {
  const last = word.trim().slice(-1);
  const code = last.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return true;
  return (code - 0xac00) % 28 !== 0;
}

/** 주격 조사: 이/가 */
export function subjectOf(word: string): string {
  return `${word}${hasFinalConsonant(word) ? "이" : "가"}`;
}

/** 보조사(주제): 은/는 */
export function topicOf(word: string): string {
  return `${word}${hasFinalConsonant(word) ? "은" : "는"}`;
}
