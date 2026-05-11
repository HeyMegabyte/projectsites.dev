/**
 * @module site
 * @packageDocumentation
 *
 * Zod schemas for **sites**, **confidence attributes**, and **research data**.
 *
 * A site represents a customer business website managed by the platform. Sites
 * progress through a lifecycle (`draft -> building -> published -> archived`)
 * and may be linked to a Google Place via `google_place_id`. Confidence
 * attributes and research data capture AI-generated intelligence gathered
 * during the automated site-building workflow.
 *
 * | Zod Schema                    | Inferred Type          | Purpose                                           |
 * | ----------------------------- | ---------------------- | ------------------------------------------------- |
 * | `siteSchema`                  | `Site`                 | Full site row from the database                   |
 * | `createSiteSchema`            | `CreateSite`           | Payload for creating a new site                   |
 * | `updateSiteSchema`            | `UpdateSite`           | Partial payload for updating an existing site     |
 * | `confidenceAttributeSchema`   | `ConfidenceAttribute`  | AI-sourced attribute with a confidence score       |
 * | `researchDataSchema`          | `ResearchData`         | Raw/parsed AI research output for a site          |
 *
 * @example
 * ```ts
 * import { createSiteSchema, type CreateSite } from '@blitz/shared/schemas/site';
 *
 * const input: CreateSite = {
 *   business_name: 'Acme Bakery',
 *   slug: 'acme-bakery',
 *   business_email: 'hello@acmebakery.com',
 * };
 * const parsed = createSiteSchema.parse(input);
 * ```
 */
import { z } from 'zod';
import { baseFields, slugSchema, httpsUrlSchema, nameSchema, confidenceScoreSchema } from './base.js';

/**
 * Full site record as stored in the `sites` database table.
 *
 * Contains business contact information, a lifecycle `status`
 * (`draft | building | published | archived`), an optional Google Place
 * reference, and Lighthouse performance metrics. The `slug` is used for
 * subdomain routing (`{slug}-sites.megabyte.space`) and R2 storage paths
 * (`sites/{slug}/{version}/{file}`).
 *
 * Includes all {@link baseFields} (id, org_id, created_at, updated_at, deleted_at).
 */
/**
 * Budget tier controls how much premium media generation a build can consume.
 *
 * - `free`: Stock-first imagery, 2 generated images max, no video/podcast/immersive.
 * - `standard`: 5 generated images, no video/podcast.
 * - `plus` ($29 one-time): 10 generated images + 1 Sora hero video.
 * - `premium` ($79 one-time): 15 generated images + Sora suite + NotebookLM podcast + immersive infographics.
 */
export const budgetTierSchema = z.enum(['free', 'standard', 'plus', 'premium']);

/** Inferred TypeScript type for budget tier. */
export type BudgetTier = z.infer<typeof budgetTierSchema>;

/**
 * Per-tier capability map. Drives image_discovery + image_generation caps,
 * Sora/podcast gating in the workflow, and Stripe checkout addon line items.
 */
export const TIER_CAPS = {
  free: {
    max_generated_images: 2,
    video_enabled: false,
    podcast_enabled: false,
    immersive_enabled: false,
    addon_cents: 0,
  },
  standard: {
    max_generated_images: 5,
    video_enabled: false,
    podcast_enabled: false,
    immersive_enabled: false,
    addon_cents: 0,
  },
  plus: {
    max_generated_images: 10,
    video_enabled: true,
    podcast_enabled: false,
    immersive_enabled: false,
    addon_cents: 2900,
  },
  premium: {
    max_generated_images: 15,
    video_enabled: true,
    podcast_enabled: true,
    immersive_enabled: true,
    addon_cents: 7900,
  },
} as const;

export const siteSchema = z.object({
  ...baseFields,
  slug: slugSchema,
  business_name: nameSchema,
  business_phone: z.string().max(20).nullable(),
  business_email: z.string().email().max(254).nullable(),
  business_address: z.string().max(500).nullable(),
  google_place_id: z.string().max(255).nullable(),
  bolt_chat_id: z.string().max(255).nullable(),
  current_build_version: z.string().max(100).nullable(),
  status: z.enum(['draft', 'building', 'published', 'archived']),
  budget_tier: budgetTierSchema.default('free'),
  lighthouse_score: z.number().int().min(0).max(100).nullable(),
  lighthouse_last_run: z.string().datetime().nullable(),
});

/**
 * Request payload for creating a new site.
 *
 * Only `business_name` is required. The `slug` is optional and will be
 * auto-generated from the business name when omitted. All other contact
 * fields are optional and can be enriched later by the AI research pipeline.
 */
export const createSiteSchema = z.object({
  business_name: nameSchema,
  slug: slugSchema.optional(),
  business_phone: z.string().max(20).optional(),
  business_email: z.string().email().max(254).optional(),
  business_address: z.string().max(500).optional(),
  google_place_id: z.string().max(255).optional(),
  budget_tier: budgetTierSchema.optional(),
});

/**
 * Partial payload for updating an existing site.
 *
 * Every field is optional. Nullable fields (e.g. `business_phone`) accept
 * `null` to explicitly clear a value, or the field can be omitted entirely
 * to leave it unchanged. The `status` field can be set to transition the
 * site through its lifecycle states.
 */
export const updateSiteSchema = z.object({
  business_name: nameSchema.optional(),
  business_phone: z.string().max(20).nullable().optional(),
  business_email: z.string().email().max(254).nullable().optional(),
  business_address: z.string().max(500).nullable().optional(),
  bolt_chat_id: z.string().max(255).nullable().optional(),
  current_build_version: z.string().max(100).nullable().optional(),
  status: z.enum(['draft', 'building', 'published', 'archived']).optional(),
  budget_tier: budgetTierSchema.optional(),
});

/**
 * AI-generated confidence attribute for a site.
 *
 * Stores a single key-value attribute (e.g. `"cuisine" = "Italian"`) along
 * with a confidence score (0-100), the data source URL, and an optional
 * rationale explaining why the AI assigned that confidence level.
 * Used by the research pipeline to accumulate structured business intelligence.
 *
 * Includes all {@link baseFields} (id, org_id, created_at, updated_at, deleted_at).
 */
export const confidenceAttributeSchema = z.object({
  ...baseFields,
  site_id: z.string().uuid(),
  attribute_name: z.string().max(100),
  attribute_value: z.string().max(2000),
  confidence: confidenceScoreSchema,
  source: z.string().max(500),
  rationale: z.string().max(2000).nullable(),
});

/**
 * Raw and parsed output from an AI research task for a site.
 *
 * Each record captures the `task_name` that produced it (e.g.
 * `"google_places_enrichment"`), the raw LLM output (up to 64 KB), an
 * optional parsed JSON representation, a confidence score (0-100), and up
 * to 20 HTTPS source URLs that the AI cited during research.
 *
 * Includes all {@link baseFields} (id, org_id, created_at, updated_at, deleted_at).
 */
export const researchDataSchema = z.object({
  ...baseFields,
  site_id: z.string().uuid(),
  task_name: z.string().max(100),
  raw_output: z.string().max(65536),
  parsed_output: z.record(z.unknown()).nullable(),
  confidence: confidenceScoreSchema,
  source_urls: z.array(httpsUrlSchema).max(20),
});

/** Inferred TypeScript type for a full site record. */
export type Site = z.infer<typeof siteSchema>;

/** Inferred TypeScript type for the create-site request payload. */
export type CreateSite = z.infer<typeof createSiteSchema>;

/** Inferred TypeScript type for the update-site request payload. */
export type UpdateSite = z.infer<typeof updateSiteSchema>;

/** Inferred TypeScript type for an AI-generated confidence attribute. */
export type ConfidenceAttribute = z.infer<typeof confidenceAttributeSchema>;

/** Inferred TypeScript type for an AI research data record. */
export type ResearchData = z.infer<typeof researchDataSchema>;
