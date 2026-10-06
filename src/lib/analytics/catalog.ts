import { z } from "zod";
import { CUBE_LAYERS } from "@/lib/layers/catalog";

export const USAGE_DATASETS = [
  { id: "resident-population", label: "주민등록 인구·세대", provider: "행정안전부" },
  { id: "resident-vital", label: "출생등록·사망말소", provider: "행정안전부" },
  { id: "medical", label: "의료기관", provider: "건강보험심사평가원" },
  ...CUBE_LAYERS.filter((layer) => layer.id !== "population").map(({ id, label, provider }) => ({ id, label, provider })),
] as const;
export type UsageDataset = string;
export type UsageEventKind = "visit" | "analysis" | "export" | "share";
export type UsageEvent = { id: string; kind: UsageEventKind; datasets: UsageDataset[] };
export const UsageBatchSchema = z.object({
  visitorId: z.uuid(),
  events: z.array(z.object({
    id: z.uuid(),
    kind: z.enum(["visit", "analysis", "export", "share"]),
    datasets: z.array(z.enum(USAGE_DATASETS.map((item) => item.id) as [string, ...string[]])).max(USAGE_DATASETS.length),
  }).strict().refine((event) => event.kind === "analysis" ? event.datasets.length > 0 : event.datasets.length === 0,
    { message: "Only successful analyses include their used datasets" })).min(1).max(20),
}).strict();
export function datasetIdsForLayers(ids: readonly string[]): UsageDataset[] {
  return [...new Set(ids.map((id) => id === "population" ? "resident-population" : id))]
    .filter((id) => USAGE_DATASETS.some((item) => item.id === id));
}
