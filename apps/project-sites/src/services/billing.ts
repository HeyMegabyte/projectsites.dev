import { PRICING, type Entitlements, getEntitlements, badRequest } from '@project-sites/shared';
import type { SupabaseClient } from './db.js';
import { supabaseQuery } from './db.js';
import type { Env } from '../types/env.js';

/**
 * Get or create a Stripe customer for an org.
 */
export async function getOrCreateStripeCustomer(
  db: SupabaseClient,
  env: Env,
  orgId: string,
  email: string,
): Promise<{ stripe_customer_id: string }> {
  // Check if org already has a Stripe customer
  const result = await supabaseQuery<Array<{ id: string; stripe_customer_id: string }>>(
    db,
    'subscriptions',
    {
      query: `org_id=eq.${orgId}&deleted_at=is.null&select=id,stripe_customer_id`,
    },
  );

  if (result.data?.[0]?.stripe_customer_id) {
    return { stripe_customer_id: result.data[0].stripe_customer_id };
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
      metadata: JSON.stringify({ org_id: orgId }),
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw badRequest(`Failed to create Stripe customer: ${err}`);
  }

  const customer = (await response.json()) as { id: string };

  // Upsert subscription record
  await supabaseQuery(db, 'subscriptions', {
    method: 'POST',
    body: {
      id: crypto.randomUUID(),
      org_id: orgId,
      stripe_customer_id: customer.id,
      stripe_subscription_id: null,
      plan: 'free',
      status: 'active',
      cancel_at_period_end: false,
      retention_offer_applied: false,
      dunning_stage: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    },
  });

  return { stripe_customer_id: customer.id };
}

/**
 * Create a Stripe Checkout session optimized for Stripe Link.
 */
export async function createCheckoutSession(
  db: SupabaseClient,
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
 * Handle checkout.session.completed event.
 * Upserts subscription and applies entitlements.
 */
export async function handleCheckoutCompleted(
  db: SupabaseClient,
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

  await supabaseQuery(db, 'subscriptions', {
    method: 'PATCH',
    query: `org_id=eq.${orgId}`,
    body: {
      stripe_subscription_id: event.subscription,
      plan: 'paid',
      status: 'active',
      dunning_stage: 0,
      last_payment_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });

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
 * Handle subscription.updated event.
 */
export async function handleSubscriptionUpdated(
  db: SupabaseClient,
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

  await supabaseQuery(db, 'subscriptions', {
    method: 'PATCH',
    query: `org_id=eq.${orgId}`,
    body: {
      status: event.status,
      cancel_at_period_end: event.cancel_at_period_end,
      current_period_start: new Date(event.current_period_start * 1000).toISOString(),
      current_period_end: new Date(event.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
}

/**
 * Handle subscription.deleted event (cancellation).
 */
export async function handleSubscriptionDeleted(
  db: SupabaseClient,
  event: { id: string; metadata?: { org_id?: string } },
): Promise<void> {
  const orgId = event.metadata?.org_id;
  if (!orgId) return;

  await supabaseQuery(db, 'subscriptions', {
    method: 'PATCH',
    query: `org_id=eq.${orgId}`,
    body: {
      plan: 'free',
      status: 'canceled',
      stripe_subscription_id: null,
      updated_at: new Date().toISOString(),
    },
  });
}

/**
 * Handle invoice.payment_failed event.
 */
export async function handlePaymentFailed(
  db: SupabaseClient,
  event: { subscription: string; metadata?: { org_id?: string } },
): Promise<void> {
  const orgId = event.metadata?.org_id;
  if (!orgId) return;

  await supabaseQuery(db, 'subscriptions', {
    method: 'PATCH',
    query: `org_id=eq.${orgId}`,
    body: {
      status: 'past_due',
      last_payment_failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  });
}

/**
 * Get org entitlements based on subscription state.
 */
export async function getOrgEntitlements(db: SupabaseClient, orgId: string): Promise<Entitlements> {
  const result = await supabaseQuery<Array<{ plan: string; status: string }>>(db, 'subscriptions', {
    query: `org_id=eq.${orgId}&deleted_at=is.null&select=plan,status`,
  });

  const sub = result.data?.[0];
  if (!sub || sub.plan !== 'paid' || sub.status !== 'active') {
    return getEntitlements(orgId, 'free');
  }

  return getEntitlements(orgId, 'paid');
}

/**
 * Get org subscription details.
 */
export async function getOrgSubscription(
  db: SupabaseClient,
  orgId: string,
): Promise<{
  plan: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
} | null> {
  const result = await supabaseQuery<
    Array<{
      plan: string;
      status: string;
      stripe_customer_id: string;
      stripe_subscription_id: string | null;
      cancel_at_period_end: boolean;
      current_period_end: string | null;
    }>
  >(db, 'subscriptions', {
    query: `org_id=eq.${orgId}&deleted_at=is.null&select=plan,status,stripe_customer_id,stripe_subscription_id,cancel_at_period_end,current_period_end`,
  });

  return result.data?.[0] ?? null;
}

/**
 * Create a Stripe billing portal session.
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
 * Call the optional external sale webhook.
 * Idempotent, retried with backoff.
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
