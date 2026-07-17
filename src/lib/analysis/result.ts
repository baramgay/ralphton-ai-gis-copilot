import type { Facility, RegionSeries } from "@/lib/domain/schemas";

export type MetricDescriptor = {
  label: string;
  value: number | null;
  unit: string;
  formula: string;
  referenceMonth: string;
  limitation: string;
};

export type AnalyzedRegion = {
  adm_cd2: string;
  adm_nm: string;
  representativePoint: RegionSeries["representativePoint"];
  areaSquareKm: number;
  rank: number | null;
  score: number | null;
  metrics: MetricDescriptor[];
};

export type LegendItem = {
  label: string;
  color: string;
  min: number | null;
  max: number | null;
};

export type AnalysisResult = {
  title: string;
  summary: string;
  rankedRegions: AnalyzedRegion[];
  selectedRegion: AnalyzedRegion | null;
  filteredFacilities: Facility[];
  legend: LegendItem[];
  formulaNotes: string[];
};
