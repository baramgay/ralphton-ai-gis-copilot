import { z } from "zod";

export const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const RegionSeriesSchema = z.object({
  adm_cd2: z.string().regex(/^\d{10}$/),
  adm_nm: z.string().min(1),
  representativePoint: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  areaSquareKm: z.number().positive(),
  months: z.array(MonthSchema).length(13),
  population: z.array(z.number().int().nonnegative()).length(13),
  households: z.array(z.number().int().nonnegative()).length(13),
  populationDensity: z.array(z.number().nonnegative()).length(13),
  youthPopulation: z.array(z.number().int().nonnegative()).length(13),
  workingAgePopulation: z.array(z.number().int().nonnegative()).length(13),
  elderlyPopulation: z.array(z.number().int().nonnegative()).length(13),
  onePersonHouseholds: z.array(z.number().int().nonnegative().nullable()).length(13),
  births: z.array(z.number().int().nonnegative()).length(13),
  deaths: z.array(z.number().int().nonnegative()).length(13),
  naturalChange: z.array(z.number().int()).length(13),
});

export type RegionSeries = z.infer<typeof RegionSeriesSchema>;

export const RegionMetricSchema = z.object({
  name: z.string().min(1),
  value: z.number().nullable(),
  unit: z.string(),
  formula: z.string().min(1),
  referenceMonth: MonthSchema,
  limitation: z.string().optional(),
});

export type RegionMetric = z.infer<typeof RegionMetricSchema>;

export const FacilityTypeSchema = z.enum([
  "종합병원",
  "병원",
  "요양병원",
  "의원",
  "치과의원",
  "한의원",
  "보건소",
  "약국",
]);

export const FacilitySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: FacilityTypeSchema,
  adm_cd2: z.string().regex(/^\d{10}$/),
  adm_nm: z.string().min(1),
  lat: z.number(),
  lng: z.number(),
  specialties: z.array(z.string().min(1)).nullable(),
  hours: z.record(z.string(), z.string().nullable()).nullable(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});

export type Facility = z.infer<typeof FacilitySchema>;

export const DemoSnapshotSchema = z.object({
  mode: z.literal("demo"),
  referenceMonth: MonthSchema,
  months: z.array(MonthSchema).length(13),
  regions: z.array(RegionSeriesSchema).min(150),
  facilities: z.array(FacilitySchema),
  sourceNotes: z.array(z.string().min(1)),
});

export type DemoSnapshot = z.infer<typeof DemoSnapshotSchema>;

/** Runtime snapshot used by analysis UI and Tool Registry (demo or live). */
export const AnalysisSnapshotSchema = z.object({
  mode: z.enum(["demo", "live"]),
  referenceMonth: MonthSchema,
  months: z.array(MonthSchema).length(13),
  regions: z.array(RegionSeriesSchema).min(1),
  facilities: z.array(FacilitySchema),
  sourceNotes: z.array(z.string().min(1)),
});

export type AnalysisSnapshot = z.infer<typeof AnalysisSnapshotSchema>;
