/**
 * Gyeongnam administrative dong gazetteer for NL region resolution.
 * Built from place-index.json (seeded with administrative-dong boundaries).
 */

import placeIndexJson from "../../../public/data/place-index.json";

export type PlaceEntry = {
  adm_cd2: string;
  adm_nm: string;
  district: string;
  shortName: string;
};

type PlaceIndexFile = {
  version: string;
  count: number;
  places: PlaceEntry[];
};

const INDEX = placeIndexJson as PlaceIndexFile;

/** shortName length desc — match "우1동" before bare "동" */
const BY_SHORT = [...INDEX.places].sort((a, b) => b.shortName.length - a.shortName.length);

export function getAllPlaces(): readonly PlaceEntry[] {
  return INDEX.places;
}

export function getPlaceIndexVersion(): string {
  return INDEX.version;
}

export type MatchedPlace = PlaceEntry & { match: string; position: number };

export type QueryRegionAssessment = {
  places: MatchedPlace[];
  ambiguities: Array<{ match: string; position: number; candidates: PlaceEntry[] }>;
  notice: string | null;
  suggestions: string[];
};

const DISTRICT_NAMES = [...new Set(INDEX.places.flatMap((place) => {
  const district = place.district.replace(/\s+/g, "");
  const parts = district.match(/[^시군구]+[시군구]/g) ?? [district];
  return [district, ...parts, ...parts.filter((part) => /[시군]$/.test(part)).map((part) => part.slice(0, -1))];
}))].sort((a, b) => b.length - a.length);

/** Resolve names against their nearest preceding district; never pick a homonym by index order. */
export function assessQueryRegions(text: string): QueryRegionAssessment {
  const places: MatchedPlace[] = [];
  const ambiguities: QueryRegionAssessment["ambiguities"] = [];
  let remaining = text;
  const names = [...new Set(BY_SHORT.map((place) => place.shortName))];
  for (const name of names) {
    if (name.length < 2 || (!/[동가리]$/.test(name) && !name.includes("동") && name.length < 3)) continue;
    let position = remaining.indexOf(name);
    while (position >= 0) {
      const candidates = INDEX.places.filter((place) => place.shortName === name);
      const prefix = text.slice(0, position).replace(/\s+/g, "");
      let qualifier: string | null = null;
      let nearestEnd = -1;
      for (const district of DISTRICT_NAMES) {
        const at = prefix.lastIndexOf(district);
        const end = at < 0 ? -1 : at + district.length;
        if (end > nearestEnd && /^(?:의|에|있는|지역|내|에서)*$/.test(prefix.slice(end))) {
          qualifier = district;
          nearestEnd = end;
        }
      }
      const scoped = qualifier
        ? candidates.filter((place) => place.district.replace(/\s+/g, "").includes(qualifier))
        : candidates;
      if (scoped.length === 1) {
        places.push({ ...scoped[0], match: name, position });
      } else {
        ambiguities.push({ match: name, position, candidates: scoped.length ? scoped : candidates });
      }
      remaining = remaining.slice(0, position) + " ".repeat(name.length) + remaining.slice(position + name.length);
      position = remaining.indexOf(name);
    }
  }
  places.sort((a, b) => a.position - b.position);
  ambiguities.sort((a, b) => a.position - b.position);
  const first = ambiguities[0];
  return {
    places,
    ambiguities,
    notice: first ? `「${first.match}」의 시·군·구를 확인해 주세요. 지역을 임의로 선택하지 않았습니다.` : null,
    suggestions: first ? first.candidates.map((place) =>
      text.slice(0, first.position) + `${place.district} ${place.shortName}` + text.slice(first.position + first.match.length),
    ) : [],
  };
}

/**
 * Find dong mentions in free text. Longer shortNames win; skips pure 구/군 labels.
 */
export function matchPlacesInText(text: string): MatchedPlace[] {
  return assessQueryRegions(text).places;
}

export function findPlaceByCode(admCd2: string): PlaceEntry | undefined {
  return INDEX.places.find((place) => place.adm_cd2 === admCd2);
}

export function findPlacesByDistrict(district: string): PlaceEntry[] {
  return INDEX.places.filter(
    (place) => place.district === district || place.adm_nm.includes(district),
  );
}
