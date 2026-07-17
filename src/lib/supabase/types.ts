import { z } from 'zod';

import {
  FacilitySchema,
  MonthSchema,
  RegionSeriesSchema,
} from '@/lib/domain/schemas';

export const CachedSnapshotSchema = z
  .object({
    mode: z.enum(['demo', 'live']),
    referenceMonth: MonthSchema,
    months: z.array(MonthSchema).length(13),
    regions: z.array(RegionSeriesSchema),
    facilities: z.array(FacilitySchema),
    sourceNotes: z.array(z.string().min(1)),
  })
  .strict()
  .refine((snapshot) => snapshot.months.at(-1) === snapshot.referenceMonth, {
    message: 'referenceMonth must be the latest month',
  });

export const SnapshotCacheWriteSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    source: z.string().min(1).max(200),
    checksum: z.string().regex(/^[a-f0-9]{64}$/i),
    isPublished: z.boolean(),
    snapshot: CachedSnapshotSchema,
  })
  .strict();

export type CachedSnapshot = z.infer<typeof CachedSnapshotSchema>;
export type SnapshotCacheWrite = z.infer<typeof SnapshotCacheWriteSchema>;
export type SnapshotReadMode = CachedSnapshot['mode'] | 'auto';
