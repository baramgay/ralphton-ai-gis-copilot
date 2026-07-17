import { z } from "zod";

export const BoundaryMetadataSchema = z.object({
  version: z.string().regex(/^\d{8}$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  featureCount: z.number().int().positive(),
});

export type BoundaryMetadata = z.infer<typeof BoundaryMetadataSchema>;

export function parseBoundaryMetadata(input: unknown): BoundaryMetadata {
  return BoundaryMetadataSchema.parse(input);
}
