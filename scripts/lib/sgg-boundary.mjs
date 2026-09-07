import { dissolve } from "@turf/dissolve";

import { checkDerivedGeometry } from "./boundary-core.mjs";

/**
 * 행정동 경계를 시군구(5자리 코드) 단위로 녹여 묶는다.
 *
 * 시군구 모드에서도 305개 동 폴리곤을 그리면 경계선만 가득하고 정작 값 비교가
 * 안 보인다. dissolve로 동 사이 내부 경계를 지운 22개(sgg 수, 판번호에 따라
 * 변동) 폴리곤을 미리 만들어 둔다 — 브라우저에서 매번 합치는 대신 배포본에
 * 산출물로 싣는다.
 *
 * @turf/dissolve@v7은 MultiPolygon을 받지 못하므로 Polygon 조각으로 펴서
 * 넣는다. 섬이 많은 통영·거제·남해는 같은 시군구라도 서로 닿지 않은 조각이
 * 남는다(dissolve가 조각별로 내놓는다). 조각을 쪼개진 채로 내보내면 지도 코드의
 * `key={code}`가 충돌하므로, 같은 키 조각들을 하나의 MultiPolygon으로 묶어
 * 시군구당 Feature 1개로 낸다.
 */

const DISSOLVE_KEY = "__sgg5";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sggOf(properties, featureIndex) {
  const code = isRecord(properties) ? properties.adm_cd2 : undefined;
  if (typeof code !== "string" || !/^\d{10}$/.test(code)) {
    throw new Error(`Feature ${featureIndex}의 adm_cd2는 10자리 숫자여야 합니다.`);
  }
  return code.slice(0, 5);
}

function polygonsOf(feature) {
  const geometry = feature.geometry;
  if (!isRecord(geometry)) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  return [];
}

/**
 * 행정동 FeatureCollection → 시군구 FeatureCollection.
 *
 * properties는 지도 코드가 읽는 모양 그대로 둔다(adm_cd2=5자리, adm_nm="경상남도 XX시").
 */
export function buildSggCollection(dongCollection) {
  if (!isRecord(dongCollection) || dongCollection.type !== "FeatureCollection" || !Array.isArray(dongCollection.features)) {
    throw new Error("시군구 경계 입력이 FeatureCollection 형식이 아닙니다.");
  }
  if (dongCollection.features.length === 0) {
    throw new Error("시군구 경계를 만들 행정동 Feature가 없습니다.");
  }

  const names = new Map();
  const flat = [];
  dongCollection.features.forEach((feature, featureIndex) => {
    if (!isRecord(feature) || feature.type !== "Feature") {
      throw new Error(`Feature ${featureIndex}가 유효한 GeoJSON Feature 형식이 아닙니다.`);
    }
    const key = sggOf(feature.properties, featureIndex);
    if (!names.has(key)) {
      const sidonm = feature.properties?.sidonm;
      const sggnm = feature.properties?.sggnm;
      if (typeof sidonm !== "string" || sidonm.trim() === "" || typeof sggnm !== "string" || sggnm.trim() === "") {
        throw new Error(`Feature ${featureIndex}의 sidonm/sggnm이 비어 있습니다.`);
      }
      names.set(key, { adm_nm: `${sidonm.trim()} ${sggnm.trim()}`, sggnm: sggnm.trim() });
    }
    for (const coordinates of polygonsOf(feature)) {
      flat.push({
        type: "Feature",
        properties: { [DISSOLVE_KEY]: key },
        geometry: { type: "Polygon", coordinates },
      });
    }
  });
  if (flat.length === 0) {
    throw new Error("dissolve에 넣을 Polygon 조각이 없습니다.");
  }

  let dissolved;
  try {
    dissolved = dissolve({ type: "FeatureCollection", features: flat }, { propertyName: DISSOLVE_KEY });
  } catch (error) {
    throw new Error(`시군구 dissolve 실패: ${error instanceof Error ? error.message : error}`);
  }

  const grouped = new Map();
  for (const piece of dissolved.features) {
    const key = piece?.properties?.[DISSOLVE_KEY];
    if (typeof key !== "string") continue;
    if (!grouped.has(key)) grouped.set(key, []);
    const geometry = piece.geometry;
    if (geometry?.type === "Polygon") grouped.get(key).push(geometry.coordinates);
    else if (geometry?.type === "MultiPolygon") grouped.get(key).push(...geometry.coordinates);
  }

  const features = [...grouped.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, polygons]) => {
      if (polygons.length === 0) {
        throw new Error(`시군구 ${key}의 dissolve 결과가 비어 있습니다.`);
      }
      const meta = names.get(key);
      return {
        type: "Feature",
        properties: { adm_cd2: key, adm_nm: meta.adm_nm, sggnm: meta.sggnm },
        geometry: { type: "MultiPolygon", coordinates: polygons },
      };
    });

  return { type: "FeatureCollection", features };
}

/**
 * 시군구 산출물 검사. 행정동 원본 검사를 가볍게 하지 않는다 —
 * geometry 검사는 같은 자(checkDerivedGeometry)로 잰다.
 *
 * expectedPrefixes: 행정동 파일에서 읽은 5자리 코드 집합(정렬). dissolve가
 * 시군구를 빠뜨리거나 쪼개면 여기서 걸린다.
 */
export function validateSggCollection(sggCollection, expectedPrefixes) {
  if (!isRecord(sggCollection) || sggCollection.type !== "FeatureCollection" || !Array.isArray(sggCollection.features)) {
    throw new Error("시군구 경계가 FeatureCollection 형식이 아닙니다.");
  }
  const expected = [...expectedPrefixes].sort();
  const actual = sggCollection.features.map((feature) => feature?.properties?.adm_cd2);
  const sortedActual = [...actual].sort();
  if (
    sortedActual.length !== expected.length ||
    sortedActual.some((code, index) => code !== expected[index]) ||
    sortedActual.some((code) => typeof code !== "string" || !/^\d{5}$/.test(code))
  ) {
    throw new Error(
      `시군구 코드가 행정동 접두와 일치하지 않습니다: sgg ${sortedActual.length}개, 기대 ${expected.length}개.`,
    );
  }

  const seen = new Set();
  sggCollection.features.forEach((feature, featureIndex) => {
    const properties = feature?.properties;
    const code = properties?.adm_cd2;
    if (seen.has(code)) {
      throw new Error(`시군구 중복 코드가 있습니다: ${code}.`);
    }
    seen.add(code);
    const name = properties?.adm_nm;
    if (typeof name !== "string" || !name.startsWith("경상남도 ")) {
      throw new Error(`Feature ${featureIndex}는 경상남도 시군구가 아닙니다: ${String(name)}.`);
    }
    checkDerivedGeometry(feature.geometry, `시군구 ${code}`);
  });

  return {
    featureCount: sggCollection.features.length,
    sggCodes: sortedActual,
  };
}
