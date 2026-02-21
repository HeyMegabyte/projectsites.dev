/**
 * @module billing
 * @packageDocumentation
 *
 * Zod schemas for **subscriptions**, **checkout sessions**, **entitlements**,
 * and **sale webhook payloads**.
 *
 * The billing module models the Stripe-backed subscription lifecycle. Each
 * organization has at most one active subscription that determines its plan
 * (`free | paid`) and associated entitlements. The dunning pipeline tracks
 * failed payments up to 60 days before automatic downgrade.
 *
 * | Zod Schema                     | Inferred Type            | Purpose                                           |
 * | ------------------------------ | ------------------------ | ------------------------------------------------- |
 * | `subscriptionSchema`           | `Subscription`           | Full subscription row from the database            |
 * | `createCheckoutSessionSchema`  | `CreateCheckoutSession`  | Payload for initiating a Stripe Checkout session   |
 * | `entitlementsSchema`           | `Entitlements`           | Feature flags and limits derived from the plan     |
 * | `saleWebhookPayloadSchema`     | `SaleWebhookPayload`    | Internal webhook payload emitted after a sale      |
 *
 * The `stripeEventTypes` tuple and `StripeEventType` union enumerate the
 * Stripe webhook event types the system handles.
 *
 * @example
 * ```ts
 * import { createCheckoutSessionSchema, type CreateCheckoutSession } from '@blitz/shared/schemas/billing';
 *
 * const input: CreateCheckoutSession = {
 *   org_id: '550e8400-e29b-41d4-a716-446655440000',
 *   success_url: 'https://bolt.megabyte.space/success',
 *   cancel_url: 'https://bolt.megabyte.space/cancel',
 * };
 * const parsed = createCheckoutSessionSchema.parse(input);
 * ```
 */
import { z } from 'zod';
import { baseFields, uuidSchema } from './base.js';
import { SUBSCRIPTION_STATES } from '../constants/index.js';

/**
 * Full subscription record as stored in the `subscriptions` database table.
 *
 * Tracks the Stripe customer and subscription IDs, the current plan
 * (`free | paid`), the subscription status (one of {@link SUBSCRIPTION_STATES}),
 * billing period boundaries, cancellation intent, retention offers, and the
 * dunning stage (0-60 days past due). Payment timestamps record the last
 * successful and last failed charge.
 *
 * Includes all {@link baseFields} (id, org_id, created_at, updated_at, deleted_at).
 */
export const subscriptionSchema = z.object({
  ...baseFields,
  stripe_customer_id: z.string().max(255),
  stripe_subscription_id: z.string().max(255).nullable(),
  plan: z.enum(['free', 'paid']),
  status: z.enum(SUBSCRIPTION_STATES),
  current_period_start: z.string().datetime().nullable(),
  current_period_end: z.string().datetime().nullable(),
  cancel_at_period_end: z.boolean().default(false),
  retention_offer_applied: z.boolean().default(false),
  dunning_stage: z.number().int().min(0).max(60).default(0),
  last_payment_at: z.string().datetime().nullable(),
  last_payment_failed_at: z.string().datetime().nullable(),
});

/**
 * Request payload for creating a new Stripe Checkout session.
 *
 * Requires the `org_id` that will own the resulting subscription, plus
 * `success_url` and `cancel_url` redirect targets (both must be valid URLs,
 * max 2048 chars). An optional `site_id` ties the checkout to a specific site.
 */
export const createCheckoutSessionSchema = z.object({
  org_id: uuidSchema,
  site_id: uuidSchema.optional(),
  success_url: z.string().url().max(2048),
  cancel_url: z.string().url().max(2048),
});

/**
 * Validation schema for creating an **embedded** Stripe Checkout session.
 *
 * Uses `ui_mode: 'embedded'` so the checkout form renders inline on the page
 * via Stripe.js `initEmbeddedCheckout()`. Requires a `return_url` with a
 * `{CHECKOUT_SESSION_ID}` placeholder that Stripe replaces on completion.
 */
export const createEmbeddedCheckoutSchema = z.object({
  org_id: uuidSchema,
  site_id: uuidSchema.optional(),
  return_url: z.string().url().max(2048),
});

/**
 * Tuple of Stripe webhook event types that the system processes.
 *
 * Used to filter incoming Stripe webhooks to only the events the billing
 * pipeline can handle. Any event type not in this list is acknowledged but
 * ignored.
 *
 * Currently handled events:
 * - `checkout.session.completed` -- new subscription created
 * - `invoice.paid` -- successful recurring payment
 * - `invoice.payment_failed` -- triggers dunning flow
 * - `customer.subscription.updated` -- plan or status change
 * - `customer.subscription.deleted` -- cancellation finalized
 */
export const stripeEventTypes = [
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;
/** Union type of the Stripe webhook event types the system handles. */
export type StripeEventType = (typeof stripeEventTypes)[number];

/**
 * Feature entitlements derived from an organization's current plan.
 *
 * Returned by the entitlements API endpoint to inform the front-end which
 * features are available. Includes boolean flags (`topBarHidden`,
 * `chatEnabled`, `analyticsEnabled`) and numeric limits
 * (`maxCustomDomains` 0-10). The values mirror the static
 * {@link ENTITLEMENTS} constant but are resolved at runtime per-org.
 */
export const entitlementsSchema = z.object({
  org_id: uuidSchema,
  plan: z.enum(['free', 'paid']),
  topBarHidden: z.boolean(),
  maxCustomDomains: z.number().int().min(0).max(10),
  chatEnabled: z.boolean(),
  analyticsEnabled: z.boolean(),
});

/**
 * Internal webhook payload emitted when a sale is recorded.
 *
 * Sent to downstream services (e.g. analytics, CRM) after a successful
 * Stripe checkout. Contains the full context needed for attribution:
 * organization, optional site, Stripe IDs, monetary amount in cents with
 * ISO 4217 currency code (3 chars), an ISO 8601 timestamp, and tracing
 * identifiers (`request_id`, `trace_id`) for observability.
 */
export const saleWebhookPayloadSchema = z.object({
  site_id: uuidSchema.nullable(),
  org_id: uuidSchema,
  stripe_customer_id: z.string().max(255),
  stripe_subscription_id: z.string().max(255),
  plan: z.enum(['free', 'paid']),
  amount_cents: z.number().int().min(0),
  currency: z.string().length(3),
  timestamp: z.string().datetime(),
  request_id: z.string().max(255),
  trace_id: z.string().max(255),
});

/** Inferred TypeScript type for a full subscription record. */
export type Subscription = z.infer<typeof subscriptionSchema>;

/** Inferred TypeScript type for the create-checkout-session request payload. */
export type CreateCheckoutSession = z.infer<typeof createCheckoutSessionSchema>;

/** Inferred TypeScript type for the embedded-checkout request payload. */
export type CreateEmbeddedCheckout = z.infer<typeof createEmbeddedCheckoutSchema>;

/** Inferred TypeScript type for the entitlements response object. */
export type Entitlements = z.infer<typeof entitlementsSchema>;

/** Inferred TypeScript type for the internal sale webhook payload. */
export type SaleWebhookPayload = z.infer<typeof saleWebhookPayloadSchema>;
