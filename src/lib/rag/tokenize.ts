/**
 * Lightweight tokenizer for Korean + Latin GIS queries.
 * No external embedding dependency (offline-first demo).
 */

const STOP = new Set([
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "에",
  "와",
  "과",
  "도",
  "로",
  "으로",
  "에서",
  "하다",
  "있는",
  "없는",
  "해주세요",
  "해줘",
  "보여줘",
  "알려줘",
  "주세요",
  "the",
  "a",
  "of",
  "and",
  "to",
  "in",
]);

/**
 * 낱말 끝에 붙는 조사·어미. 긴 것부터 본다 — "에서"를 "서"보다 먼저 떼야 한다.
 *
 * 형태소 분석기를 붙이지 않는 이유는 이 코퍼스가 지표 이름 중심이라 어간만 살려도
 * 대부분 닿기 때문이다. 다만 **한 글자 어간을 버리면 안 된다** — 「빚이 많은 지역」의
 * "빚", 「불이 자주 나는」의 "불", 「차를 많이 가진」의 "차"가 전부 한 글자다.
 * 이것들이 빠져 있어서 카탈로그에 「빚」트리거가 있는데도 검색이 못 찾았다(실측).
 */
const PARTICLES = [
  "에서는",
  "에서",
  "으로",
  "이나",
  "라도",
  "처럼",
  "보다",
  "밖에",
  "까지",
  "부터",
  "한테",
  "에게",
  "이랑",
  "이라",
  "이다",
  "인가",
  "은",
  "는",
  "이",
  "가",
  "을",
  "를",
  "의",
  "에",
  "도",
  "로",
  "와",
  "과",
  "만",
  "랑",
];

/** 조사를 뗀 어간. 뗄 것이 없으면 null. */
export function stripParticle(word: string): string | null {
  if (!/^[가-힣]+$/.test(word) || word.length < 2) return null;
  for (const particle of PARTICLES) {
    if (word.length > particle.length && word.endsWith(particle)) {
      return word.slice(0, word.length - particle.length);
    }
  }
  return null;
}

export function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s가-힣]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return [];

  const raw = normalized.split(" ").filter(Boolean);
  const tokens: string[] = [];

  for (const part of raw) {
    if (part.length >= 2 && !STOP.has(part)) tokens.push(part);

    /*
     * 한 글자 낱말도 색인에 넣는다. 위 `length >= 2` 문턱 때문에 카탈로그의 「빚」·「불」
     * 같은 트리거가 **코퍼스 쪽에서도** 통째로 빠져 있었다 — 질의를 아무리 고쳐도 닿을
     * 수 없는 상태였다. 흔한 한 글자는 STOP과 IDF가 걸러 준다.
     */
    if (part.length === 1 && /[가-힣]/.test(part) && !STOP.has(part)) tokens.push(part);

    const stem = stripParticle(part);
    if (stem && !STOP.has(stem)) tokens.push(stem);
    // Character n-grams for Korean compounds (2–3)
    if (/[가-힣]{2,}/.test(part)) {
      for (let i = 0; i < part.length - 1; i += 1) {
        tokens.push(part.slice(i, i + 2));
      }
      if (part.length >= 3) {
        for (let i = 0; i < part.length - 2; i += 1) {
          tokens.push(part.slice(i, i + 3));
        }
      }
    }
  }

  return [...new Set(tokens)];
}

export function termFrequency(tokens: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const token of tokens) {
    map.set(token, (map.get(token) ?? 0) + 1);
  }
  return map;
}
