/**
 * Workflow and job schemas for Cloudflare Workflows/Queues
 */
import { z } from 'zod';
import { uuidSchema, isoDateTimeSchema } from './base.js';
import { siteIdSchema } from './site.js';
import { orgIdSchema } from './org.js';
import { JOB_STATES, type JobState } from '../constants/index.js';

// =============================================================================
// JOB STATE SCHEMA
// =============================================================================

export const jobStateSchema = z.enum(
  Object.values(JOB_STATES) as [JobState, ...JobState[]],
);

// =============================================================================
// WORKFLOW JOB SCHEMA
// =============================================================================

export const workflowJobSchema = z.object({
  id: uuidSchema,
  workflow_id: z.string(), // Cloudflare Workflow instance ID
  job_name: z.string().max(100),
  org_id: orgIdSchema,
  site_id: siteIdSchema.nullable(),
  dedupe_key: z.string().max(200),
  state: jobStateSchema,
  payload_pointer: z.string().nullable(), // R2 key if large
  payload: z.unknown().nullable(),
  attempt: z.number().int().min(0),
  max_attempts: z.number().int().positive(),
  result: z.unknown().nullable(),
  error: z.string().nullable(),
  started_at: isoDateTimeSchema.nullable(),
  completed_at: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export type WorkflowJob = z.infer<typeof workflowJobSchema>;

// =============================================================================
// JOB ENVELOPE (for Queues)
// =============================================================================

export const jobEnvelopeSchema = z.object({
  job_id: uuidSchema,
  job_name: z.string().max(100),
  org_id: orgIdSchema,
  dedupe_key: z.string().max(200),
  payload_pointer: z.string().nullable(),
  payload: z.unknown().nullable(),
  attempt: z.number().int().min(0),
  max_attempts: z.number().int().positive(),
  trace_id: z.string().optional(),
  request_id: z.string().optional(),
});

export type JobEnvelope = z.infer<typeof jobEnvelopeSchema>;

// =============================================================================
// SITE GENERATION WORKFLOW
// =============================================================================

export const siteGenerationInputSchema = z.object({
  site_id: siteIdSchema,
  org_id: orgIdSchema,
  business_name: z.string(),
  business_email: z.string().email().optional(),
  business_phone: z.string().optional(),
  business_address: z.string().optional(),
  google_place_id: z.string().optional(),
  additional_info: z.record(z.unknown()).optional(),
});

export type SiteGenerationInput = z.infer<typeof siteGenerationInputSchema>;

export const siteGenerationResultSchema = z.object({
  site_id: siteIdSchema,
  build_version: z.string(),
  r2_prefix: z.string(),
  lighthouse_score: z.number().int().min(0).max(100).nullable(),
  assets: z.object({
    logo_url: z.string().url().nullable(),
    favicon_urls: z.record(z.string().url()).nullable(),
    poster_url: z.string().url().nullable(),
  }),
  meta: z.object({
    title: z.string(),
    description: z.string(),
    og_title: z.string(),
    og_description: z.string(),
    canonical_url: z.string().url(),
  }),
  completed_at: isoDateTimeSchema,
});

export type SiteGenerationResult = z.infer<typeof siteGenerationResultSchema>;

// =============================================================================
// MICROTASK SCHEMAS (for parallel AI research)
// =============================================================================

export const microtaskTypeSchema = z.enum([
  'nap_verification', // Name, Address, Phone
  'email_discovery',
  'phone_discovery',
  'address_verification',
  'website_discovery',
  'services_extraction',
  'reviews_discovery',
  'socials_discovery',
  'imagery_discovery',
  'copy_generation',
  'cta_generation',
]);

export type MicrotaskType = z.infer<typeof microtaskTypeSchema>;

export const microtaskResultSchema = z.object({
  task_type: microtaskTypeSchema,
  success: z.boolean(),
  confidence: z.number().int().min(0).max(100),
  data: z.unknown(),
  sources: z.array(
    z.object({
      url: z.string().url().optional(),
      name: z.string(),
      retrieved_at: isoDateTimeSchema,
    }),
  ),
  reasoning: z.string().nullable(),
  error: z.string().nullable(),
});

export type MicrotaskResult = z.infer<typeof microtaskResultSchema>;

// =============================================================================
// BUSINESS PROFILE (aggregated from microtasks)
// =============================================================================

export const businessProfileSchema = z.object({
  name: z.string(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  website: z.string().url().nullable(),
  services: z.array(z.string()),
  reviews: z.array(
    z.object({
      text: z.string(),
      rating: z.number().min(1).max(5).nullable(),
      source: z.string(),
      author: z.string().nullable(),
    }),
  ),
  social_links: z.record(z.string().url()),
  images: z.array(
    z.object({
      url: z.string().url(),
      alt: z.string().nullable(),
      type: z.enum(['logo', 'photo', 'product', 'team', 'location']),
      confidence: z.number().int().min(0).max(100),
    }),
  ),
  copy: z.object({
    headline: z.string().nullable(),
    tagline: z.string().nullable(),
    description: z.string().nullable(),
    ctas: z.array(z.string()),
  }),
});

export type BusinessProfile = z.infer<typeof businessProfileSchema>;

// =============================================================================
// LIGHTHOUSE RUN SCHEMA
// =============================================================================

export const lighthouseRunSchema = z.object({
  id: uuidSchema,
  site_id: siteIdSchema,
  build_version: z.string(),
  score_performance: z.number().int().min(0).max(100),
  score_accessibility: z.number().int().min(0).max(100),
  score_best_practices: z.number().int().min(0).max(100),
  score_seo: z.number().int().min(0).max(100),
  score_pwa: z.number().int().min(0).max(100).nullable(),
  report_url: z.string().url().nullable(), // R2 stored report
  suggestions: z.array(z.string()).nullable(),
  created_at: isoDateTimeSchema,
});

export type LighthouseRun = z.infer<typeof lighthouseRunSchema>;
