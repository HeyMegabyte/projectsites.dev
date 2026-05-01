/**
 * @module schemas/forms
 * @description Zod schemas for the standardized projectsites.dev forms +
 * newsletter integrations API. Used by the public form-submission ingest
 * endpoint and the auth-gated dashboard CRUD endpoints.
 */

import { z } from 'zod';
import { emailSchema, slugSchema } from './base.js';

/**
 * Supported newsletter providers. `webhook` is a generic JSON POST forwarder.
 */
export const newsletterProviderSchema = z.enum([
  'mailchimp',
  'webhook',
  'resend',
  'sendgrid',
  'convertkit',
  'klaviyo',
]);
export type NewsletterProvider = z.infer<typeof newsletterProviderSchema>;

/**
 * Public submission payload posted by the forms.js drop-in (or any client).
 *
 * The endpoint identifies the site via the `X-Site-Slug` header, validates
 * Origin against the site's allowed hostnames, captures the submission to D1,
 * then fans the email out to every active integration on that site.
 */
export const formSubmissionInputSchema = z.object({
  form_name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-_]{0,62}$/i, 'form_name must be a short slug')
    .default('default'),
  email: emailSchema.optional(),
  fields: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .refine((val) => JSON.stringify(val).length <= 16384, 'Form payload too large (max 16KB)')
    .default({}),
  origin_url: z.string().url().max(2048).optional(),
});
export type FormSubmissionInput = z.infer<typeof formSubmissionInputSchema>;

/**
 * Stored form submission row as returned by the dashboard list endpoint.
 */
export const formSubmissionRecordSchema = z.object({
  id: z.string(),
  site_id: z.string(),
  form_name: z.string(),
  email: z.string().nullable(),
  payload: z.record(z.unknown()),
  ip_address: z.string().nullable(),
  user_agent: z.string().nullable(),
  origin_url: z.string().nullable(),
  forwarded_to: z.array(z.string()).default([]),
  status: z.enum(['received', 'forwarded', 'partial', 'failed']),
  created_at: z.string(),
});
export type FormSubmissionRecord = z.infer<typeof formSubmissionRecordSchema>;

/**
 * Body sent by the dashboard when connecting a newsletter provider.
 *
 * Provider-specific shape:
 * | Provider     | Required fields                                 |
 * | ------------ | ----------------------------------------------- |
 * | mailchimp    | `api_key`, `list_id`                            |
 * | sendgrid     | `api_key`, `list_id`                            |
 * | convertkit   | `api_key` (form_id stored in `config.form_id`)  |
 * | klaviyo      | `api_key`, `list_id`                            |
 * | resend       | `api_key`, `list_id` (audience id)              |
 * | webhook      | `webhook_url`                                   |
 */
export const createIntegrationSchema = z
  .object({
    provider: newsletterProviderSchema,
    api_key: z.string().min(1).max(512).optional(),
    list_id: z.string().max(128).optional(),
    webhook_url: z.string().url().max(2048).optional(),
    config: z.record(z.unknown()).optional(),
  })
  .refine(
    (val) => {
      if (val.provider === 'webhook') return Boolean(val.webhook_url);
      return Boolean(val.api_key);
    },
    { message: 'webhook provider requires webhook_url; all others require api_key' },
  );
export type CreateIntegration = z.infer<typeof createIntegrationSchema>;

export const updateIntegrationSchema = z.object({
  active: z.boolean().optional(),
  api_key: z.string().min(1).max(512).optional(),
  list_id: z.string().max(128).optional(),
  webhook_url: z.string().url().max(2048).optional(),
  config: z.record(z.unknown()).optional(),
});
export type UpdateIntegration = z.infer<typeof updateIntegrationSchema>;

/**
 * Public-safe newsletter integration record (never includes the raw API key).
 */
export const integrationRecordSchema = z.object({
  id: z.string(),
  site_id: z.string(),
  provider: newsletterProviderSchema,
  list_id: z.string().nullable(),
  webhook_url: z.string().nullable(),
  api_key_preview: z.string().nullable(),
  active: z.boolean(),
  last_dispatch_at: z.string().nullable(),
  last_error: z.string().nullable(),
  config: z.record(z.unknown()).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type IntegrationRecord = z.infer<typeof integrationRecordSchema>;

/**
 * Path-parameter validator for site-scoped routes.
 */
export const siteSlugParamSchema = z.object({ slug: slugSchema });
