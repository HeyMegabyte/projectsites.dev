import { z } from 'zod';
import { baseFields, slugSchema, httpsUrlSchema, nameSchema, confidenceScoreSchema } from './base.js';

/** Site schema */
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
  lighthouse_score: z.number().int().min(0).max(100).nullable(),
  lighthouse_last_run: z.string().datetime().nullable(),
});

/** Create site request */
export const createSiteSchema = z.object({
  business_name: nameSchema,
  slug: slugSchema.optional(),
  business_phone: z.string().max(20).optional(),
  business_email: z.string().email().max(254).optional(),
  business_address: z.string().max(500).optional(),
  google_place_id: z.string().max(255).optional(),
});

/** Update site */
export const updateSiteSchema = z.object({
  business_name: nameSchema.optional(),
  business_phone: z.string().max(20).nullable().optional(),
  business_email: z.string().email().max(254).nullable().optional(),
  business_address: z.string().max(500).nullable().optional(),
  bolt_chat_id: z.string().max(255).nullable().optional(),
  current_build_version: z.string().max(100).nullable().optional(),
  status: z.enum(['draft', 'building', 'published', 'archived']).optional(),
});

/** Confidence attribute */
export const confidenceAttributeSchema = z.object({
  ...baseFields,
  site_id: z.string().uuid(),
  attribute_name: z.string().max(100),
  attribute_value: z.string().max(2000),
  confidence: confidenceScoreSchema,
  source: z.string().max(500),
  rationale: z.string().max(2000).nullable(),
});

/** Research data */
export const researchDataSchema = z.object({
  ...baseFields,
  site_id: z.string().uuid(),
  task_name: z.string().max(100),
  raw_output: z.string().max(65536),
  parsed_output: z.record(z.unknown()).nullable(),
  confidence: confidenceScoreSchema,
  source_urls: z.array(httpsUrlSchema).max(20),
});

export type Site = z.infer<typeof siteSchema>;
export type CreateSite = z.infer<typeof createSiteSchema>;
export type UpdateSite = z.infer<typeof updateSiteSchema>;
export type ConfidenceAttribute = z.infer<typeof confidenceAttributeSchema>;
export type ResearchData = z.infer<typeof researchDataSchema>;
