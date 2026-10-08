import { DISTRICT_GROUP_ALIASES } from "@/lib/analysis/query-catalog-meta";
import { detectRegionFilters } from "@/lib/analysis/query-regions";
import { getAllPlaces } from "@/lib/geo/place-index";
import type { RagChunk } from "./corpus";

const DONG_NAMES = [...new Set(getAllPlaces().map((place) => place.shortName))];

/** Geographic knowledge comes from the same registry that resolves analysis filters. */
export function buildGeographicRagChunks(): RagChunk[] {
  const groups = new Map<string, { aliases: string[]; districts: readonly string[] }>();
  for (const [alias, districts] of Object.entries(DISTRICT_GROUP_ALIASES)) {
    const key = districts.join("|");
    const group = groups.get(key);
    if (group) group.aliases.push(alias);
    else groups.set(key, { aliases: [alias], districts });
  }
  return [...groups.values()].map(({ aliases, districts }) => ({
    id: `geography-group-${aliases[0]}`,
    title: `${aliases[0]} 복수 행정구역 해석`,
    body: `${aliases.join("·")}은 ${districts.join("·")}을 함께 가리키는 지역 별칭입니다. 한 구를 임의로 선택하거나 창원시 전체로 넓히지 않습니다. 지역 안의 지표 순위는 두 구 안에서 계산합니다. 특정 구·읍면동을 명시하면 질문의 더 좁은 지역 조건을 우선합니다.`,
    tags: ["geography", "district-group", ...districts],
    keywords: aliases,
  }));
}

/** A geographic note is scope context, never independent evidence for a metric. */
export function matchingGeographicChunks(query: string, corpus: readonly RagChunk[]): RagChunk[] {
  const filters = detectRegionFilters(query, DONG_NAMES);
  return corpus.filter((chunk) => {
    if (!chunk.tags.includes("district-group")) return false;
    const districts = chunk.tags.filter((tag) => tag !== "geography" && tag !== "district-group");
    return districts.length > 0 && districts.every((district) => filters.includes(district));
  });
}
