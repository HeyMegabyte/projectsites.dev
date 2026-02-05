import { z } from 'zod';
import { baseFields, uuidSchema } from './base.js';
import { FUNNEL_EVENTS } from '../constants/index.js';

/** Analytics daily rollup */
export const analyticsDailySchema = z.object({
  ...baseFields,
  site_id: uuidSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  page_views: z.number().int().min(0).default(0),
  unique_visitors: z.number().int().min(0).default(0),
  bandwidth_bytes: z.number().int().min(0).default(0),
});

/** Funnel event record */
export const funnelEventSchema = z.object({
  id: baseFields.id,
  org_id: uuidSchema,
  user_id: uuidSchema.nullable(),
  site_id: uuidSchema.nullable(),
  event_name: z.enum(FUNNEL_EVENTS),
  metadata_json: z.record(z.unknown()).nullable(),
  created_at: baseFields.created_at,
});

/** Usage event (internal metering) */
export const usageEventSchema = z.object({
  id: baseFields.id,
  org_id: uuidSchema,
  event_type: z.string().max(100),
  quantity: z.number().int().min(0),
  metadata_json: z.record(z.unknown()).nullable(),
  created_at: baseFields.created_at,
});

export type AnalyticsDaily = z.infer<typeof analyticsDailySchema>;
export type FunnelEventRecord = z.infer<typeof funnelEventSchema>;
export type UsageEvent = z.infer<typeof usageEventSchema>;
