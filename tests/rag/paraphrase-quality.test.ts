import { expect, it } from "vitest";
import { retrieveRagChunks, type RetrieveOptions } from "@/lib/rag/retrieve";
import cases from "../fixtures/rag-paraphrase-qa.json";

it.each(cases.filter((entry) => entry.kind === "relevant"))("semantic subject remains distinct: $query", ({ query, expectedIds }) => {
  expect(retrieveRagChunks({ query, limit: 5 })[0]?.chunk.id).toBe(expectedIds[0]);
});

it("a limitation mentioning another observation is not that observation's definition", () => {
  const corpus = [
    { id: "visitor", title: "방문 규모", keywords: ["방문자"], tags: [], body: "산식: 관외 주민의 일시 체류 인원. 한계: 실거주자 수가 아니다." },
    { id: "resident", title: "주민 규모", keywords: ["거주자"], tags: [], body: "산식: 주소 이전 주민 수. 한계: 관외 주민의 일시 체류 인원과 달리 주소 이전이다." },
  ];
  const options: RetrieveOptions = { query: "관외 주민 일시 체류 인원", corpus, limit: 2 };
  const hits = retrieveRagChunks(options);
  expect(hits[0]?.chunk.id).toBe("visitor");
  expect(hits[0]?.chunk.body).toContain("실거주자 수가 아니다");
  expect(retrieveRagChunks({ query: "실거주자 수", corpus: [corpus[0]] })).toEqual([]);
});

it.each(cases.filter((entry) => entry.kind === "combined"))("combined questions keep both quantities as evidence: $query", ({query, expectedIds}) => {
  const ids = retrieveRagChunks({ query, limit: 5 }).map((hit) => hit.chunk.id);
  expect(ids).toEqual(expect.arrayContaining(expectedIds));
});

it.each(cases.filter((entry) => !["relevant", "combined"].includes(entry.kind)))("unsupported or noisy subject has no support: $query", ({ query }) => {
  expect(retrieveRagChunks({ query, limit: 5 })).toEqual([]);
});
