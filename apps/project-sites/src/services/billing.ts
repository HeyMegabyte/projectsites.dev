/**
 * Billing service
 * Stripe integration with comprehensive error handling, entitlements, dunning
 */

import type { AppContext } from '../types';
import {
  generateUuid,
  NotFoundError,
  ExternalServiceError,
  ValidationError,
  PRICING,
  DUNNING,
  SUBSCRIPTION_STATES,
  AUDIT_ACTIONS,
  type SubscriptionState,
} from '@project-sites/shared';
import type Stripe from 'stripe';
import { createLogger, type Logger } from '../lib/logger';
import { loadConfig, loadStripeConfig, type AppConfig } from '../lib/config';

// ============================================================================
// TYPES
// ============================================================================

export interface CheckoutParams {
  org_id: string;
  site_id: string;
  success_url: string;
  cancel_url: string;
  customer_email?: string;
}

export interface CheckoutResult {
  checkout_url: string;
  session_id: string;
}

export interface PortalParams {
  org_id: string;
  return_url: string;
}

export interface PortalResult {
  portal_url: string;
}

export interface SubscriptionRecord {
  id: string;
  org_id: string;
  stripe_subscription_id: string;
  stripe_customer_id: string;
  stripe_price_id: string;
  state: SubscriptionState;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  monthly_amount_cents: number;
  currency: string;
}

// ============================================================================
// BILLING SERVICE
// ============================================================================

export class BillingService {
  private readonly logger: Logger;
  private readonly config: AppConfig;

  constructor(private readonly c: AppContext) {
    this.config = loadConfig(c.env);
    this.logger = createLogger(this.config, {
      service: 'billing',
      request_id: c.get('request_id'),
      trace_id: c.get('trace_id'),
    });
  }

  private get db() {
    const db = this.c.get('db');
    if (!db) {
      throw new Error('Database connection not initialized');
    }
    return db;
  }

  private get stripe() {
    const stripe = this.c.get('stripe');
    if (!stripe) {
      throw new Error('Stripe client not initialized');
    }
    return stripe;
  }

  private get env() {
    return this.c.env;
  }

  // ============================================================================
  // CUSTOMER MANAGEMENT
  // ============================================================================

  /**
   * Get or create a Stripe customer for an organization
   * @throws {NotFoundError} If the organization is not found
   * @throws {ExternalServiceError} If Stripe API call fails
   */
  async getOrCreateStripeCustomer(orgId: string, email?: string | null): Promise<string> {
    if (!orgId) {
      throw new ValidationError('Organization ID is required');
    }

    this.logger.debug('Getting or creating Stripe customer', { org_id: orgId });

    try {
      // Check if org already has a Stripe customer
      const { data: org, error: orgError } = await this.db
        .from('orgs')
        .select('stripe_customer_id, name')
        .eq('id', orgId)
        .single();

      if (orgError) {
        this.logger.error('Failed to fetch organization', orgError, { org_id: orgId });
        throw new NotFoundError('Organization');
      }

      if (!org) {
        throw new NotFoundError('Organization');
      }

      if (org.stripe_customer_id) {
        this.logger.debug('Found existing Stripe customer', {
          org_id: orgId,
          customer_id: org.stripe_customer_id,
        });
        return org.stripe_customer_id;
      }

      // Create new Stripe customer
      const customerParams: Stripe.CustomerCreateParams = {
        metadata: { org_id: orgId },
      };

      if (email) {
        customerParams.email = email;
      }

      if (org.name) {
        customerParams.name = org.name;
      }

      this.logger.info('Creating new Stripe customer', { org_id: orgId });

      const customer = await this.stripe.customers.create(customerParams);

      // Save customer ID
      const { error: updateError } = await this.db
        .from('orgs')
        .update({
          stripe_customer_id: customer.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', orgId);

      if (updateError) {
        this.logger.error('Failed to save Stripe customer ID', updateError, {
          org_id: orgId,
          customer_id: customer.id,
        });
        // Don't throw - the customer was created successfully
      }

      this.logger.info('Created Stripe customer', {
        org_id: orgId,
        customer_id: customer.id,
      });

      return customer.id;
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }

      this.logger.error('Failed to get or create Stripe customer', error, { org_id: orgId });

      if (this.isStripeError(error)) {
        throw new ExternalServiceError('Stripe', this.getStripeErrorMessage(error));
      }

      throw new ExternalServiceError('Stripe', 'Failed to create customer');
    }
  }

  // ============================================================================
  // CHECKOUT
  // ============================================================================

  /**
   * Create a Stripe Checkout session for subscription
   * @throws {ValidationError} If required parameters are missing
   * @throws {ExternalServiceError} If Stripe API call fails
   */
  async createCheckoutSession(params: CheckoutParams): Promise<CheckoutResult> {
    // Validate params
    if (!params.org_id) {
      throw new ValidationError('Organization ID is required');
    }
    if (!params.site_id) {
      throw new ValidationError('Site ID is required');
    }
    if (!params.success_url) {
      throw new ValidationError('Success URL is required');
    }
    if (!params.cancel_url) {
      throw new ValidationError('Cancel URL is required');
    }

    this.logger.info('Creating checkout session', {
      org_id: params.org_id,
      site_id: params.site_id,
    });

    try {
      const customerId = await this.getOrCreateStripeCustomer(
        params.org_id,
        params.customer_email
      );

      // Create Stripe Checkout session (optimized for Stripe Link)
      const sessionParams: Stripe.Checkout.SessionCreateParams = {
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card', 'link'],
        line_items: [
          {
            price_data: {
              currency: PRICING.CURRENCY,
              unit_amount: PRICING.MONTHLY_CENTS,
              recurring: { interval: 'month' },
              product_data: {
                name: 'Project Sites Pro',
                description: 'Remove top bar + custom domains',
              },
            },
            quantity: 1,
          },
        ],
        success_url: params.success_url,
        cancel_url: params.cancel_url,
        metadata: {
          org_id: params.org_id,
          site_id: params.site_id,
        },
        subscription_data: {
          metadata: {
            org_id: params.org_id,
            site_id: params.site_id,
          },
        },
        payment_method_options: {
          link: { persistent_token: undefined },
        },
        allow_promotion_codes: true,
      };

      const session = await this.stripe.checkout.sessions.create(sessionParams);

      if (!session.url) {
        throw new ExternalServiceError('Stripe', 'Checkout session URL not generated');
      }

      // Log audit event
      await this.logAudit(
        params.org_id,
        AUDIT_ACTIONS.BILLING_CHECKOUT_STARTED,
        'checkout',
        session.id,
        { site_id: params.site_id }
      );

      this.logger.info('Created checkout session', {
        org_id: params.org_id,
        session_id: session.id,
      });

      return {
        checkout_url: session.url,
        session_id: session.id,
      };
    } catch (error) {
      if (error instanceof ValidationError || error instanceof NotFoundError || error instanceof ExternalServiceError) {
        throw error;
      }

      this.logger.error('Failed to create checkout session', error, {
        org_id: params.org_id,
        site_id: params.site_id,
      });

      if (this.isStripeError(error)) {
        throw new ExternalServiceError('Stripe', this.getStripeErrorMessage(error));
      }

      throw new ExternalServiceError('Stripe', 'Failed to create checkout session');
    }
  }

  // ============================================================================
  // BILLING PORTAL
  // ============================================================================

  /**
   * Create a Stripe Billing Portal session
   * @throws {NotFoundError} If the organization has no billing account
   * @throws {ExternalServiceError} If Stripe API call fails
   */
  async createBillingPortalSession(params: PortalParams): Promise<PortalResult> {
    if (!params.org_id) {
      throw new ValidationError('Organization ID is required');
    }
    if (!params.return_url) {
      throw new ValidationError('Return URL is required');
    }

    this.logger.debug('Creating billing portal session', { org_id: params.org_id });

    try {
      // Get Stripe customer ID
      const { data: org, error: orgError } = await this.db
        .from('orgs')
        .select('stripe_customer_id')
        .eq('id', params.org_id)
        .single();

      if (orgError || !org) {
        throw new NotFoundError('Organization');
      }

      if (!org.stripe_customer_id) {
        throw new NotFoundError('Billing account');
      }

      const session = await this.stripe.billingPortal.sessions.create({
        customer: org.stripe_customer_id,
        return_url: params.return_url,
      });

      this.logger.info('Created billing portal session', {
        org_id: params.org_id,
        session_id: session.id,
      });

      return { portal_url: session.url };
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }

      this.logger.error('Failed to create billing portal session', error, {
        org_id: params.org_id,
      });

      if (this.isStripeError(error)) {
        throw new ExternalServiceError('Stripe', this.getStripeErrorMessage(error));
      }

      throw new ExternalServiceError('Stripe', 'Failed to create billing portal session');
    }
  }

  // ============================================================================
  // SUBSCRIPTION MANAGEMENT
  // ============================================================================

  /**
   * Get the active subscription for an organization
   */
  async getOrgSubscription(orgId: string): Promise<SubscriptionRecord | null> {
    if (!orgId) {
      throw new ValidationError('Organization ID is required');
    }

    try {
      const { data: subscription, error } = await this.db
        .from('subscriptions')
        .select('*')
        .eq('org_id', orgId)
        .is('ended_at', null)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows returned
        this.logger.error('Failed to fetch subscription', error, { org_id: orgId });
        return null;
      }

      return subscription as SubscriptionRecord | null;
    } catch (error) {
      this.logger.error('Failed to fetch subscription', error, { org_id: orgId });
      return null;
    }
  }

  /**
   * Cancel a subscription at period end
   * @throws {NotFoundError} If no active subscription found
   * @throws {ExternalServiceError} If Stripe API call fails
   */
  async cancelSubscription(orgId: string, reason?: string): Promise<void> {
    if (!orgId) {
      throw new ValidationError('Organization ID is required');
    }

    this.logger.info('Canceling subscription', { org_id: orgId, reason });

    try {
      const { data: subscription, error: subError } = await this.db
        .from('subscriptions')
        .select('stripe_subscription_id')
        .eq('org_id', orgId)
        .is('ended_at', null)
        .single();

      if (subError || !subscription?.stripe_subscription_id) {
        throw new NotFoundError('Subscription');
      }

      // Cancel at period end (not immediately)
      await this.stripe.subscriptions.update(subscription.stripe_subscription_id, {
        cancel_at_period_end: true,
        metadata: { cancel_reason: reason ?? 'user_requested' },
      });

      // Update local record
      const { error: updateError } = await this.db
        .from('subscriptions')
        .update({
          cancel_at_period_end: true,
          updated_at: new Date().toISOString(),
        })
        .eq('org_id', orgId);

      if (updateError) {
        this.logger.error('Failed to update local subscription record', updateError, {
          org_id: orgId,
        });
      }

      await this.logAudit(
        orgId,
        AUDIT_ACTIONS.BILLING_SUBSCRIPTION_CANCELED,
        'subscription',
        subscription.stripe_subscription_id,
        { reason }
      );

      this.logger.info('Subscription canceled', {
        org_id: orgId,
        subscription_id: subscription.stripe_subscription_id,
      });
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError) {
        throw error;
      }

      this.logger.error('Failed to cancel subscription', error, { org_id: orgId });

      if (this.isStripeError(error)) {
        throw new ExternalServiceError('Stripe', this.getStripeErrorMessage(error));
      }

      throw new ExternalServiceError('Stripe', 'Failed to cancel subscription');
    }
  }

  /**
   * Apply retention offer to a subscription
   * @throws {NotFoundError} If no active subscription found
   * @throws {ExternalServiceError} If Stripe API call fails
   */
  async applyRetentionOffer(orgId: string): Promise<void> {
    if (!orgId) {
      throw new ValidationError('Organization ID is required');
    }

    this.logger.info('Applying retention offer', { org_id: orgId });

    try {
      const { data: subscription, error: subError } = await this.db
        .from('subscriptions')
        .select('stripe_subscription_id')
        .eq('org_id', orgId)
        .is('ended_at', null)
        .single();

      if (subError || !subscription?.stripe_subscription_id) {
        throw new NotFoundError('Subscription');
      }

      // Get current subscription from Stripe
      const stripeSub = await this.stripe.subscriptions.retrieve(
        subscription.stripe_subscription_id
      );

      const itemId = stripeSub.items.data[0]?.id;

      if (!itemId) {
        throw new ExternalServiceError('Stripe', 'No subscription items found');
      }

      // Update to retention price
      await this.stripe.subscriptions.update(subscription.stripe_subscription_id, {
        cancel_at_period_end: false,
        items: [
          {
            id: itemId,
            price_data: {
              currency: PRICING.CURRENCY,
              unit_amount: PRICING.RETENTION_MONTHLY_CENTS,
              recurring: { interval: 'month' },
              product_data: {
                name: 'Project Sites Pro (Retention Offer)',
              },
            },
          },
        ],
        metadata: {
          retention_offer_applied: 'true',
          retention_offer_expires: new Date(
            Date.now() + PRICING.RETENTION_DURATION_MONTHS * 30 * 24 * 60 * 60 * 1000
          ).toISOString(),
        },
      });

      // Update local record
      const { error: updateError } = await this.db
        .from('subscriptions')
        .update({
          monthly_amount_cents: PRICING.RETENTION_MONTHLY_CENTS,
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        })
        .eq('org_id', orgId);

      if (updateError) {
        this.logger.error('Failed to update local subscription record', updateError, {
          org_id: orgId,
        });
      }

      this.logger.info('Applied retention offer', {
        org_id: orgId,
        new_price_cents: PRICING.RETENTION_MONTHLY_CENTS,
      });
    } catch (error) {
      if (error instanceof NotFoundError || error instanceof ValidationError || error instanceof ExternalServiceError) {
        throw error;
      }

      this.logger.error('Failed to apply retention offer', error, { org_id: orgId });

      if (this.isStripeError(error)) {
        throw new ExternalServiceError('Stripe', this.getStripeErrorMessage(error));
      }

      throw new ExternalServiceError('Stripe', 'Failed to apply retention offer');
    }
  }

  // ============================================================================
  // WEBHOOK HANDLERS
  // ============================================================================

  /**
   * Handle Stripe checkout.session.completed webhook
   */
  async handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const orgId = session.metadata?.org_id;
    const siteId = session.metadata?.site_id;

    this.logger.info('Processing checkout completed', {
      session_id: session.id,
      org_id: orgId,
      site_id: siteId,
    });

    if (!orgId) {
      this.logger.error('Missing org_id in checkout session metadata', undefined, {
        session_id: session.id,
      });
      return;
    }

    if (!session.subscription) {
      this.logger.error('Missing subscription in checkout session', undefined, {
        session_id: session.id,
      });
      return;
    }

    try {
      // Get subscription details
      const subscription = await this.stripe.subscriptions.retrieve(
        typeof session.subscription === 'string' ? session.subscription : session.subscription.id
      );

      // Create or update subscription record
      await this.upsertSubscription(orgId, subscription);

      // Log audit event
      await this.logAudit(
        orgId,
        AUDIT_ACTIONS.BILLING_SUBSCRIPTION_CREATED,
        'subscription',
        subscription.id,
        { site_id: siteId }
      );

      // Call sale webhook if configured
      if (this.env.SALE_WEBHOOK_URL) {
        await this.callSaleWebhook({
          site_id: siteId,
          org_id: orgId,
          stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id,
          stripe_subscription_id: subscription.id,
          plan: 'pro',
          amount_cents: PRICING.MONTHLY_CENTS,
          currency: PRICING.CURRENCY,
          timestamp: new Date().toISOString(),
          request_id: this.c.get('request_id'),
          trace_id: this.c.get('trace_id'),
        });
      }

      this.logger.info('Checkout completed processed successfully', {
        org_id: orgId,
        subscription_id: subscription.id,
      });
    } catch (error) {
      this.logger.error('Failed to process checkout completed', error, {
        session_id: session.id,
        org_id: orgId,
      });
      throw error;
    }
  }

  /**
   * Handle Stripe customer.subscription.updated webhook
   */
  async handleSubscriptionUpdated(subscription: Stripe.Subscription): Promise<void> {
    this.logger.info('Processing subscription updated', {
      subscription_id: subscription.id,
    });

    try {
      let orgId = subscription.metadata?.org_id;

      if (!orgId) {
        // Try to find by customer ID
        const customerId = typeof subscription.customer === 'string'
          ? subscription.customer
          : subscription.customer.id;

        const { data: org, error } = await this.db
          .from('orgs')
          .select('id')
          .eq('stripe_customer_id', customerId)
          .single();

        if (error || !org) {
          this.logger.error('Could not find org for subscription', undefined, {
            subscription_id: subscription.id,
            customer_id: customerId,
          });
          return;
        }

        orgId = org.id;
      }

      await this.upsertSubscription(orgId, subscription);
      await this.logAudit(
        orgId,
        AUDIT_ACTIONS.BILLING_SUBSCRIPTION_UPDATED,
        'subscription',
        subscription.id,
        {}
      );

      this.logger.info('Subscription updated processed', {
        org_id: orgId,
        subscription_id: subscription.id,
      });
    } catch (error) {
      this.logger.error('Failed to process subscription updated', error, {
        subscription_id: subscription.id,
      });
      throw error;
    }
  }

  /**
   * Handle Stripe customer.subscription.deleted webhook
   */
  async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const orgId = subscription.metadata?.org_id;

    this.logger.info('Processing subscription deleted', {
      subscription_id: subscription.id,
      org_id: orgId,
    });

    try {
      // Mark subscription as ended
      const { error } = await this.db
        .from('subscriptions')
        .update({
          state: SUBSCRIPTION_STATES.CANCELED,
          ended_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscription.id);

      if (error) {
        this.logger.error('Failed to mark subscription as ended', error, {
          subscription_id: subscription.id,
        });
      }

      if (orgId) {
        await this.logAudit(
          orgId,
          AUDIT_ACTIONS.BILLING_SUBSCRIPTION_CANCELED,
          'subscription',
          subscription.id,
          {}
        );
      }

      this.logger.info('Subscription deleted processed', {
        subscription_id: subscription.id,
      });
    } catch (error) {
      this.logger.error('Failed to process subscription deleted', error, {
        subscription_id: subscription.id,
      });
      throw error;
    }
  }

  /**
   * Handle Stripe invoice.paid webhook
   */
  async handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id;

    if (!subscriptionId) {
      this.logger.debug('Invoice has no subscription, skipping', {
        invoice_id: invoice.id,
      });
      return;
    }

    this.logger.info('Processing invoice paid', {
      invoice_id: invoice.id,
      subscription_id: subscriptionId,
    });

    try {
      // Find org
      const { data: subscription, error } = await this.db
        .from('subscriptions')
        .select('org_id')
        .eq('stripe_subscription_id', subscriptionId)
        .single();

      if (error || !subscription) {
        this.logger.warn('Could not find subscription for invoice', {
          invoice_id: invoice.id,
          subscription_id: subscriptionId,
        });
        return;
      }

      // Store invoice
      const { error: upsertError } = await this.db.from('invoices').upsert({
        id: generateUuid(),
        org_id: subscription.org_id,
        stripe_invoice_id: invoice.id,
        stripe_subscription_id: subscriptionId,
        amount_due: invoice.amount_due,
        amount_paid: invoice.amount_paid,
        currency: invoice.currency,
        status: invoice.status,
        due_date: invoice.due_date
          ? new Date(invoice.due_date * 1000).toISOString()
          : null,
        paid_at: invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
          : new Date().toISOString(),
        hosted_invoice_url: invoice.hosted_invoice_url ?? null,
        invoice_pdf: invoice.invoice_pdf ?? null,
      });

      if (upsertError) {
        this.logger.error('Failed to upsert invoice', upsertError, {
          invoice_id: invoice.id,
        });
      }

      await this.logAudit(
        subscription.org_id,
        AUDIT_ACTIONS.BILLING_PAYMENT_SUCCEEDED,
        'invoice',
        invoice.id,
        { amount: invoice.amount_paid }
      );

      this.logger.info('Invoice paid processed', {
        invoice_id: invoice.id,
        org_id: subscription.org_id,
      });
    } catch (error) {
      this.logger.error('Failed to process invoice paid', error, {
        invoice_id: invoice.id,
      });
      throw error;
    }
  }

  /**
   * Handle Stripe invoice.payment_failed webhook
   */
  async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const subscriptionId = typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id;

    if (!subscriptionId) {
      this.logger.debug('Invoice has no subscription, skipping', {
        invoice_id: invoice.id,
      });
      return;
    }

    this.logger.warn('Processing payment failed', {
      invoice_id: invoice.id,
      subscription_id: subscriptionId,
    });

    try {
      // Find org
      const { data: subscription, error } = await this.db
        .from('subscriptions')
        .select('org_id')
        .eq('stripe_subscription_id', subscriptionId)
        .single();

      if (error || !subscription) {
        this.logger.warn('Could not find subscription for failed invoice', {
          invoice_id: invoice.id,
          subscription_id: subscriptionId,
        });
        return;
      }

      // Update subscription state
      const { error: updateError } = await this.db
        .from('subscriptions')
        .update({
          state: SUBSCRIPTION_STATES.PAST_DUE,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', subscriptionId);

      if (updateError) {
        this.logger.error('Failed to update subscription state', updateError, {
          subscription_id: subscriptionId,
        });
      }

      await this.logAudit(
        subscription.org_id,
        AUDIT_ACTIONS.BILLING_PAYMENT_FAILED,
        'invoice',
        invoice.id,
        { amount: invoice.amount_due }
      );

      // Queue dunning notification
      try {
        await this.c.env.WORKFLOW_QUEUE.send({
          type: 'dunning_notification',
          payload: {
            org_id: subscription.org_id,
            invoice_id: invoice.id,
            amount_due: invoice.amount_due,
          },
          metadata: {
            request_id: this.c.get('request_id'),
            trace_id: this.c.get('trace_id'),
            attempt: 1,
            max_attempts: 3,
            scheduled_at: new Date().toISOString(),
          },
        });
      } catch (queueError) {
        this.logger.error('Failed to queue dunning notification', queueError, {
          org_id: subscription.org_id,
        });
      }

      this.logger.warn('Payment failed processed', {
        invoice_id: invoice.id,
        org_id: subscription.org_id,
      });
    } catch (error) {
      this.logger.error('Failed to process payment failed', error, {
        invoice_id: invoice.id,
      });
      throw error;
    }
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Upsert subscription record from Stripe subscription object
   */
  private async upsertSubscription(orgId: string, subscription: Stripe.Subscription): Promise<void> {
    const item = subscription.items.data[0];

    if (!item) {
      this.logger.warn('Subscription has no items', {
        subscription_id: subscription.id,
      });
    }

    const customerId = typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

    const { error } = await this.db.from('subscriptions').upsert(
      {
        id: generateUuid(),
        org_id: orgId,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: customerId,
        stripe_price_id: item?.price.id ?? '',
        state: this.mapStripeStatus(subscription.status),
        current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
        canceled_at: subscription.canceled_at
          ? new Date(subscription.canceled_at * 1000).toISOString()
          : null,
        monthly_amount_cents: item?.price.unit_amount ?? PRICING.MONTHLY_CENTS,
        currency: item?.price.currency ?? PRICING.CURRENCY,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'stripe_subscription_id',
      }
    );

    if (error) {
      this.logger.error('Failed to upsert subscription', error, {
        org_id: orgId,
        subscription_id: subscription.id,
      });
      throw error;
    }
  }

  /**
   * Map Stripe subscription status to our internal state
   */
  private mapStripeStatus(status: Stripe.Subscription.Status): SubscriptionState {
    const mapping: Record<Stripe.Subscription.Status, SubscriptionState> = {
      active: 'active',
      past_due: 'past_due',
      canceled: 'canceled',
      unpaid: 'unpaid',
      trialing: 'trialing',
      paused: 'paused',
      incomplete: 'unpaid',
      incomplete_expired: 'canceled',
    };
    return mapping[status] ?? 'unpaid';
  }

  /**
   * Call the configured sale webhook
   */
  private async callSaleWebhook(payload: Record<string, unknown>): Promise<void> {
    if (!this.env.SALE_WEBHOOK_URL) {
      return;
    }

    try {
      const response = await fetch(this.env.SALE_WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': this.env.SALE_WEBHOOK_SECRET ?? '',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        this.logger.warn('Sale webhook returned non-OK status', {
          status: response.status,
          statusText: response.statusText,
        });
      }
    } catch (error) {
      this.logger.error('Sale webhook failed', error);
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Log an audit event
   */
  private async logAudit(
    orgId: string,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    try {
      const { error } = await this.db.from('audit_logs').insert({
        id: generateUuid(),
        org_id: orgId,
        actor_type: 'system',
        action,
        target_type: targetType,
        target_id: targetId,
        metadata,
        request_id: this.c.get('request_id'),
      });

      if (error) {
        this.logger.error('Failed to log audit event', error, {
          action,
          target_type: targetType,
          target_id: targetId,
        });
      }
    } catch (error) {
      this.logger.error('Failed to log audit event', error, {
        action,
        target_type: targetType,
        target_id: targetId,
      });
      // Don't throw - audit logging should not break the main operation
    }
  }

  /**
   * Check if an error is a Stripe error
   */
  private isStripeError(error: unknown): error is { type: string; message?: string; code?: string } {
    return (
      error !== null &&
      typeof error === 'object' &&
      'type' in error &&
      typeof (error as { type: string }).type === 'string' &&
      (error as { type: string }).type.startsWith('Stripe')
    );
  }

  /**
   * Get a human-readable error message from a Stripe error
   */
  private getStripeErrorMessage(error: { type: string; message?: string; code?: string }): string {
    if (error.message) {
      return error.message;
    }

    switch (error.type) {
      case 'StripeCardError':
        return 'Card was declined';
      case 'StripeRateLimitError':
        return 'Too many requests, please try again';
      case 'StripeInvalidRequestError':
        return 'Invalid payment request';
      case 'StripeAuthenticationError':
        return 'Payment service configuration error';
      case 'StripeAPIConnectionError':
        return 'Could not connect to payment service';
      default:
        return 'Payment service error';
    }
  }
}
