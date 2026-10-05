import { readFile } from "node:fs/promises";
import path from "node:path";
import { AnalysisSnapshotSchema, type AnalysisSnapshot } from "@/lib/domain/schemas";
import { z } from "zod";

let officialPromise: Promise<AnalysisSnapshot> | null = null;
const ManifestSchema = z.object({
  acquiredAt: z.string(), source: z.literal("https://jumin.mois.go.kr/"),
  months: z.array(z.string().regex(/^\d{4}-\d{2}$/)).length(13), regions: z.literal(305),
  files: z.array(z.object({ dataset: z.string(), month: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).length(65),
  facilities: z.object({ publishedAt: z.string().nullable().optional(), createdAt: z.string().nullable().optional() }),
});
let manifestPromise: Promise<z.infer<typeof ManifestSchema>> | null = null;
export function loadOfficialResidentsManifest() {
  if (!manifestPromise) {
    manifestPromise = readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "public/data/official-residents-manifest.json"), "utf8")
      .then((text) => ManifestSchema.parse(JSON.parse(text)))
      .catch((error) => { manifestPromise = null; throw error; });
  }
  return manifestPromise;
}

export function loadOfficialResidents(): Promise<AnalysisSnapshot> {
  if (!officialPromise) {
    officialPromise = readFile(path.join(/* turbopackIgnore: true */ process.cwd(), "public/data/official-snapshot.json"), "utf8")
      .then((text) => AnalysisSnapshotSchema.parse(JSON.parse(text)))
      .catch((error) => { officialPromise = null; throw error; });
  }
  return officialPromise;
}

/** Population source months and administrative areas come from the complete official series. */
export function combineOfficialResidents(official: AnalysisSnapshot, facilityBase: {
  facilities: AnalysisSnapshot["facilities"];
  sourceNotes: string[];
}): AnalysisSnapshot {
  const candidate = AnalysisSnapshotSchema.safeParse(facilityBase);
  if (candidate.success && candidate.data.referenceMonth > official.referenceMonth) {
    const cached = candidate.data;
    const codes = new Set(official.regions.map((region) => region.adm_cd2));
    const months = cached.months;
    const explicitSource = cached.sourceNotes.some((note) =>
      note.includes("행정안전부 주민등록 인구통계 공식 CSV:") &&
      note.includes(`${months[0]}~${cached.referenceMonth}`) &&
      /총인구·세대·연령별 인구·1인세대·출생등록·사망말소.*실제 자료로 교체/.test(note),
    );
    const complete = months.at(-1) === cached.referenceMonth && months.every((month, index) => {
      if (!index) return true;
      const previous = new Date(`${months[index - 1]}-01T00:00:00Z`);
      previous.setUTCMonth(previous.getUTCMonth() + 1);
      return previous.toISOString().slice(0, 7) === month;
    }) && cached.regions.length === codes.size && new Set(cached.regions.map((region) => region.adm_cd2)).size === codes.size &&
      cached.regions.every((region) => codes.has(region.adm_cd2) && region.months.every((month, index) => month === months[index]) &&
        region.population.every((population, index) =>
          region.youthPopulation[index] + region.workingAgePopulation[index] + region.elderlyPopulation[index] === population &&
          region.onePersonHouseholds[index] !== null && region.onePersonHouseholds[index]! <= region.households[index] &&
          region.naturalChange[index] === region.births[index] - region.deaths[index],
        ));
    if (explicitSource && complete && !cached.sourceNotes.some((note) => /합성|부분|불완전|기준 스냅샷/.test(note))) return cached;
  }
  return {
    ...official,
    facilities: facilityBase.facilities,
    sourceNotes: [
      ...official.sourceNotes.filter((note) => !/HIRA|시설 위치|진료과·운영시간/.test(note)),
      ...facilityBase.sourceNotes.filter((note) => /HIRA|시설 위치|진료과·운영시간/.test(note))
        .filter((note, index, notes) => !/HIRA.*갱신/.test(note) || index === notes.findLastIndex((n) => /HIRA.*갱신/.test(n))),
    ],
  };
}
