import { createHash } from "node:crypto";

import { area as turfArea } from "@turf/area";
import { pointOnFeature } from "@turf/point-on-feature";
import { pointsWithinPolygon } from "@turf/points-within-polygon";

const FACILITY_TYPES = [
  { type: "종합병원", weight: 0.02 },
  { type: "병원", weight: 0.08 },
  { type: "요양병원", weight: 0.05 },
  { type: "의원", weight: 0.35 },
  { type: "치과의원", weight: 0.15 },
  { type: "한의원", weight: 0.15 },
  { type: "보건소", weight: 0.05 },
  { type: "약국", weight: 0.15 },
];

const SPECIALTIES_BY_TYPE = {
  종합병원: ["내과", "외과", "소아청소년과", "산부인과", "정형외과"],
  병원: ["내과", "정형외과"],
  요양병원: ["재활의학과", "내과"],
  의원: ["내과", "소아청소년과", "이비인후과"],
  치과의원: ["치과"],
  한의원: ["한의학"],
  보건소: ["예방접종", "보건행정"],
  약국: null,
};

const SAMPLE_HOURS = {
  monday: "09:00-18:00",
  tuesday: "09:00-18:00",
  wednesday: "09:00-18:00",
  thursday: "09:00-18:00",
  friday: "09:00-18:00",
  saturday: "09:00-13:00",
  sunday: null,
};

function hashString(input) {
  let hash = 1779033703 ^ input.length;
  for (let index = 0; index < input.length; index += 1) {
    hash = Math.imul(hash ^ input.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  return hash >>> 0;
}

export function createRng(seedString) {
  let seed = hashString(seedString);
  return function random() {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function deriveReferenceMonth(versionSeed) {
  const seedText = String(versionSeed);
  const year = Number(seedText.slice(0, 4));
  const month = Number(seedText.slice(4, 6));

  let referenceYear = year;
  let referenceMonth = month - 1;
  if (referenceMonth < 1) {
    referenceMonth = 12;
    referenceYear -= 1;
  }

  return `${referenceYear}-${String(referenceMonth).padStart(2, "0")}`;
}

function generateMonths(referenceMonth) {
  const [year, month] = referenceMonth.split("-").map(Number);
  const months = [];

  for (let index = 0; index < 13; index += 1) {
    const monthOffset = month - 12 + index - 1;
    const currentYear = year + Math.floor(monthOffset / 12);
    const currentMonth = ((monthOffset % 12) + 12) % 12 + 1;
    months.push(`${currentYear}-${String(currentMonth).padStart(2, "0")}`);
  }

  return months;
}

function generateRegionSeries(feature, versionSeed) {
  const properties = feature.properties;
  const areaSquareMeters = turfArea(feature);
  const areaSquareKilometers = areaSquareMeters / 1_000_000;
  const representative = pointOnFeature(feature);
  const [representativeLongitude, representativeLatitude] = representative.geometry.coordinates;
  const rng = createRng(`${versionSeed}:region:${properties.adm_cd2}`);

  const density = 500 + rng() * 19_500;
  const basePopulation = clamp(density * areaSquareKilometers, 1000, 50_000);
  const monthlyTrend = (rng() - 0.5) * 0.01;

  const youthRatio = 0.1 + rng() * 0.08;
  const elderlyRatio = 0.07 + rng() * 0.18;
  const householdSize = 2.0 + rng() * 0.8;

  const referenceMonth = deriveReferenceMonth(versionSeed);
  const months = generateMonths(referenceMonth);

  const series = {
    adm_cd2: properties.adm_cd2,
    adm_nm: properties.adm_nm,
    representativePoint: {
      lat: representativeLatitude,
      lng: representativeLongitude,
    },
    areaSquareKm: areaSquareKilometers,
    months,
    population: [],
    households: [],
    populationDensity: [],
    youthPopulation: [],
    workingAgePopulation: [],
    elderlyPopulation: [],
    onePersonHouseholds: [],
    births: [],
    deaths: [],
    naturalChange: [],
  };

  let population = basePopulation;
  for (let index = 0; index < 13; index += 1) {
    if (index > 0) {
      population *= 1 + monthlyTrend;
    }

    const populationCount = Math.round(population);
    const youthCount = Math.round(populationCount * youthRatio);
    const elderlyCount = Math.round(populationCount * elderlyRatio);
    const workingCount = populationCount - youthCount - elderlyCount;

    const households = Math.round(populationCount / householdSize);
    const onePersonHouseholds = Math.round(households * (0.2 + rng() * 0.3));

    const birthRate = 0.0003 + rng() * 0.0002;
    const deathRate = 0.0002 + rng() * 0.0002 + elderlyRatio * 0.0005;
    const births = Math.round(populationCount * birthRate);
    const deaths = Math.round(populationCount * deathRate);

    series.population.push(populationCount);
    series.households.push(households);
    series.populationDensity.push(Math.round(populationCount / Math.max(areaSquareKilometers, 0.01)));
    series.youthPopulation.push(youthCount);
    series.workingAgePopulation.push(workingCount);
    series.elderlyPopulation.push(elderlyCount);
    series.onePersonHouseholds.push(onePersonHouseholds);
    series.births.push(births);
    series.deaths.push(deaths);
    series.naturalChange.push(births - deaths);
  }

  return series;
}

function pickFacilityType(rng) {
  const value = rng();
  let cumulativeWeight = 0;
  for (const { type, weight } of FACILITY_TYPES) {
    cumulativeWeight += weight;
    if (value <= cumulativeWeight) {
      return type;
    }
  }
  return "의원";
}

function pickSpecialties(type, rng) {
  if (rng() < 0.3) {
    return null;
  }
  const pool = SPECIALTIES_BY_TYPE[type];
  if (!pool) {
    return null;
  }
  const count = 1 + Math.floor(rng() * pool.length);
  return pool.slice(0, count);
}

function pickHours(rng) {
  if (rng() < 0.3) {
    return null;
  }
  return { ...SAMPLE_HOURS };
}

function placeFacilityInside(feature, baseLongitude, baseLatitude, rng) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const longitude = baseLongitude + (rng() - 0.5) * 0.01;
    const latitude = baseLatitude + (rng() - 0.5) * 0.01;
    const candidate = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Point",
        coordinates: [longitude, latitude],
      },
    };

    const inside = pointsWithinPolygon(
      { type: "FeatureCollection", features: [candidate] },
      { type: "FeatureCollection", features: [feature] },
    );

    if (inside.features.length > 0) {
      return [longitude, latitude];
    }
  }

  return [baseLongitude, baseLatitude];
}

function generateFacility(feature, index, versionSeed) {
  const properties = feature.properties;
  const rng = createRng(`${versionSeed}:facility:${properties.adm_cd2}:${index}`);
  const type = pickFacilityType(rng);
  const representative = pointOnFeature(feature);
  const [baseLongitude, baseLatitude] = representative.geometry.coordinates;
  const [longitude, latitude] = placeFacilityInside(feature, baseLongitude, baseLatitude, rng);

  const nameSuffix = properties.adm_nm.split(" ").pop() || properties.adm_nm;
  const phone = rng() < 0.3 ? null : `051-${100 + Math.floor(rng() * 900)}-${1000 + Math.floor(rng() * 9000)}`;

  return {
    id: `${properties.adm_cd2}-${index}`,
    name: `${nameSuffix} ${type}${index + 1}`,
    type,
    adm_cd2: properties.adm_cd2,
    adm_nm: properties.adm_nm,
    lat: latitude,
    lng: longitude,
    specialties: pickSpecialties(type, rng),
    hours: pickHours(rng),
    address: `${properties.adm_nm} ${index + 1}길 ${10 + index}`,
    phone,
  };
}

function facilityCountForPopulation(population) {
  if (population < 5000) {
    return 1;
  }
  if (population < 15_000) {
    return 2;
  }
  if (population < 30_000) {
    return 3;
  }
  return 4;
}

export function seedSnapshot(boundary, versionSeed) {
  if (
    !boundary ||
    typeof boundary !== "object" ||
    boundary.type !== "FeatureCollection" ||
    !Array.isArray(boundary.features)
  ) {
    throw new Error("boundary는 GeoJSON FeatureCollection이어야 합니다.");
  }

  if (boundary.features.length < 150) {
    throw new Error(
      `데모 스냅샷은 150개 이상 행정동이 필요합니다: ${boundary.features.length}개 수신.`,
    );
  }

  const referenceMonth = deriveReferenceMonth(versionSeed);
  const months = generateMonths(referenceMonth);
  const regions = boundary.features.map((feature) => generateRegionSeries(feature, versionSeed));

  const facilities = [];
  for (const feature of boundary.features) {
    const region = regions.find((r) => r.adm_cd2 === feature.properties.adm_cd2);
    const count = facilityCountForPopulation(region.population[12]);
    for (let index = 0; index < count; index += 1) {
      facilities.push(generateFacility(feature, index, versionSeed));
    }
  }

  return {
    mode: "demo",
    referenceMonth,
    months,
    regions,
    facilities,
    sourceNotes: [
      "부산·경남 행정동 경계를 기준으로 만든 결정론적 시연 데이터입니다.",
      "인구·세대·출생·사망 값은 합성값이며 실제 주민등록 통계가 아닙니다.",
      "시설 위치는 행정동 내부 대표점 주변 PRNG 배치이며 실제 요양기관 좌표가 아닙니다.",
      "진료과·운영시간 null은 UI의 ‘데이터 없음’ 처리를 검증하기 위한 의도적 값입니다.",
      "실데이터 연결 시 시설은 HIRA 병원정보(v2), 인구는 행정안전부 주민인구 API를 사용합니다.",
      "분석 거리는 행정동 대표점 기준 직선거리이며 도로·대중교통 접근성과 다를 수 있습니다.",
    ],
  };
}

export function buildDemoMetadata(snapshot, context) {
  if (!snapshot || typeof snapshot !== "object" || snapshot.mode !== "demo") {
    throw new Error("데모 메타데이터는 demo 스냅샷을 필요로 합니다.");
  }
  if (!context || typeof context !== "object" || !/^\d{8}$/.test(String(context.versionSeed))) {
    throw new Error("데모 메타데이터에는 YYYYMMDD 형식의 versionSeed가 필요합니다.");
  }
  if (
    typeof context.generatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(context.generatedAt) ||
    Number.isNaN(Date.parse(context.generatedAt)) ||
    new Date(context.generatedAt).toISOString() !== context.generatedAt
  ) {
    throw new Error("데모 메타데이터의 generatedAt은 UTC ISO-8601 형식이어야 합니다.");
  }

  const snapshotBytes = new TextEncoder().encode(JSON.stringify(snapshot));

  return {
    mode: "demo",
    versionSeed: context.versionSeed,
    referenceMonth: snapshot.referenceMonth,
    generatedAt: context.generatedAt,
    sha256: createHash("sha256").update(snapshotBytes).digest("hex"),
    regionCount: snapshot.regions.length,
    facilityCount: snapshot.facilities.length,
    months: snapshot.months,
    sourceNotes: snapshot.sourceNotes,
  };
}
