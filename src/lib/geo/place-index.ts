/**
 * Busan + Gyeongnam administrative dong gazetteer for NL region resolution.
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

/**
 * Find dong mentions in free text. Longer shortNames win; skips pure 구/군 labels.
 */
export function matchPlacesInText(text: string): MatchedPlace[] {
  if (!text.trim()) return [];
  const found: MatchedPlace[] = [];
  let remaining = text;

  for (const place of BY_SHORT) {
    const name = place.shortName;
    if (name.length < 2) continue;
    // Avoid matching only "구"/"군" fragments
    if (!/[동가리]$/.test(name) && !name.includes("동")) {
      // still allow 일부 법정동 예외; keep if length >= 3
      if (name.length < 3) continue;
    }
    const at = remaining.indexOf(name);
    if (at < 0) continue;
    const originAt = text.indexOf(name);
    found.push({
      ...place,
      match: name,
      position: originAt >= 0 ? originAt : at,
    });
    remaining = remaining.split(name).join(" ");
  }

  return found.sort((a, b) => a.position - b.position || b.shortName.length - a.shortName.length);
}

export function findPlaceByCode(admCd2: string): PlaceEntry | undefined {
  return INDEX.places.find((place) => place.adm_cd2 === admCd2);
}

export function findPlacesByDistrict(district: string): PlaceEntry[] {
  return INDEX.places.filter(
    (place) => place.district === district || place.adm_nm.includes(district),
  );
}
