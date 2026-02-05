/**
 * Webhook schemas for all providers
 */
import { z } from 'zod';
import { uuidSchema, isoDateTimeSchema } from './base.js';
import { WEBHOOK_PROVIDERS, type WebhookProvider } from '../constants/index.js';

// =============================================================================
// WEBHOOK EVENT SCHEMA
// =============================================================================

export const webhookProviderSchema = z.enum(
  Object.values(WEBHOOK_PROVIDERS) as [WebhookProvider, ...WebhookProvider[]],
);

export const webhookStatusSchema = z.enum([
  'pending', // Just received
  'processing', // Being handled
  'processed', // Successfully handled
  'failed', // Handler failed
  'skipped', // Duplicate or irrelevant
  'quarantined', // Suspicious, needs review
]);

export type WebhookStatus = z.infer<typeof webhookStatusSchema>;

export const webhookEventSchema = z.object({
  id: uuidSchema,
  provider: webhookProviderSchema,
  event_id: z.string(), // Provider's event ID
  event_type: z.string(),
  status: webhookStatusSchema,
  payload_hash: z.string(), // For duplicate detection
  payload_pointer: z.string().nullable(), // R2 key if payload too large
  raw_payload: z.unknown().nullable(), // Stored only if small
  signature: z.string().nullable(),
  timestamp: isoDateTimeSchema, // From webhook
  received_at: isoDateTimeSchema,
  processed_at: isoDateTimeSchema.nullable(),
  attempts: z.number().int().min(0),
  last_error: z.string().nullable(),
  metadata: z.record(z.unknown()).nullable(),
});

export type WebhookEvent = z.infer<typeof webhookEventSchema>;

// =============================================================================
// IDEMPOTENCY KEY
// =============================================================================

export const idempotencyKeySchema = z.object({
  provider: webhookProviderSchema,
  event_id: z.string(),
});

export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

// =============================================================================
// STRIPE WEBHOOK SCHEMAS
// =============================================================================

export const stripeWebhookHeadersSchema = z.object({
  'stripe-signature': z.string(),
});

export const stripeCheckoutSessionSchema = z.object({
  id: z.string(),
  object: z.literal('checkout.session'),
  customer: z.string(),
  subscription: z.string().nullable(),
  client_reference_id: z.string().nullable(), // org_id
  customer_email: z.string().email().nullable(),
  metadata: z.record(z.string()).optional(),
  mode: z.enum(['subscription', 'payment', 'setup']),
  payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
  status: z.enum(['complete', 'expired', 'open']),
  amount_total: z.number().nullable(),
  currency: z.string().nullable(),
});

export type StripeCheckoutSession = z.infer<typeof stripeCheckoutSessionSchema>;

export const stripeSubscriptionSchema = z.object({
  id: z.string(),
  object: z.literal('subscription'),
  customer: z.string(),
  status: z.enum([
    'active',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'past_due',
    'paused',
    'trialing',
    'unpaid',
  ]),
  current_period_start: z.number(),
  current_period_end: z.number(),
  cancel_at_period_end: z.boolean(),
  canceled_at: z.number().nullable(),
  metadata: z.record(z.string()).optional(),
});

export type StripeSubscription = z.infer<typeof stripeSubscriptionSchema>;

export const stripeInvoiceSchema = z.object({
  id: z.string(),
  object: z.literal('invoice'),
  customer: z.string(),
  subscription: z.string().nullable(),
  status: z.enum(['draft', 'open', 'paid', 'void', 'uncollectible']),
  amount_due: z.number(),
  amount_paid: z.number(),
  currency: z.string(),
  due_date: z.number().nullable(),
  hosted_invoice_url: z.string().url().nullable(),
});

export type StripeInvoice = z.infer<typeof stripeInvoiceSchema>;

export const stripeEventSchema = z.object({
  id: z.string(),
  object: z.literal('event'),
  type: z.string(),
  created: z.number(),
  data: z.object({
    object: z.unknown(),
  }),
  livemode: z.boolean(),
  api_version: z.string().nullable(),
});

export type StripeEvent = z.infer<typeof stripeEventSchema>;

// =============================================================================
// WEBHOOK VERIFICATION CONFIG
// =============================================================================

export const webhookConfigSchema = z.object({
  /** Maximum age of webhook timestamp in seconds */
  maxTimestampAge: z.number().int().positive().default(300),
  /** Whether to store raw payloads */
  storePayloads: z.boolean().default(true),
  /** Maximum payload size before storing in R2 */
  maxInlinePayloadBytes: z.number().int().positive().default(64 * 1024),
});

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;
