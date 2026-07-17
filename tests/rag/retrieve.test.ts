import { describe, expect, test } from "vitest";

import { RAG_CORPUS } from "@/lib/rag/corpus";
import { augmentQueryWithRag, buildRagPromptSection, enrichInterpretationWithRag } from "@/lib/rag/augment";
import { retrieveRagChunks } from "@/lib/rag/retrieve";
import { tokenize } from "@/lib/rag/tokenize";

describe("rag tokenize", () => {
  test("extracts korean tokens", () => {
    const tokens = tokenize("해운대 의료 취약 지역");
    expect(tokens.some((t) => t.includes("해운") || t.includes("의료") || t.includes("취약"))).toBe(
      true,
    );
  });
});

describe("retrieveRagChunks", () => {
  test("retrieves medical scarcity knowledge", () => {
    const hits = retrieveRagChunks({ query: "병원이 부족한 동 어디야", limit: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((hit) => hit.chunk.id === "tool-scarcity")).toBe(true);
  });

  test("boosts by tool tag", () => {
    const hits = retrieveRagChunks({
      query: "거리",
      boostTags: ["nearestFacilityDistance"],
      limit: 2,
    });
    expect(hits[0]?.chunk.tags).toEqual(
      expect.arrayContaining(["nearestFacilityDistance"]),
    );
  });

  test("unrelated noise ranks below domain queries", () => {
    const noise = retrieveRagChunks({ query: "xyzzy foobar 12345", limit: 3 });
    const medical = retrieveRagChunks({ query: "병원이 부족한 의료 취약 지역", limit: 1 });
    const topNoise = noise[0]?.score ?? 0;
    const topMedical = medical[0]?.score ?? 0;
    expect(topMedical).toBeGreaterThan(topNoise);
  });

  test("corpus has unique ids", () => {
    const ids = RAG_CORPUS.map((chunk) => chunk.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("augmentQueryWithRag", () => {
  test("builds context and citations", () => {
    const aug = augmentQueryWithRag("사망자 많은 곳");
    expect(aug.hits.length).toBeGreaterThan(0);
    expect(aug.context.length).toBeGreaterThan(20);
    expect(aug.citations[0]?.id).toBeTruthy();
  });

  test("prompt section includes RAG marker", () => {
    const section = buildRagPromptSection("2km 병원 접근성");
    expect(section).toContain("RAG");
    expect(section.length).toBeGreaterThan(30);
  });
});

describe("enrichInterpretationWithRag", () => {
  test("adds citations to interpretation", () => {
    const enriched = enrichInterpretationWithRag(
      {
        headline: "의료 취약 지역 — 해석 요약",
        insights: ["상위 있음"],
        suggestions: ["제안"],
        caveats: [],
      },
      {
        title: "의료 취약 지역",
        summary: "요약",
        rankedRegions: [],
        selectedRegion: null,
        filteredFacilities: [],
        legend: [],
        formulaNotes: [],
      },
    );
    expect(enriched.ragCitations.length).toBeGreaterThan(0);
    expect(enriched.caveats.length).toBeGreaterThan(0);
  });
});
