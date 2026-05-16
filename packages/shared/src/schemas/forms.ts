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

// ── Form Rules (AI engine) ─────────────────────────────────────

/**
 * Supported third-party integration providers that an AI form rule may invoke.
 * Broader than `newsletterProviderSchema` — covers webhooks, ops tools, generic credentials.
 */
export const formApiKeyProviderSchema = z.enum([
  'slack-webhook',
  'notion',
  'discord-webhook',
  'generic-webhook',
  'resend-transactional',
  'openai',
  'anthropic',
  'workers-ai',
  'stripe',
  'hubspot',
  'zapier',
  'n8n',
  'listmonk',
]);
export type FormApiKeyProvider = z.infer<typeof formApiKeyProviderSchema>;

/**
 * Action types the AI rule engine may emit. Each action is an instruction the
 * runtime dispatches against an integration (form_api_key) or a built-in side
 * effect (tag-submission, notify).
 *
 * Discriminated on `type`:
 * - slack-webhook       — POST a Slack-formatted payload to a stored webhook URL
 * - notion-page         — Create a Notion page in a target database
 * - generic-webhook     — POST arbitrary JSON to a stored webhook URL
 * - email               — Send a transactional email via Resend
 * - tag-submission      — Tag/categorize the submission in our own DB
 * - notify              — Notify the site owner (in-app + email)
 */
export const formRuleActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('slack-webhook'),
    api_key_id: z.string().min(1, 'api_key_id is required for slack-webhook'),
    payload: z.object({
      text: z.string().min(1).max(4000),
      channel: z.string().max(64).optional(),
      username: z.string().max(64).optional(),
    }),
  }),
  z.object({
    type: z.literal('notion-page'),
    api_key_id: z.string().min(1, 'api_key_id is required for notion-page'),
    payload: z.object({
      database_id: z.string().min(1).max(64),
      title: z.string().min(1).max(256),
      properties: z.record(z.unknown()).default({}),
      content_markdown: z.string().max(16384).optional(),
    }),
  }),
  z.object({
    type: z.literal('discord-webhook'),
    api_key_id: z.string().min(1, 'api_key_id is required for discord-webhook'),
    payload: z.object({
      content: z.string().min(1).max(2000),
      username: z.string().max(80).optional(),
    }),
  }),
  z.object({
    type: z.literal('generic-webhook'),
    api_key_id: z.string().min(1, 'api_key_id is required for generic-webhook'),
    payload: z.object({
      body: z.record(z.unknown()),
      headers: z.record(z.string()).optional(),
    }),
  }),
  z.object({
    type: z.literal('email'),
    api_key_id: z.string().optional(),
    payload: z.object({
      to: z.string().email(),
      subject: z.string().min(1).max(256),
      body_markdown: z.string().min(1).max(16384),
      from_name: z.string().max(64).optional(),
    }),
  }),
  z.object({
    type: z.literal('tag-submission'),
    payload: z.object({
      tags: z.array(z.string().min(1).max(32)).min(1).max(10),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
    }),
  }),
  z.object({
    type: z.literal('notify'),
    payload: z.object({
      title: z.string().min(1).max(120),
      body: z.string().min(1).max(2000),
      severity: z.enum(['info', 'success', 'warning', 'critical']).default('info'),
      channels: z.array(z.enum(['email', 'in-app'])).min(1).default(['in-app']),
    }),
  }),
]);
export type FormRuleAction = z.infer<typeof formRuleActionSchema>;

/**
 * Strict JSON contract the AI engine must emit. Used as the OpenAI structured-output
 * schema and the Zod parse target after the LLM call returns.
 */
export const formRuleActionsPlanSchema = z.object({
  reasoning: z.string().min(1).max(2000),
  actions: z.array(formRuleActionSchema).max(10),
  confidence: z.number().min(0).max(1).optional(),
});
export type FormRuleActionsPlan = z.infer<typeof formRuleActionsPlanSchema>;

/**
 * Body sent by the dashboard when creating a new form rule.
 */
export const createFormRuleSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  prompt: z.string().min(20).max(8000),
  model: z.string().min(1).max(120).optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(0).max(1000).default(100),
  trigger_form_name: z.string().max(64).nullable().optional(),
});
export type CreateFormRule = z.infer<typeof createFormRuleSchema>;

export const updateFormRuleSchema = createFormRuleSchema.partial();
export type UpdateFormRule = z.infer<typeof updateFormRuleSchema>;

/**
 * Public-safe form rule record returned by the dashboard list/get endpoints.
 */
export const formRuleRecordSchema = z.object({
  id: z.string(),
  site_id: z.string(),
  org_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  prompt: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  priority: z.number(),
  trigger_form_name: z.string().nullable(),
  last_evaluated_at: z.string().nullable(),
  last_actions_count: z.number(),
  last_error: z.string().nullable(),
  total_evaluations: z.number(),
  total_actions: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FormRuleRecord = z.infer<typeof formRuleRecordSchema>;

/**
 * Body sent by the dashboard when adding a generic API key.
 */
export const createFormApiKeySchema = z.object({
  provider: formApiKeyProviderSchema,
  label: z.string().min(1).max(120),
  api_key: z.string().min(1).max(2048),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().default(true),
});
export type CreateFormApiKey = z.infer<typeof createFormApiKeySchema>;

export const updateFormApiKeySchema = z.object({
  label: z.string().min(1).max(120).optional(),
  api_key: z.string().min(1).max(2048).optional(),
  config: z.record(z.unknown()).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateFormApiKey = z.infer<typeof updateFormApiKeySchema>;

/**
 * Public-safe API key record (never includes the raw key).
 */
export const formApiKeyRecordSchema = z.object({
  id: z.string(),
  site_id: z.string(),
  org_id: z.string(),
  provider: formApiKeyProviderSchema,
  label: z.string(),
  api_key_preview: z.string(),
  config: z.record(z.unknown()).nullable(),
  enabled: z.boolean(),
  last_used_at: z.string().nullable(),
  last_error: z.string().nullable(),
  use_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type FormApiKeyRecord = z.infer<typeof formApiKeyRecordSchema>;

/**
 * Stored evaluation row — audit trail of every AI rule run.
 */
export const formRuleEvaluationRecordSchema = z.object({
  id: z.string(),
  rule_id: z.string(),
  submission_id: z.string(),
  site_id: z.string(),
  org_id: z.string(),
  status: z.enum(['success', 'partial', 'failed', 'skipped']),
  actions_planned: z.number(),
  actions_executed: z.number(),
  actions_failed: z.number(),
  actions_json: z.string().nullable(),
  reasoning: z.string().nullable(),
  error: z.string().nullable(),
  duration_ms: z.number().nullable(),
  created_at: z.string(),
});
export type FormRuleEvaluationRecord = z.infer<typeof formRuleEvaluationRecordSchema>;
