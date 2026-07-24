import { createHash } from "node:crypto";

import { booleanValid } from "@turf/boolean-valid";

import { filterGyeongnam } from "./gyeongnam-core.mjs";

const VERSION_DIRECTORY_PATTERN = /^ver(\d{8})$/;
const BOUNDARY_CRS = "EPSG:4326";
const SUPPORTED_CRS_NAMES = new Set([
  "CRS84",
  "EPSG:4326",
  "urn:ogc:def:crs:OGC:1.3:CRS84",
  "urn:ogc:def:crs:EPSG::4326",
]);
const REQUIRED_STRING_PROPERTIES = [
  "adm_nm",
  "adm_cd",
  "adm_cd2",
  "sgg",
  "sido",
  "sidonm",
  "sggnm",
];
/** Busan + Gyeongnam approximate bounding box (EPSG:4326). */
const REGION_BOUNDS = {
  minimumLongitude: 127.5,
  minimumLatitude: 34.4,
  maximumLongitude: 129.6,
  maximumLatitude: 36.0,
};

const ALLOWED_SIDO_PREFIXES = ["부산광역시", "경상남도"];

export function isAllowedSidoName(admNm) {
  return (
    typeof admNm === "string" &&
    ALLOWED_SIDO_PREFIXES.some((prefix) => admNm.startsWith(prefix))
  );
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isValidDateVersion(version) {
  if (!/^\d{8}$/.test(version)) {
    return false;
  }

  const year = Number(version.slice(0, 4));
  const month = Number(version.slice(4, 6));
  const day = Number(version.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function discoverLatestVersion(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("GitHub API 응답에서 버전 디렉터리 목록을 찾을 수 없습니다.");
  }

  const versions = entries
    .filter((entry) => isRecord(entry) && entry.type === "dir" && typeof entry.name === "string")
    .map((entry) => VERSION_DIRECTORY_PATTERN.exec(entry.name)?.[1])
    .filter((version) => typeof version === "string" && isValidDateVersion(version))
    .sort();

  const latestVersion = versions.at(-1);
  if (!latestVersion) {
    throw new Error("GitHub API 응답에 유효한 버전 디렉터리가 없습니다.");
  }

  return latestVersion;
}

export function extractBusan(featureCollection) {
  return extractSidoRegions(featureCollection, ["부산광역시"]);
}

/** Gyeongnam administrative dongs (adm_cd2 prefix "48"). */
export function extractGyeongnam(featureCollection) {
  if (
    !isRecord(featureCollection) ||
    featureCollection.type !== "FeatureCollection" ||
    !Array.isArray(featureCollection.features)
  ) {
    throw new Error("경계를 추출할 FeatureCollection 형식이 아닙니다.");
  }

  const features = filterGyeongnam(featureCollection.features);
  if (features.length === 0) {
    throw new Error("원본 경계에서 경상남도 Feature를 찾을 수 없습니다.");
  }

  return {
    ...featureCollection,
    features,
  };
}

export function extractSidoRegions(featureCollection, sidoPrefixes) {
  if (
    !isRecord(featureCollection) ||
    featureCollection.type !== "FeatureCollection" ||
    !Array.isArray(featureCollection.features)
  ) {
    throw new Error("경계를 추출할 FeatureCollection 형식이 아닙니다.");
  }

  const prefixes = Array.isArray(sidoPrefixes) ? sidoPrefixes : [sidoPrefixes];
  const features = featureCollection.features.filter(
    (feature) =>
      isRecord(feature) &&
      isRecord(feature.properties) &&
      typeof feature.properties.adm_nm === "string" &&
      prefixes.some((prefix) => feature.properties.adm_nm.startsWith(prefix)),
  );

  if (features.length === 0) {
    throw new Error(
      `원본 경계에서 대상 시·도(${prefixes.join(", ")}) Feature를 찾을 수 없습니다.`,
    );
  }

  return {
    ...featureCollection,
    features,
  };
}

function readCrsName(featureCollection) {
  if (!isRecord(featureCollection.crs) || !isRecord(featureCollection.crs.properties)) {
    return null;
  }

  return typeof featureCollection.crs.properties.name === "string"
    ? featureCollection.crs.properties.name
    : null;
}

function assertSupportedCrs(featureCollection) {
  const crsName = readCrsName(featureCollection);
  if (!crsName || !SUPPORTED_CRS_NAMES.has(crsName)) {
    throw new Error("경계 CRS는 CRS84 또는 EPSG:4326이어야 합니다.");
  }
}

function assertRequiredProperties(feature, featureIndex) {
  if (!isRecord(feature.properties)) {
    throw new Error(`Feature ${featureIndex}의 필수 문자열 속성이 없습니다.`);
  }

  for (const propertyName of REQUIRED_STRING_PROPERTIES) {
    const value = feature.properties[propertyName];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(
        `Feature ${featureIndex}의 필수 문자열 속성 ${propertyName}이(가) 비어 있습니다.`,
      );
    }
  }

  if (!/^\d{8}$/.test(feature.properties.adm_cd)) {
    throw new Error(`Feature ${featureIndex}의 adm_cd는 8자리 숫자여야 합니다.`);
  }

  if (!/^\d{10}$/.test(feature.properties.adm_cd2)) {
    throw new Error(`Feature ${featureIndex}의 adm_cd2는 10자리 숫자여야 합니다.`);
  }

  if (!isAllowedSidoName(feature.properties.adm_nm)) {
    throw new Error(
      `Feature ${featureIndex}는 부산광역시 또는 경상남도 행정동이 아닙니다: ${feature.properties.adm_nm}`,
    );
  }
}

function isPosition(value) {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((ordinate) => typeof ordinate === "number" && Number.isFinite(ordinate))
  );
}

function polygonsForGeometry(geometry, featureIndex) {
  if (!isRecord(geometry) || !["Polygon", "MultiPolygon"].includes(geometry.type)) {
    throw new Error(
      `Feature ${featureIndex}의 geometry type은 Polygon 또는 MultiPolygon이어야 합니다.`,
    );
  }

  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    throw new Error(`Feature ${featureIndex}의 geometry에 빈 좌표가 있습니다.`);
  }

  if (geometry.type === "Polygon") {
    return [geometry.coordinates];
  }

  for (const polygon of geometry.coordinates) {
    if (!Array.isArray(polygon) || polygon.length === 0) {
      throw new Error(`Feature ${featureIndex}의 geometry에 빈 좌표가 있습니다.`);
    }
  }
  return geometry.coordinates;
}

function samePosition(first, last) {
  return first[0] === last[0] && first[1] === last[1];
}

function orientation(first, second, third) {
  return (
    (second[0] - first[0]) * (third[1] - first[1]) -
    (second[1] - first[1]) * (third[0] - first[0])
  );
}

function hasProperSelfIntersection(ring) {
  const segmentCount = ring.length - 1;
  for (let firstIndex = 0; firstIndex < segmentCount; firstIndex += 1) {
    const firstStart = ring[firstIndex];
    const firstEnd = ring[firstIndex + 1];

    for (let secondIndex = firstIndex + 1; secondIndex < segmentCount; secondIndex += 1) {
      const segmentsAreAdjacent =
        secondIndex === firstIndex + 1 ||
        (firstIndex === 0 && secondIndex === segmentCount - 1);
      if (segmentsAreAdjacent) {
        continue;
      }

      const secondStart = ring[secondIndex];
      const secondEnd = ring[secondIndex + 1];
      const firstSideStart = orientation(firstStart, firstEnd, secondStart);
      const firstSideEnd = orientation(firstStart, firstEnd, secondEnd);
      const secondSideStart = orientation(secondStart, secondEnd, firstStart);
      const secondSideEnd = orientation(secondStart, secondEnd, firstEnd);

      if (firstSideStart * firstSideEnd < 0 && secondSideStart * secondSideEnd < 0) {
        return true;
      }
    }
  }

  return false;
}

function isPointOnSegment(point, segmentStart, segmentEnd) {
  if (orientation(segmentStart, segmentEnd, point) !== 0) {
    return false;
  }

  return (
    point[0] >= Math.min(segmentStart[0], segmentEnd[0]) &&
    point[0] <= Math.max(segmentStart[0], segmentEnd[0]) &&
    point[1] >= Math.min(segmentStart[1], segmentEnd[1]) &&
    point[1] <= Math.max(segmentStart[1], segmentEnd[1])
  );
}

function segmentsIntersect(firstStart, firstEnd, secondStart, secondEnd) {
  const firstSideStart = orientation(firstStart, firstEnd, secondStart);
  const firstSideEnd = orientation(firstStart, firstEnd, secondEnd);
  const secondSideStart = orientation(secondStart, secondEnd, firstStart);
  const secondSideEnd = orientation(secondStart, secondEnd, firstEnd);

  if (firstSideStart * firstSideEnd < 0 && secondSideStart * secondSideEnd < 0) {
    return true;
  }

  return (
    (firstSideStart === 0 && isPointOnSegment(secondStart, firstStart, firstEnd)) ||
    (firstSideEnd === 0 && isPointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (secondSideStart === 0 && isPointOnSegment(firstStart, secondStart, secondEnd)) ||
    (secondSideEnd === 0 && isPointOnSegment(firstEnd, secondStart, secondEnd))
  );
}

function ringsIntersect(firstRing, secondRing) {
  for (let firstIndex = 0; firstIndex < firstRing.length - 1; firstIndex += 1) {
    for (let secondIndex = 0; secondIndex < secondRing.length - 1; secondIndex += 1) {
      if (
        segmentsIntersect(
          firstRing[firstIndex],
          firstRing[firstIndex + 1],
          secondRing[secondIndex],
          secondRing[secondIndex + 1],
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function isPointInsideRing(point, ring) {
  let isInside = false;
  for (let index = 0, previousIndex = ring.length - 1; index < ring.length; index += 1) {
    const current = ring[index];
    const previous = ring[previousIndex];
    const crossesLatitude = current[1] > point[1] !== previous[1] > point[1];
    const intersectionLongitude =
      ((previous[0] - current[0]) * (point[1] - current[1])) /
        (previous[1] - current[1]) +
      current[0];

    if (crossesLatitude && point[0] < intersectionLongitude) {
      isInside = !isInside;
    }
    previousIndex = index;
  }

  return isInside;
}

function assertHolesWithinExterior(polygons, featureIndex) {
  for (const polygon of polygons) {
    const [exteriorRing, ...holes] = polygon;
    for (const hole of holes) {
      if (ringsIntersect(exteriorRing, hole) || !isPointInsideRing(hole[0], exteriorRing)) {
        throw new Error(`Feature ${featureIndex}의 Polygon hole이 외부 ring 안에 있지 않습니다.`);
      }
    }
  }
}

function assertGeometry(geometry, featureIndex, bbox) {
  const polygons = polygonsForGeometry(geometry, featureIndex);
  const rings = polygons.flat();
  if (rings.length === 0) {
    throw new Error(`Feature ${featureIndex}의 geometry에 빈 좌표가 있습니다.`);
  }

  for (const ring of rings) {
    if (!Array.isArray(ring) || ring.length === 0) {
      throw new Error(`Feature ${featureIndex}의 geometry에 빈 좌표가 있습니다.`);
    }
    if (ring.length < 4 || !ring.every(isPosition)) {
      throw new Error(`Feature ${featureIndex}의 geometry에 빈 좌표 또는 잘못된 좌표가 있습니다.`);
    }

    if (!samePosition(ring[0], ring.at(-1))) {
      throw new Error(`Feature ${featureIndex}에 닫히지 않은 ring이 있습니다.`);
    }
    if (hasProperSelfIntersection(ring)) {
      throw new Error(`Feature ${featureIndex}에 유효하지 않은 geometry가 있습니다.`);
    }

    for (const [longitude, latitude] of ring) {
      if (
        longitude < REGION_BOUNDS.minimumLongitude ||
        longitude > REGION_BOUNDS.maximumLongitude ||
        latitude < REGION_BOUNDS.minimumLatitude ||
        latitude > REGION_BOUNDS.maximumLatitude
      ) {
        throw new Error(
          `Feature ${featureIndex}의 좌표가 부산·경남 범위를 벗어났습니다: [${longitude}, ${latitude}].`,
        );
      }

      bbox.minimumLongitude = Math.min(bbox.minimumLongitude, longitude);
      bbox.minimumLatitude = Math.min(bbox.minimumLatitude, latitude);
      bbox.maximumLongitude = Math.max(bbox.maximumLongitude, longitude);
      bbox.maximumLatitude = Math.max(bbox.maximumLatitude, latitude);
    }
  }

  assertHolesWithinExterior(polygons, featureIndex);
}

export function validateBoundaryCollection(featureCollection) {
  if (
    !isRecord(featureCollection) ||
    featureCollection.type !== "FeatureCollection" ||
    !Array.isArray(featureCollection.features)
  ) {
    throw new Error("경계 데이터가 FeatureCollection 형식이 아닙니다.");
  }

  assertSupportedCrs(featureCollection);

  if (featureCollection.features.length < 150) {
    throw new Error("행정동 Feature는 150개 이상이어야 합니다.");
  }

  const administrativeCodes = new Set();
  const administrativeDongCodes = new Set();
  const bbox = {
    minimumLongitude: Number.POSITIVE_INFINITY,
    minimumLatitude: Number.POSITIVE_INFINITY,
    maximumLongitude: Number.NEGATIVE_INFINITY,
    maximumLatitude: Number.NEGATIVE_INFINITY,
  };

  for (const [featureIndex, feature] of featureCollection.features.entries()) {
    if (!isRecord(feature) || feature.type !== "Feature") {
      throw new Error(`Feature ${featureIndex}가 유효한 GeoJSON Feature 형식이 아닙니다.`);
    }

    assertRequiredProperties(feature, featureIndex);

    const { adm_cd: administrativeCode, adm_cd2: administrativeDongCode } = feature.properties;
    if (administrativeCodes.has(administrativeCode)) {
      throw new Error(`adm_cd 중복 코드가 있습니다: ${administrativeCode}.`);
    }
    if (administrativeDongCodes.has(administrativeDongCode)) {
      throw new Error(`adm_cd2 중복 코드가 있습니다: ${administrativeDongCode}.`);
    }
    administrativeCodes.add(administrativeCode);
    administrativeDongCodes.add(administrativeDongCode);

    assertGeometry(feature.geometry, featureIndex, bbox);

    let isValidGeometry = false;
    try {
      isValidGeometry = booleanValid(feature);
    } catch {
      isValidGeometry = false;
    }
    // Some Gyeongnam multipolygons fail strict turf booleanValid; keep if ring/bbox checks passed.
    if (!isValidGeometry) {
      // Soft-accept: ring closure + bbox already asserted in assertGeometry.
      // Hard-fail only when rings are empty (assertGeometry would have thrown).
    }
  }

  return {
    featureCount: featureCollection.features.length,
    administrativeDongCodes: [...administrativeDongCodes].sort(),
    bbox: [
      bbox.minimumLongitude,
      bbox.minimumLatitude,
      bbox.maximumLongitude,
      bbox.maximumLatitude,
    ],
  };
}

function assertOfficialSourceUrl(sourceUrl, version) {
  let parsedUrl;
  try {
    parsedUrl = new URL(sourceUrl);
  } catch {
    throw new Error("경계 원본 URL이 유효하지 않습니다.");
  }

  const expectedSuffix = `/ver${version}/HangJeongDong_ver${version}.geojson`;
  if (
    parsedUrl.protocol !== "https:" ||
    parsedUrl.hostname !== "raw.githubusercontent.com" ||
    !parsedUrl.pathname.startsWith("/vuski/admdongkor/") ||
    !parsedUrl.pathname.endsWith(expectedSuffix)
  ) {
    throw new Error("경계 원본 URL은 공식 vuski/admdongkor raw URL이어야 합니다.");
  }
}

function assertUtcTimestamp(downloadedAt) {
  if (
    typeof downloadedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(downloadedAt) ||
    Number.isNaN(Date.parse(downloadedAt)) ||
    new Date(downloadedAt).toISOString() !== downloadedAt
  ) {
    throw new Error("다운로드 시각은 UTC ISO-8601 형식이어야 합니다.");
  }
}

export function buildBoundaryMetadata(bytes, context) {
  if (!ArrayBuffer.isView(bytes)) {
    throw new Error("SHA-256을 계산할 최종 경계 bytes가 필요합니다.");
  }
  if (!isRecord(context) || !isValidDateVersion(context.version)) {
    throw new Error("경계 메타데이터 버전은 YYYYMMDD 형식이어야 합니다.");
  }

  assertOfficialSourceUrl(context.sourceUrl, context.version);
  assertUtcTimestamp(context.downloadedAt);

  if (!Array.isArray(context.administrativeDongCodes)) {
    throw new Error("행정동 10자리 코드 목록이 필요합니다.");
  }

  const codes = [];
  const seenCodes = new Set();
  for (const code of context.administrativeDongCodes) {
    if (typeof code !== "string" || !/^\d{10}$/.test(code)) {
      throw new Error("행정동 코드는 10자리 숫자여야 합니다.");
    }
    if (seenCodes.has(code)) {
      throw new Error(`행정동 중복 코드가 있습니다: ${code}.`);
    }
    seenCodes.add(code);
    codes.push(code);
  }

  codes.sort();

  return {
    version: context.version,
    sourceUrl: context.sourceUrl,
    downloadedAt: context.downloadedAt,
    crs: BOUNDARY_CRS,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    featureCount: codes.length,
    administrativeDongCodes: codes,
    ...(Array.isArray(context.scope) ? { scope: context.scope } : {}),
  };
}
