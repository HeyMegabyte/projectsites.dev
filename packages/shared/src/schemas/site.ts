/**
 * Site and hostname schemas
 */
import { z } from 'zod';
import {
  uuidSchema,
  slugSchema,
  hostnameSchema,
  httpsUrlSchema,
  timestampsSchema,
  safeShortTextSchema,
  safeLongTextSchema,
} from './base.js';
import { orgIdSchema } from './org.js';

// =============================================================================
// SITE SCHEMAS
// =============================================================================

export const siteIdSchema = uuidSchema.describe('Site ID');

export const siteStatusSchema = z.enum([
  'pending', // Initial state, awaiting generation
  'generating', // AI workflow in progress
  'generated', // Generation complete, not yet published
  'publishing', // Deploy in progress
  'published', // Live and serving
  'failed', // Generation or publish failed
  'archived', // Soft-deleted, not serving
]);

export type SiteStatus = z.infer<typeof siteStatusSchema>;

export const siteSchema = z
  .object({
    id: siteIdSchema,
    org_id: orgIdSchema,
    slug: slugSchema,
    name: safeShortTextSchema.max(200),
    description: safeLongTextSchema.nullable(),
    status: siteStatusSchema,

    // Business info
    business_name: safeShortTextSchema.nullable(),
    business_email: z.string().email().nullable(),
    business_phone: z.string().nullable(),
    business_address: safeShortTextSchema.nullable(),
    google_place_id: z.string().nullable(),

    // Build info
    current_build_version: z.string().nullable(),
    last_published_at: z.string().datetime().nullable(),
    bolt_chat_id: z.string().nullable(),

    // Analytics
    lighthouse_score: z.number().int().min(0).max(100).nullable(),
    last_lighthouse_at: z.string().datetime().nullable(),

    // R2 storage
    r2_prefix: z.string().nullable(),
  })
  .merge(timestampsSchema);

export type Site = z.infer<typeof siteSchema>;

// =============================================================================
// SITE CREATION
// =============================================================================

export const createSiteSchema = z.object({
  name: safeShortTextSchema.min(1, 'Site name required').max(200),
  slug: slugSchema.optional(), // Auto-generated if not provided

  // Business info (from Google Places or manual entry)
  business_name: safeShortTextSchema.optional(),
  business_email: z.string().email().optional(),
  business_phone: z.string().optional(),
  business_address: safeShortTextSchema.optional(),
  google_place_id: z.string().optional(),
});

export type CreateSiteInput = z.infer<typeof createSiteSchema>;

export const updateSiteSchema = z.object({
  name: safeShortTextSchema.min(1).max(200).optional(),
  description: safeLongTextSchema.optional(),
  business_name: safeShortTextSchema.optional(),
  business_email: z.string().email().optional(),
  business_phone: z.string().optional(),
  business_address: safeShortTextSchema.optional(),
});

export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;

// =============================================================================
// HOSTNAME SCHEMAS
// =============================================================================

export const hostnameStatusSchema = z.enum([
  'pending', // CNAME not verified
  'verifying', // DNS check in progress
  'provisioning', // CF for SaaS provisioning
  'active', // SSL active, serving
  'failed', // Provisioning failed
  'deleted', // Removed
]);

export type HostnameStatus = z.infer<typeof hostnameStatusSchema>;

export const hostnameTypeSchema = z.enum([
  'free', // Auto-provisioned subdomain (e.g., slug.sites.megabyte.space)
  'custom', // Customer's own domain (CNAME)
]);

export type HostnameType = z.infer<typeof hostnameTypeSchema>;

export const siteHostnameSchema = z
  .object({
    id: uuidSchema,
    site_id: siteIdSchema,
    org_id: orgIdSchema,
    hostname: hostnameSchema,
    type: hostnameTypeSchema,
    status: hostnameStatusSchema,
    cf_hostname_id: z.string().nullable(), // Cloudflare for SaaS hostname ID
    ssl_status: z.enum(['pending', 'active', 'failed']).nullable(),
    verification_started_at: z.string().datetime().nullable(),
    verified_at: z.string().datetime().nullable(),
    last_check_at: z.string().datetime().nullable(),
    error_message: z.string().nullable(),
  })
  .merge(timestampsSchema);

export type SiteHostname = z.infer<typeof siteHostnameSchema>;

export const createHostnameSchema = z.object({
  hostname: hostnameSchema,
});

export type CreateHostnameInput = z.infer<typeof createHostnameSchema>;

// =============================================================================
// SITE LOOKUP (for Worker routing)
// =============================================================================

export const siteLookupSchema = z.object({
  site_id: siteIdSchema,
  slug: slugSchema,
  r2_prefix: z.string(),
  current_build_version: z.string().nullable(),
  is_paid: z.boolean(),
  org_id: orgIdSchema,
  ttl: z.number().int().positive(),
});

export type SiteLookup = z.infer<typeof siteLookupSchema>;

// =============================================================================
// CONFIDENCE ATTRIBUTES
// =============================================================================

export const confidenceAttributeSchema = z.object({
  id: uuidSchema,
  site_id: siteIdSchema,
  attribute_name: z.string(),
  value: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),
  source: z.string(),
  source_url: httpsUrlSchema.nullable(),
  reasoning: z.string().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type ConfidenceAttribute = z.infer<typeof confidenceAttributeSchema>;
