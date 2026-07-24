import { z } from "zod";

export const AdminLevelSchema = z.enum(["dong", "sgg"]);
export type AdminLevel = z.infer<typeof AdminLevelSchema>;

export const LayerKindSchema = z.enum(["choropleth", "point"]);
export type LayerKind = z.infer<typeof LayerKindSchema>;

export const MetricDefSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  unit: z.string(),
  aggregation: z.enum(["sum", "weightedAvg"]),
  weightKey: z.string().min(1).optional(),
  formula: z.string().min(1),
  limitation: z.string(),
  triggers: z.array(z.string().min(1)),
});
export type MetricDef = z.infer<typeof MetricDefSchema>;

export const LayerDescriptorSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  provider: z.enum(["공공", "SKT", "NH", "KCB"]),
  kind: LayerKindSchema,
  coverage: z.literal("gyeongnam"),
  adminLevels: z.array(AdminLevelSchema).min(1),
  metrics: z.array(MetricDefSchema),
  months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)),
  sourceNotes: z.array(z.string().min(1)),
});
export type LayerDescriptor = z.infer<typeof LayerDescriptorSchema>;

export const LayerCellSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  point: z.object({ lat: z.number(), lng: z.number() }),
  areaKm2: z.number().nonnegative(),
  series: z.record(z.string(), z.array(z.number().nullable())),
  breakdown: z.record(z.string(), z.unknown()).optional(),
});
export type LayerCell = z.infer<typeof LayerCellSchema>;

export const LayerCubeSchema = z
  .object({
    layerId: z.string().min(1),
    adminLevel: AdminLevelSchema,
    referenceMonth: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    months: z.array(z.string()).min(1),
    cells: z.array(LayerCellSchema),
  })
  .refine(
    (cube) =>
      cube.cells.every((cell) =>
        Object.values(cell.series).every((s) => s.length === cube.months.length),
      ),
    { message: "series length must equal months length" },
  );
export type LayerCube = z.infer<typeof LayerCubeSchema>;
