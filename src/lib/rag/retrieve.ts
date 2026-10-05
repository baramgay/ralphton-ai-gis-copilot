import { RAG_CORPUS, type RagChunk } from "./corpus";
import { cosineSimilarity, hashEmbed } from "./hash-embed";
import { termFrequency, tokenize, tokenizeWords } from "./tokenize";
import { ragQueryIssue } from "./query-scope";
import { DISTRICT_ALIASES } from "@/lib/analysis/query-catalog-meta";
import { getAllPlaces } from "@/lib/geo/place-index";

export type RagHit = {
  chunk: RagChunk;
  score: number;
  reasons: string[];
  lexicalScore?: number;
  vectorScore?: number;
  /** Explicit registered subject match; body mentions do not set this priority. */
  subjectMatchLength?: number;
};

export type RetrieveOptions = {
  query: string;
  limit?: number;
  /** Boost chunks whose tags intersect these values (tool ids, metrics). */
  boostTags?: string[];
  corpus?: RagChunk[];
  /** Optional remote embedding vectors aligned with corpus order (advanced). */
  queryVector?: number[];
  chunkVectors?: Map<string, number[]>;
  /** Weights for hybrid fusion (default 0.55 lexical / 0.45 vector). */
  lexicalWeight?: number;
  vectorWeight?: number;
};

/**
 * 질의 쪽 동의어 확장.
 *
 * 사람은 지표 이름으로 묻지 않는다 — 「어르신」이라 하고 코퍼스에는 「노인」이 있다.
 * 카탈로그 트리거를 건드리지 않고 **질의만** 넓히는 이유는, 트리거가 자연어 라우팅의
 * 정본이라 손대면 8라운드에 걸쳐 회귀로 잠근 판정이 함께 흔들리기 때문이다. 검색은
 * 틀려도 후보가 하나 더 붙을 뿐이지만 라우팅이 틀리면 다른 답을 자신 있게 낸다.
 *
 * 원문을 지우지 않고 **덧붙인다.** 「어르신」이 실제로 실린 문서가 있을 수도 있다.
 */
const QUERY_SYNONYMS: Array<[RegExp, string]> = [
  [/어르신|노인분|고령자/, "노인 고령"],
  [/지자체|기초단체|시군/, "시군구"],
  [/애기|아기|영유아|유아/, "보육 어린이집"],
  [/불이 |화재/, "화재 소방"],
  [/빚|대출/, "대출 부채"],
  [/사망자|사망\s*(?:인원|인구)/, "사망"],
  [/비포장/, "포장도로 도로포장률"],
  [/장사|상권|매출/, "카드매출 소비"],
  [/집값|주택가격/, "주택 매매"],
  [/빈\s*집|빈집|공가|집(?:이|은)?\s*비어/, "빈집 미거주"],
  [/재정|살림/, "재정자립도 재정자주도"],
  [/차량|자동차|차를/, "자동차 등록"],
  [/쓰레기|폐기물/, "생활폐기물 배출"],
  [/학원|사교육/, "사설학원 교육"],
  /*
   * 「의사·병원·진료」는 넓히지 않는다.
   *
   * 넓혔더니 「병원이 부족한 동 어디야」가 공공 의료취약지수 도구(tool-scarcity)를 3위
   * 밖으로 밀어냈다 — 그 질의의 정답이 바로 그 도구다. 코퍼스에 이미 그 낱말들이 실려
   * 있어 넓힐 이유도 없었다. 되던 것을 막는 것이 원래 결함보다 나쁘다.
   */
  [/일자리|직장|출퇴근|통근/, "통근 일자리"],
  [/취약|부족|모자란|열악/, "취약 부족"],
  /*
   * **닿기 어렵다**는 말은 「부족하다」와 다른 어휘 계열이다.
   *
   * 「병원이 부족한 동」은 통과하는데 「병원 가기 힘든 읍면」은 의료취약지수 도구가 5위
   * 밖으로 밀렸다(외부 질의 30개 실측). 한 표현만 끼워 넣으면 다음 표현에서 또 밀리므로
   * **거리·접근의 말맛**을 계열로 넓힌다 — 이 도구의 산식에 이미 「최근접 거리」와
   * 「2km 무시설」이 들어 있어, 그 낱말들로 이어 주는 것이 뜻에 맞다.
   */
  [/가기 (힘든|어려운|불편)|닿기 (힘든|어려운)|찾아가기|멀어서|접근성/, "취약 접근 거리 최근접"],
  /*
   * 학급당 학생수는 카탈로그에 「학급당」으로만 실려 있어, 사람들이 실제로 쓰는
   * 「한 반에 몇 명」과 낱말이 닿지 않는다.
   */
  [/한 반에|반 학생|과밀학급|학급 규모/, "학급당 학생수"],
];

export function expandSynonyms(query: string): string {
  const extras: string[] = [];
  for (const [pattern, addition] of QUERY_SYNONYMS) {
    if (pattern.test(query)) extras.push(addition);
  }
  return extras.length > 0 ? `${query} ${extras.join(" ")}` : query;
}

/** Precompute document frequencies once per corpus instance. */
function retrievalText(chunk: RagChunk): string {
  // Limitations often contrast a different observation. They stay in returned context, not subject matching.
  const definition = chunk.body.split(/한계:/, 1)[0];
  return `${chunk.title} ${definition} ${chunk.keywords.join(" ")}`;
}

function buildIdf(corpus: RagChunk[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const chunk of corpus) {
    const unique = new Set(tokenize(retrievalText(chunk)));
    for (const token of unique) {
      df.set(token, (df.get(token) ?? 0) + 1);
    }
  }
  const n = corpus.length;
  const idf = new Map<string, number>();
  for (const [token, count] of df) {
    idf.set(token, Math.log(1 + n / (1 + count)));
  }
  return idf;
}

const DEFAULT_IDF = buildIdf(RAG_CORPUS);

function indexChunk(chunk: RagChunk) {
  const text = retrievalText(chunk);
  const tokens = tokenize(text);
  const subjects = [chunk.title, ...chunk.keywords].map((subject) => ({
    phrase: subject.toLowerCase().replace(/\s+/g, ""), words: tokenizeWords(subject),
  }));
  const subjectWords = new Set(tokenizeWords(text));
  return { chunk, text, tokens, tf: termFrequency(tokens), words: new Set(tokenizeWords(text)), subjects, subjectWords };
}

const DEFAULT_INDEX = RAG_CORPUS.map(indexChunk);
const DEFAULT_REGISTERED_WORDS = new Set(RAG_CORPUS.flatMap((chunk) => chunk.keywords.flatMap(tokenizeWords)));

// Space and ranking instructions are not evidence for a metric's subject.
const QUERY_STRUCTURE_WORDS = new Set([
  "지역", "동네", "행정동", "시군구", "시군", "지자체", "곳", "동", "읍", "면", "읍면", "군", "시", "구",
  "높은", "낮은", "많은", "적은", "높", "낮", "많", "적", "어디", "어디야", "어느", "자료", "지표",
  "비교", "수준", "찾고", "싶어", "기준", "관련",
]);

// A place scopes a question; it does not provide evidence for its subject.
const PLACE_WORDS = new Set(tokenizeWords([
  "경남 경상남도",
  ...Object.keys(DISTRICT_ALIASES), ...Object.values(DISTRICT_ALIASES),
  ...getAllPlaces().map((place) => `${place.shortName} ${place.adm_nm}`),
].join(" ")));

function evidenceQuery(query: string, corpus: RagChunk[]): { tokens: string[]; words: string[] } {
  const expanded = expandSynonyms(query);
  const registeredWords = corpus === RAG_CORPUS
    ? DEFAULT_REGISTERED_WORDS
    : new Set(corpus.flatMap((chunk) => chunk.keywords.flatMap(tokenizeWords)));
  const suffixSubjects = tokenizeWords(expanded).flatMap((word) => {
    const subject = word.replace(/(?:순위|비교)$/, "");
    return subject !== word && registeredWords.has(subject) ? [subject] : [];
  });
  const text = `${expanded} ${suffixSubjects.join(" ")}`;
  return {
    tokens: tokenize(text),
    words: tokenizeWords(text).filter((word) => !QUERY_STRUCTURE_WORDS.has(word) && !PLACE_WORDS.has(word)),
  };
}

/** Cached hash embeddings for default corpus */
const DEFAULT_CHUNK_VECTORS = new Map<string, number[]>(
  RAG_CORPUS.map((chunk) => [
    chunk.id,
    hashEmbed(retrievalText(chunk)),
  ]),
);

function bm25LiteScore(
  queryTokens: string[],
  tf: Map<string, number>,
  dl: number,
  idf: Map<string, number>,
  corpusSize: number,
): number {
  if (queryTokens.length === 0 || dl === 0) return 0;
  const avgDl = 80;
  const k1 = 1.4;
  const b = 0.75;
  let score = 0;
  for (const token of queryTokens) {
    const f = tf.get(token) ?? 0;
    if (f === 0) continue;
    const idfWeight = idf.get(token) ?? Math.log(1 + corpusSize);
    const denom = f + k1 * (1 - b + (b * dl) / avgDl);
    score += idfWeight * ((f * (k1 + 1)) / denom);
  }
  return score;
}

function normalizeScores(values: number[]): number[] {
  const max = Math.max(...values, 1e-9);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  return values.map((value) => (value - min) / span);
}

/**
 * Hybrid retrieval: BM25-lite + hashed vector cosine (+ optional remote vectors).
 * Deterministic offline by default.
 */
export function retrieveRagChunks(options: RetrieveOptions): RagHit[] {
  if (ragQueryIssue(options.query)) return [];
  const limit = options.limit ?? 4;
  const corpus = options.corpus ?? RAG_CORPUS;
  const idf = corpus === RAG_CORPUS ? DEFAULT_IDF : buildIdf(corpus);
  const { tokens: queryTokens, words: queryWords } = evidenceQuery(options.query, corpus);
  const documents = corpus === RAG_CORPUS ? DEFAULT_INDEX : corpus.map(indexChunk);
  // A shared whole word is required before n-grams or vectors can rank evidence.
  if (!documents.some((doc) => queryWords.some((word) => doc.words.has(word)))) return [];
  const boostTags = new Set(options.boostTags ?? []);
  const queryLower = options.query.toLowerCase();
  const queryCompact = queryLower.replace(/\s+/g, "");
  // Expansion helps recall; it must not invent extra subjects that defeat the explicit question.
  const coverageWords = tokenizeWords(options.query).filter((word) => !QUERY_STRUCTURE_WORDS.has(word) && !PLACE_WORDS.has(word));
  const lw = options.lexicalWeight ?? 0.55;
  const vw = options.vectorWeight ?? 0.45;

  const queryHash = options.queryVector ?? hashEmbed(options.query);
  const chunkVectors =
    options.chunkVectors ??
    (corpus === RAG_CORPUS
      ? DEFAULT_CHUNK_VECTORS
      : new Map(
          corpus.map((chunk) => [
            chunk.id,
            hashEmbed(retrievalText(chunk)),
          ]),
        ));

  const raw = documents.map(({ chunk, text: docText, tokens: docTokens, tf, words, subjects, subjectWords }) => {
    let lexical = bm25LiteScore(queryTokens, tf, docTokens.length, idf, corpus.length);
    const hasEvidence = lexical > 0 && queryWords.some((word) => words.has(word));
    const subjectCoverage = coverageWords.filter((word) => subjectWords.has(word)).length;
    const subjectMatchLength = Math.max(0, ...subjects.filter(({ phrase, words: subjectWords }) =>
      queryCompact.includes(phrase) && subjectWords.some((word) => !QUERY_STRUCTURE_WORDS.has(word) && !PLACE_WORDS.has(word)),
    ).map(({ phrase }) => phrase.length));
    const reasons: string[] = [];

    if (lexical > 0) reasons.push("lexical");

    for (const keyword of chunk.keywords) {
      if (queryLower.includes(keyword.toLowerCase()) || options.query.includes(keyword)) {
        lexical += 2.2;
        reasons.push(`kw:${keyword}`);
      }
    }

    for (const tag of chunk.tags) {
      if (boostTags.has(tag)) {
        lexical += 3.5;
        reasons.push(`tag:${tag}`);
      }
    }

    if (options.query.includes(chunk.title.slice(0, 4))) {
      lexical += 1.2;
      reasons.push("title");
    }

    const docVec = chunkVectors.get(chunk.id) ?? hashEmbed(docText);
    const vector = cosineSimilarity(queryHash, docVec);
    if (vector > 0.05) reasons.push("vector");

    if (subjectMatchLength > 0 && hasEvidence) reasons.push("registered-subject");
    return { chunk, lexical, vector, hasEvidence, subjectMatchLength, subjectCoverage, reasons: [...new Set(reasons)] };
  });

  const lexNorm = normalizeScores(raw.map((row) => row.lexical));
  const vecNorm = normalizeScores(raw.map((row) => row.vector));
  const maxSubjectCoverage = Math.max(0, ...raw.map((row) => row.subjectCoverage));

  const hits: RagHit[] = raw.map((row, index) => {
    /*
     * 지표 청크가 레이어 청크보다 앞선다.
     *
     * 레이어 청크는 그 레이어의 지표 이름을 **전부** 싣고 있어서 어느 질의에나 조금씩
     * 걸린다. 그 넓이가 좁고 정확한 지표 청크를 이기면, 모델이 받는 첫 문서가 「안전
     * 레이어에는 지표가 4종 있다」가 되어 정작 어느 지표인지 못 고른다(실측: 「교통사고가
     * 잦은 시군」·「의사가 모자란 시군」이 둘 다 레이어 청크를 1위로 받았다).
     *
     * 레이어 청크를 지우지 않는 이유는 "이 레이어에 무엇이 있나"를 묻는 질의에는
     * 그쪽이 맞는 답이기 때문이다. 순서만 뒤로 민다.
     */
    const isLayerChunk = row.chunk.tags.includes("layer");
    const specificity = isLayerChunk ? 0.65 : 1;
    /* 0.8로는 「교통사고가 잦은 시군」에서 레이어가 여전히 이겼다(기전 검사가 잡았다). */
    const score = (lw * lexNorm[index] + vw * vecNorm[index]) * specificity;
    // Preserve absolute signal: zero both → drop
    const dead = !row.hasEvidence;
    return {
      chunk: row.chunk,
      score: dead ? 0 : score + row.lexical * 0.02 * specificity,
      reasons: row.reasons,
      lexicalScore: row.lexical,
      vectorScore: row.vector,
      // A broad one-word topic must not displace a document covering the question's combined subjects.
      subjectMatchLength: row.subjectCoverage === maxSubjectCoverage ? row.subjectMatchLength : 0,
    };
  });

  return hits
    .filter((hit) => hit.score > 0.08)
    .sort((a, b) => (b.subjectMatchLength ?? 0) - (a.subjectMatchLength ?? 0) || b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, limit);
}

export function buildRagContext(hits: RagHit[], maxChars = 1200): { context: string; hits: RagHit[] } {
  const parts: string[] = [];
  const included: RagHit[] = [];
  let used = 0;
  for (const hit of hits) {
    const block = `[${hit.chunk.id}] ${hit.chunk.title}: ${hit.chunk.body}`;
    const separatorLength = parts.length > 0 ? 1 : 0;
    if (used + separatorLength + block.length > maxChars) break;
    parts.push(block);
    included.push(hit);
    used += separatorLength + block.length;
  }
  return { context: parts.join("\n"), hits: included };
}

export function formatRagContext(hits: RagHit[], maxChars = 1200): string {
  return buildRagContext(hits, maxChars).context;
}
