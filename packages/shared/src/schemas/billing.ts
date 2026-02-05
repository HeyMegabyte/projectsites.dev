/**
 * Billing and subscription schemas
 */
import { z } from 'zod';
import { uuidSchema, timestampsSchema, isoDateTimeSchema } from './base.js';
import { orgIdSchema } from './org.js';
import { PRICING, ENTITLEMENTS } from '../constants/index.js';

// =============================================================================
// SUBSCRIPTION SCHEMAS
// =============================================================================

export const subscriptionStatusSchema = z.enum([
  'active', // Paid and current
  'past_due', // Payment failed, grace period
  'cancelled', // User cancelled
  'none', // Never subscribed (free tier)
]);

export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

export const subscriptionSchema = z
  .object({
    id: uuidSchema,
    org_id: orgIdSchema,
    stripe_subscription_id: z.string().nullable(),
    stripe_customer_id: z.string().nullable(),
    status: subscriptionStatusSchema,
    plan: z.enum(['free', 'paid']).default('free'),
    current_period_start: isoDateTimeSchema.nullable(),
    current_period_end: isoDateTimeSchema.nullable(),
    cancel_at_period_end: z.boolean().default(false),
    cancelled_at: isoDateTimeSchema.nullable(),

    // Dunning
    past_due_since: isoDateTimeSchema.nullable(),
    dunning_stage: z.number().int().min(0).max(4).default(0),
    last_dunning_at: isoDateTimeSchema.nullable(),

    // Retention offer
    retention_offer_applied: z.boolean().default(false),
    retention_offer_expires_at: isoDateTimeSchema.nullable(),
  })
  .merge(timestampsSchema);

export type Subscription = z.infer<typeof subscriptionSchema>;

// =============================================================================
// ENTITLEMENTS SCHEMA
// =============================================================================

export const entitlementsSchema = z.object({
  topBarHidden: z.boolean(),
  maxCustomDomains: z.number().int().nonnegative(),
  canAccessBilling: z.boolean(),
  canInviteMembers: z.boolean(),
});

export type Entitlements = z.infer<typeof entitlementsSchema>;

/** Get entitlements for a subscription status */
export function getEntitlements(status: SubscriptionStatus): Entitlements {
  if (status === 'active') {
    return ENTITLEMENTS.PAID;
  }
  return ENTITLEMENTS.FREE;
}

// =============================================================================
// CHECKOUT SCHEMAS
// =============================================================================

export const createCheckoutSessionSchema = z.object({
  org_id: orgIdSchema,
  success_url: z.string().url(),
  cancel_url: z.string().url(),
  // Optional: pre-fill customer email
  customer_email: z.string().email().optional(),
});

export type CreateCheckoutSessionInput = z.infer<typeof createCheckoutSessionSchema>;

export const checkoutSessionResponseSchema = z.object({
  url: z.string().url(),
  session_id: z.string(),
});

export type CheckoutSessionResponse = z.infer<typeof checkoutSessionResponseSchema>;

// =============================================================================
// BILLING PORTAL SCHEMA
// =============================================================================

export const createBillingPortalSessionSchema = z.object({
  org_id: orgIdSchema,
  return_url: z.string().url(),
});

export type CreateBillingPortalSessionInput = z.infer<typeof createBillingPortalSessionSchema>;

// =============================================================================
// INVOICE SCHEMAS
// =============================================================================

export const invoiceSchema = z.object({
  id: uuidSchema,
  org_id: orgIdSchema,
  stripe_invoice_id: z.string(),
  amount_cents: z.number().int(),
  currency: z.string().length(3),
  status: z.enum(['draft', 'open', 'paid', 'void', 'uncollectible']),
  due_date: isoDateTimeSchema.nullable(),
  paid_at: isoDateTimeSchema.nullable(),
  hosted_invoice_url: z.string().url().nullable(),
  created_at: isoDateTimeSchema,
});

export type Invoice = z.infer<typeof invoiceSchema>;

// =============================================================================
// USAGE EVENTS (for metering if Lago is off)
// =============================================================================

export const usageEventSchema = z.object({
  id: uuidSchema,
  org_id: orgIdSchema,
  event_type: z.string(),
  quantity: z.number(),
  metadata: z.record(z.unknown()).optional(),
  created_at: isoDateTimeSchema,
});

export type UsageEvent = z.infer<typeof usageEventSchema>;

// =============================================================================
// SALE WEBHOOK PAYLOAD
// =============================================================================

export const saleWebhookPayloadSchema = z.object({
  site_id: uuidSchema,
  org_id: orgIdSchema,
  stripe_customer_id: z.string(),
  stripe_subscription_id: z.string(),
  plan: z.literal('paid'),
  amount_cents: z.number().int().positive(),
  currency: z.string().length(3),
  timestamp: isoDateTimeSchema,
  request_id: z.string(),
  trace_id: z.string().optional(),
});

export type SaleWebhookPayload = z.infer<typeof saleWebhookPayloadSchema>;
