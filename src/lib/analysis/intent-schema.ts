import { z } from 'zod';
import { AdminLevelSchema } from '@/lib/layers/types';

export const ALLOWED_FACILITY_TYPES = [
  '종합병원',
  '병원',
  '요양병원',
  '의원',
  '치과의원',
  '한의원',
  '보건소',
  '약국',
] as const;

export const ALLOWED_TOOLS = [
  'rankHospitalScarcity',
  'rankElderlyUnderserved',
  'rankPopulationGrowthPressure',
  'rankPopulationDeclineRisk',
  'rankSingleHouseholdRisk',
  'rankDeathCount',
  'rankBirthCount',
  'rankNaturalDecrease',
  'rankPopulationDensity',
  'rankPopulationSize',
  'rankElderlyRatio',
  'filterFacilitiesByTypeAndHours',
  'compareRegions',
  'nearestFacilityDistance',
  'countFacilitiesWithinRadius',
  'getRegionDetails',
] as const;

export const FacilityTypeSchema = z.enum(ALLOWED_FACILITY_TYPES);

export const ToolNameSchema = z.enum(ALLOWED_TOOLS);

export const AnalysisIntentSchema = z
  .object({
    tool: ToolNameSchema,
    layerId: z.string().min(1).max(40).optional(),
    metricKey: z.string().min(1).max(60).optional(),
    adminLevel: AdminLevelSchema.optional(),
    filters: z
      .object({
        facilityTypes: z.array(FacilityTypeSchema).max(20).optional(),
        includePharmacy: z.boolean().optional(),
        radiusKm: z.number().min(1).max(3).optional(),
        requireNightHours: z.boolean().optional(),
        requireWeekendHours: z.boolean().optional(),
        regions: z.array(z.string().min(1).max(50)).max(10).optional(),
        compare: z.array(z.string().min(1).max(50)).max(10).optional(),
        limit: z.number().int().min(1).max(600).optional(),
      })
      .strict(),
  })
  .strict();

export type AnalysisIntent = z.infer<typeof AnalysisIntentSchema>;
