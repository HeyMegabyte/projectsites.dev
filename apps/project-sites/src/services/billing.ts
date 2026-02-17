/**
 * @module billing
 * @description Billing and subscription management service for Project Sites.
 *
 * Handles all Stripe integration, subscription lifecycle, entitlement resolution,
 * and optional sale-webhook delivery. Every database operation uses parameterized
 * SQL via the D1 helpers in {@link db}.
 *
 * ## Data Model
 *
 * | Table           | Key Columns                                                                 | Purpose                        |
 * | --------------- | --------------------------------------------------------------------------- | ------------------------------ |
 * | `subscriptions` | `id`, `org_id`, `stripe_customer_id`, `stripe_subscription_id`              | One row per org subscription    |
 * |                 | `plan` (`free` / `paid`), `status` (`active` / `past_due` / `canceled`)     | Current billing state           |
 * |                 | `cancel_at_period_end` (0/1), `dunning_stage`, `retention_offer_applied`    | Cancellation & dunning flags    |
 * |                 | `current_period_start`, `current_period_end`, `last_payment_at`             | Billing period timestamps       |
 * |                 | `last_payment_failed_at`, `created_at`, `updated_at`, `deleted_at`          | Audit & soft-delete timestamps  |
 *
 * ## Stripe Event Flow
 *
 * ```
 * checkout.session.completed  -> handleCheckoutCompleted   -> plan='paid', status='active'
 * customer.subscription.updated -> handleSubscriptionUpdated -> sync status & period
 * customer.subscription.deleted -> handleSubscriptionDeleted -> plan='free', status='canceled'
 * invoice.payment_failed       -> handlePaymentFailed       -> status='past_due'
 * ```
 *
 * ## Boolean Convention
 *
 * D1 (SQLite) uses integer `0` / `1` for boolean columns. All boolean fields
 * (`cancel_at_period_end`, `retention_offer_applied`) are written as `0` or `1`.
 *
 * @packageDocumentation
 */

import { PRICING, type Entitlements, getEntitlements, badRequest } from '@project-sites/shared';
import { dbQuery, dbQueryOne, dbInsert, dbUpdate } from './db.js';
import type { Env } from '../types/env.js';

/**
 * Get or create a Stripe customer for an organisation.
 *
 * 1. Looks up the `subscriptions` table for an existing `stripe_customer_id`.
 * 2. If none exists, creates a customer via the Stripe API and inserts a new
 *    free-tier subscription row.
 *
 * @param db    - The D1Database binding from `env.DB`.
 * @param env   - Worker environment containing `STRIPE_SECRET_KEY`.
 * @param orgId - Organisation UUID.
 * @param email - Billing email forwarded to Stripe.
 * @returns Object containing the Stripe customer ID.
 *
 * @example
 * ```ts
 * const { stripe_customer_id } = await getOrCreateStripeCustomer(
 *   env.DB, env, orgId, 'owner@example.com',
 * );
 * ```
 */
export async function getOrCreateStripeCustomer(
  db: D1Database,
  env: Env,
  orgId: string,
  email: string,
): Promise<{ stripe_customer_id: string }> {
  // Check if org already has a Stripe customer
  const existing = await dbQueryOne<{ id: string; stripe_customer_id: string }>(
    db,
    'SELECT id, stripe_customer_id FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
    [orgId],
  );

  if (existing?.stripe_customer_id) {
    return { stripe_customer_id: existing.stripe_customer_id };
  }

  // Create Stripe customer via API
  const response = await fetch('https://api.stripe.com/v1/customers', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      email,
      'metadata[org_id]': orgId,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw badRequest(`Failed to create Stripe customer: ${err}`);
  }

  const customer = (await response.json()) as { id: string };

  // Insert subscription record with free plan defaults
  await dbInsert(db, 'subscriptions', {
    id: crypto.randomUUID(),
    org_id: orgId,
    stripe_customer_id: customer.id,
    stripe_subscription_id: null,
    plan: 'free',
    status: 'active',
    cancel_at_period_end: 0,
    retention_offer_applied: 0,
    dunning_stage: 0,
    deleted_at: null,
  });

  return { stripe_customer_id: customer.id };
}

/**
 * Create a Stripe Checkout session optimised for Stripe Link.
 *
 * Resolves (or creates) the org's Stripe customer, then builds a Checkout
 * session with card + Link payment methods, a single Pro line-item, and
 * optional promotion codes.
 *
 * @param db   - The D1Database binding from `env.DB`.
 * @param env  - Worker environment containing `STRIPE_SECRET_KEY`.
 * @param opts - Checkout options including org ID, return URLs, and customer email.
 * @returns Object with the hosted checkout URL and session ID.
 *
 * @example
 * ```ts
 * const { checkout_url, session_id } = await createCheckoutSession(
 *   env.DB, env, {
 *     orgId,
 *     siteId: 'site-uuid',
 *     customerEmail: 'owner@example.com',
 *     successUrl: 'https://example.com/success',
 *     cancelUrl: 'https://example.com/cancel',
 *   },
 * );
 * ```
 */
export async function createCheckoutSession(
  db: D1Database,
  env: Env,
  opts: {
    orgId: string;
    siteId?: string;
    customerEmail: string;
    successUrl: string;
    cancelUrl: string;
  },
): Promise<{ checkout_url: string; session_id: string }> {
  const { stripe_customer_id } = await getOrCreateStripeCustomer(
    db,
    env,
    opts.orgId,
    opts.customerEmail,
  );

  const params = new URLSearchParams({
    mode: 'subscription',
    customer: stripe_customer_id,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    'payment_method_types[0]': 'card',
    'payment_method_types[1]': 'link',
    'line_items[0][price_data][currency]': PRICING.CURRENCY,
    'line_items[0][price_data][unit_amount]': String(PRICING.MONTHLY_CENTS),
    'line_items[0][price_data][recurring][interval]': 'month',
    'line_items[0][price_data][product_data][name]': 'Project Sites Pro',
    'line_items[0][price_data][product_data][description]':
      'Remove top bar, custom domains, analytics',
    'line_items[0][quantity]': '1',
    allow_promotion_codes: 'true',
    billing_address_collection: 'auto',
  });

  if (opts.siteId) {
    params.append('metadata[site_id]', opts.siteId);
  }
  params.append('metadata[org_id]', opts.orgId);

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!response.ok) {
    const err = await response.text();
    throw badRequest(`Failed to create Stripe checkout: ${err}`);
  }

  const session = (await response.json()) as { id: string; url: string };

  return { checkout_url: session.url, session_id: session.id };
}

/**
 * Handle the `checkout.session.completed` Stripe webhook event.
 *
 * Updates the organisation's subscription row to `plan = 'paid'` and
 * `status = 'active'`, records the Stripe subscription ID and payment
 * timestamp, then fires the optional external sale webhook.
 *
 * @param db    - The D1Database binding from `env.DB`.
 * @param env   - Worker environment (Stripe key, webhook config).
 * @param event - Parsed Stripe event payload with customer, subscription, and metadata.
 *
 * @example
 * ```ts
 * await handleCheckoutCompleted(env.DB, env, {
 *   customer: 'cus_xxx',
 *   subscription: 'sub_xxx',
 *   metadata: { org_id: 'org-uuid', site_id: 'site-uuid' },
 * });
 * ```
 */
export async function handleCheckoutCompleted(
  db: D1Database,
  env: Env,
  event: {
    customer: string;
    subscription: string;
    metadata?: { org_id?: string; site_id?: string };
  },
): Promise<void> {
  const orgId = event.metadata?.org_id;
  if (!orgId) {
    throw badRequest('Missing org_id in checkout metadata');
  }

  await dbUpdate(
    db,
    'subscriptions',
    {
      stripe_subscription_id: event.subscription,
      plan: 'paid',
      status: 'active',
      dunning_stage: 0,
      last_payment_at: new Date().toISOString(),
    },
    'org_id = ?',
    [orgId],
  );

  // Mark the specific site as paid if site_id is present
  const siteId = event.metadata?.site_id;
  if (siteId) {
    await dbUpdate(db, 'sites', { plan: 'paid' }, 'id = ? AND org_id = ?', [siteId, orgId]);
  }

  // Call optional sale webhook
  if (env.SALE_WEBHOOK_URL && env.SALE_WEBHOOK_SECRET) {
    await callSaleWebhook(env, {
      org_id: orgId,
      site_id: event.metadata?.site_id ?? null,
      stripe_customer_id: event.customer,
      stripe_subscription_id: event.subscription,
    });
  }
}

/**
 * Handle the `customer.subscription.updated` Stripe webhook event.
 *
 * Syncs the subscription status, cancellation flag, and billing period
 * timestamps from Stripe into the local `subscriptions` row.
 *
 * @param db    - The D1Database binding from `env.DB`.
 * @param event - Parsed Stripe subscription object with period timestamps (Unix seconds).
 *
 * @example
 * ```ts
 * await handleSubscriptionUpdated(env.DB, {
 *   id: 'sub_xxx',
 *   status: 'active',
 *   cancel_at_period_end: false,
 *   current_period_start: 1700000000,
 *   current_period_end: 1702600000,
 *   metadata: { org_id: 'org-uuid' },
 * });
 * ```
 */
export async function handleSubscriptionUpdated(
  db: D1Database,
  event: {
    id: string;
    status: string;
    cancel_at_period_end: boolean;
    current_period_start: number;
    current_period_end: number;
    metadata?: { org_id?: string };
  },
): Promise<void> {
  const orgId = event.metadata?.org_id;
  if (!orgId) return;

  await dbUpdate(
    db,
    'subscriptions',
    {
      status: event.status,
      cancel_at_period_end: event.cancel_at_period_end ? 1 : 0,
      current_period_start: new Date(event.current_period_start * 1000).toISOString(),
      current_period_end: new Date(event.current_period_end * 1000).toISOString(),
    },
    'org_id = ?',
    [orgId],
  );
}

/**
 * Handle the `customer.subscription.deleted` Stripe webhook event (cancellation).
 *
 * Downgrades the organisation to the free plan and clears the Stripe
 * subscription ID.
 *
 * @param db    - The D1Database binding from `env.DB`.
 * @param event - Parsed Stripe subscription object with metadata.
 *
 * @example
 * ```ts
 * await handleSubscriptionDeleted(env.DB, {
 *   id: 'sub_xxx',
 *   metadata: { org_id: 'org-uuid' },
 * });
 * ```
 */
export async function handleSubscriptionDeleted(
  db: D1Database,
  event: { id: string; metadata?: { org_id?: string } },
): Promise<void> {
  const orgId = event.metadata?.org_id;
  if (!orgId) return;

  await dbUpdate(
    db,
    'subscriptions',
    {
      plan: 'free',
      status: 'canceled',
      stripe_subscription_id: null,
    },
    'org_id = ?',
    [orgId],
  );

  // Downgrade all org sites to free
  await dbUpdate(db, 'sites', { plan: 'free' }, 'org_id = ?', [orgId]);
}

/**
 * Handle the `invoice.payment_failed` Stripe webhook event.
 *
 * Marks the subscription as `past_due` and records the failure timestamp
 * for dunning-flow tracking.
 *
 * @param db    - The D1Database binding from `env.DB`.
 * @param event - Parsed Stripe invoice event with subscription and metadata.
 *
 * @example
 * ```ts
 * await handlePaymentFailed(env.DB, {
 *   subscription: 'sub_xxx',
 *   metadata: { org_id: 'org-uuid' },
 * });
 * ```
 */
export async function handlePaymentFailed(
  db: D1Database,
  event: { subscription: string; metadata?: { org_id?: string } },
): Promise<void> {
  const orgId = event.metadata?.org_id;
  if (!orgId) return;

  await dbUpdate(
    db,
    'subscriptions',
    {
      status: 'past_due',
      last_payment_failed_at: new Date().toISOString(),
    },
    'org_id = ?',
    [orgId],
  );
}

/**
 * Get organisation entitlements based on subscription state.
 *
 * Looks up the current subscription for the org and returns the full
 * entitlements object. An org is considered `paid` only when both
 * `plan = 'paid'` **and** `status = 'active'`; all other states
 * fall back to the `free` tier.
 *
 * @param db    - The D1Database binding from `env.DB`.
 * @param orgId - Organisation UUID.
 * @returns Resolved entitlements for the org's current plan.
 *
 * @example
 * ```ts
 * const entitlements = await getOrgEntitlements(env.DB, orgId);
 * if (entitlements.customDomain) { ... }
 * ```
 */
export async function getOrgEntitlements(db: D1Database, orgId: string): Promise<Entitlements> {
  const sub = await dbQueryOne<{ plan: string; status: string }>(
    db,
    'SELECT plan, status FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
    [orgId],
  );

  if (!sub || sub.plan !== 'paid' || sub.status !== 'active') {
    return getEntitlements(orgId, 'free');
  }

  return getEntitlements(orgId, 'paid');
}

/**
 * Get full subscription details for an organisation.
 *
 * Returns the plan, status, Stripe identifiers, cancellation flag, and
 * current billing-period end date. Returns `null` when the org has no
 * active (non-deleted) subscription row.
 *
 * @param db    - The D1Database binding from `env.DB`.
 * @param orgId - Organisation UUID.
 * @returns Subscription summary or `null` if none exists.
 *
 * @example
 * ```ts
 * const sub = await getOrgSubscription(env.DB, orgId);
 * if (sub?.plan === 'paid') {
 *   console.warn(`Org ${orgId} is on the paid plan until ${sub.current_period_end}`);
 * }
 * ```
 */
export async function getOrgSubscription(
  db: D1Database,
  orgId: string,
): Promise<{
  plan: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
} | null> {
  const row = await dbQueryOne<{
    plan: string;
    status: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    cancel_at_period_end: number;
    current_period_end: string | null;
  }>(
    db,
    'SELECT plan, status, stripe_customer_id, stripe_subscription_id, cancel_at_period_end, current_period_end FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
    [orgId],
  );

  if (!row) return null;

  // Convert D1 integer boolean (0/1) back to JS boolean for the public API
  return {
    plan: row.plan,
    status: row.status,
    stripe_customer_id: row.stripe_customer_id,
    stripe_subscription_id: row.stripe_subscription_id,
    cancel_at_period_end: row.cancel_at_period_end === 1,
    current_period_end: row.current_period_end,
  };
}

/**
 * Create a Stripe Billing Portal session.
 *
 * Opens the customer-facing portal where users can update payment methods,
 * view invoices, or cancel their subscription. No database access required.
 *
 * @param env              - Worker environment containing `STRIPE_SECRET_KEY`.
 * @param stripeCustomerId - The Stripe customer ID (`cus_xxx`).
 * @param returnUrl        - URL the user returns to after leaving the portal.
 * @returns Object containing the portal session URL.
 *
 * @example
 * ```ts
 * const { portal_url } = await createBillingPortalSession(
 *   env, 'cus_xxx', 'https://example.com/settings',
 * );
 * ```
 */
export async function createBillingPortalSession(
  env: Env,
  stripeCustomerId: string,
  returnUrl: string,
): Promise<{ portal_url: string }> {
  const response = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      customer: stripeCustomerId,
      return_url: returnUrl,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw badRequest(`Failed to create billing portal: ${err}`);
  }

  const session = (await response.json()) as { url: string };
  return { portal_url: session.url };
}

/**
 * Call the optional external sale webhook with retry and exponential backoff.
 *
 * Sends a signed JSON payload to `SALE_WEBHOOK_URL` containing the sale
 * details. The signature is an HMAC-SHA256 hex digest in the
 * `X-Webhook-Signature` header, computed over the raw JSON body using
 * `SALE_WEBHOOK_SECRET`. Retries up to 3 times with exponential backoff
 * (1 s, 2 s).
 *
 * @param env     - Worker environment with `SALE_WEBHOOK_URL` and `SALE_WEBHOOK_SECRET`.
 * @param payload - Sale details including org, site, and Stripe identifiers.
 *
 * @example
 * ```ts
 * await callSaleWebhook(env, {
 *   org_id: 'org-uuid',
 *   site_id: 'site-uuid',
 *   stripe_customer_id: 'cus_xxx',
 *   stripe_subscription_id: 'sub_xxx',
 * });
 * ```
 */
async function callSaleWebhook(
  env: Env,
  payload: {
    org_id: string;
    site_id: string | null;
    stripe_customer_id: string;
    stripe_subscription_id: string;
  },
): Promise<void> {
  if (!env.SALE_WEBHOOK_URL || !env.SALE_WEBHOOK_SECRET) return;

  const body = JSON.stringify({
    ...payload,
    plan: 'paid',
    amount_cents: PRICING.MONTHLY_CENTS,
    currency: PRICING.CURRENCY,
    timestamp: new Date().toISOString(),
    request_id: crypto.randomUUID(),
    trace_id: crypto.randomUUID(),
  });

  const { hmacSha256 } = await import('@project-sites/shared');
  const signature = await hmacSha256(env.SALE_WEBHOOK_SECRET, body);

  // Retry with backoff
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(env.SALE_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
        },
        body,
      });

      if (response.ok) return;

      console.error(
        JSON.stringify({
          level: 'warn',
          service: 'billing',
          message: `Sale webhook attempt ${attempt + 1} failed: ${response.status}`,
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          level: 'warn',
          service: 'billing',
          message: `Sale webhook attempt ${attempt + 1} error`,
          error: err instanceof Error ? err.message : 'unknown',
        }),
      );
    }

    // Exponential backoff
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
}
