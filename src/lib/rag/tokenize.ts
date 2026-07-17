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
