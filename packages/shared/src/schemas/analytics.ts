/**
 * @module analytics
 * @packageDocumentation
 *
 * Zod schemas for analytics, funnel tracking, and internal usage metering.
 *
 * These schemas validate rows in the `analytics_daily`, `funnel_events`, and
 * `usage_events` Postgres tables. Daily rollups aggregate page-level traffic,
 * funnel events track user progression through the sign-up flow, and usage
 * events feed the internal metering system for billing.
 *
 * ## Schemas and Types
 *
 * | Export                 | Kind         | Inferred Type       | Description                              |
 * | ---------------------- | ------------ | ------------------- | ---------------------------------------- |
 * | `analyticsDailySchema` | `ZodObject`  | `AnalyticsDaily`    | Per-site daily traffic rollup            |
 * | `funnelEventSchema`    | `ZodObject`  | `FunnelEventRecord` | Conversion funnel event                  |
 * | `usageEventSchema`     | `ZodObject`  | `UsageEvent`        | Internal metering event for billing      |
 *
 * ## Usage
 *
 * ```ts
 * import { analyticsDailySchema, type AnalyticsDaily } from '@shared/schemas/analytics.js';
 *
 * const row: AnalyticsDaily = analyticsDailySchema.parse(rawDbRow);
 * console.log(row.page_views, row.unique_visitors);
 * ```
 */
import { z } from 'zod';
import { baseFields, uuidSchema } from './base.js';
import { FUNNEL_EVENTS } from '../constants/index.js';

/**
 * Validates a row from the `analytics_daily` table -- a per-site, per-day
 * rollup of traffic metrics.
 *
 * | Field              | Type                  | Description                            |
 * | ------------------ | --------------------- | -------------------------------------- |
 * | `site_id`          | UUID                  | Foreign key to the `sites` table       |
 * | `date`             | `YYYY-MM-DD` string   | Calendar date of the rollup            |
 * | `page_views`       | non-negative integer  | Total page views for the day           |
 * | `unique_visitors`  | non-negative integer  | Distinct visitor count                 |
 * | `bandwidth_bytes`  | non-negative integer  | Total bytes transferred                |
 *
 * Inherits {@link baseFields} (`id`, `org_id`, timestamps).
 */
export const analyticsDailySchema = z.object({
  ...baseFields,
  site_id: uuidSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  page_views: z.number().int().min(0).default(0),
  unique_visitors: z.number().int().min(0).default(0),
  bandwidth_bytes: z.number().int().min(0).default(0),
});

/**
 * Validates a row from the `funnel_events` table, which tracks user
 * progression through the sign-up and site-creation conversion funnel.
 *
 * `event_name` is constrained to the values defined in {@link FUNNEL_EVENTS}.
 * `user_id` and `site_id` may be `null` for anonymous or pre-site events.
 *
 * Unlike most entities this schema does **not** include `updated_at` or
 * `deleted_at` -- funnel events are append-only.
 */
export const funnelEventSchema = z.object({
  id: baseFields.id,
  org_id: uuidSchema,
  user_id: uuidSchema.nullable(),
  site_id: uuidSchema.nullable(),
  event_name: z.enum(FUNNEL_EVENTS),
  metadata_json: z.record(z.unknown()).nullable(),
  created_at: baseFields.created_at,
});

/**
 * Validates a row from the `usage_events` table used by the internal
 * metering system (when `METERING_PROVIDER` is `'internal'`).
 *
 * Each event records a single billable action (e.g. page view, bandwidth
 * consumed, AI generation) with an associated `quantity`.
 *
 * | Field           | Type                     | Description                        |
 * | --------------- | ------------------------ | ---------------------------------- |
 * | `event_type`    | string (max 100 chars)   | Metering event category            |
 * | `quantity`      | non-negative integer     | Units consumed                     |
 * | `metadata_json` | JSON object or `null`    | Additional event context           |
 */
export const usageEventSchema = z.object({
  id: baseFields.id,
  org_id: uuidSchema,
  event_type: z.string().max(100),
  quantity: z.number().int().min(0),
  metadata_json: z.record(z.unknown()).nullable(),
  created_at: baseFields.created_at,
});

/** Inferred TypeScript type for a daily analytics rollup row. */
export type AnalyticsDaily = z.infer<typeof analyticsDailySchema>;

/** Inferred TypeScript type for a funnel event row. */
export type FunnelEventRecord = z.infer<typeof funnelEventSchema>;

/** Inferred TypeScript type for an internal usage metering event row. */
export type UsageEvent = z.infer<typeof usageEventSchema>;
