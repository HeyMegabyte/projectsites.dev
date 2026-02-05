import { z } from 'zod';
import { baseFields, uuidSchema } from './base.js';
import { SUBSCRIPTION_STATES } from '../constants/index.js';

/** Subscription schema */
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

/** Create checkout session request */
export const createCheckoutSessionSchema = z.object({
  org_id: uuidSchema,
  site_id: uuidSchema.optional(),
  success_url: z.string().url().max(2048),
  cancel_url: z.string().url().max(2048),
});

/** Stripe webhook event IDs we handle */
export const stripeEventTypes = [
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;
export type StripeEventType = (typeof stripeEventTypes)[number];

/** Entitlements response */
export const entitlementsSchema = z.object({
  org_id: uuidSchema,
  plan: z.enum(['free', 'paid']),
  topBarHidden: z.boolean(),
  maxCustomDomains: z.number().int().min(0).max(5),
  chatEnabled: z.boolean(),
  analyticsEnabled: z.boolean(),
});

/** Sale webhook payload */
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

export type Subscription = z.infer<typeof subscriptionSchema>;
export type CreateCheckoutSession = z.infer<typeof createCheckoutSessionSchema>;
export type Entitlements = z.infer<typeof entitlementsSchema>;
export type SaleWebhookPayload = z.infer<typeof saleWebhookPayloadSchema>;
