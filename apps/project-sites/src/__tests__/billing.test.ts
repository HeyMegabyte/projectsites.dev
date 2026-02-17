jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('@project-sites/shared', () => {
  const actual = jest.requireActual('@project-sites/shared');
  return {
    ...actual,
    hmacSha256: jest.fn().mockResolvedValue('mock-signature'),
  };
});

import { dbQueryOne, dbInsert, dbUpdate } from '../services/db.js';
import {
  getOrCreateStripeCustomer,
  createCheckoutSession,
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handlePaymentFailed,
  getOrgEntitlements,
  getOrgSubscription,
  createBillingPortalSession,
} from '../services/billing.js';

const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;

const mockEnv = {
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
  SALE_WEBHOOK_URL: undefined,
  SALE_WEBHOOK_SECRET: undefined,
} as any;

const mockDb = {} as D1Database;

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// getOrCreateStripeCustomer
// ---------------------------------------------------------------------------
describe('getOrCreateStripeCustomer', () => {
  it('returns existing customer ID when subscription has one', async () => {
    mockQueryOne.mockResolvedValueOnce({ id: 'sub_1', stripe_customer_id: 'cus_existing' });

    const result = await getOrCreateStripeCustomer(mockDb, mockEnv, 'org_1', 'a@b.com');

    expect(result).toEqual({ stripe_customer_id: 'cus_existing' });
    expect(mockQueryOne).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('creates new Stripe customer when none exists', async () => {
    mockQueryOne.mockResolvedValueOnce(null);
    mockInsert.mockResolvedValueOnce({ error: null });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cus_new' }),
      text: async () => '',
    });

    const result = await getOrCreateStripeCustomer(mockDb, mockEnv, 'org_1', 'a@b.com');

    expect(result).toEqual({ stripe_customer_id: 'cus_new' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/customers',
      expect.objectContaining({ method: 'POST' }),
    );
    // Should insert subscription record
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockInsert).toHaveBeenCalledWith(
      mockDb,
      'subscriptions',
      expect.objectContaining({
        org_id: 'org_1',
        stripe_customer_id: 'cus_new',
        plan: 'free',
        status: 'active',
      }),
    );
  });

  it('throws on Stripe API failure', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
      text: async () => 'Stripe error',
    });

    await expect(getOrCreateStripeCustomer(mockDb, mockEnv, 'org_1', 'a@b.com')).rejects.toThrow(
      'Failed to create Stripe customer',
    );
  });
});

// ---------------------------------------------------------------------------
// createCheckoutSession
// ---------------------------------------------------------------------------
describe('createCheckoutSession', () => {
  const opts = {
    orgId: 'org_1',
    customerEmail: 'a@b.com',
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  };

  function mockExistingCustomer() {
    mockQueryOne.mockResolvedValueOnce({ id: 'sub_1', stripe_customer_id: 'cus_existing' });
  }

  it('returns checkout_url and session_id on success', async () => {
    mockExistingCustomer();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cs_123', url: 'https://checkout.stripe.com/cs_123' }),
      text: async () => '',
    });

    const result = await createCheckoutSession(mockDb, mockEnv, opts);

    expect(result).toEqual({
      checkout_url: 'https://checkout.stripe.com/cs_123',
      session_id: 'cs_123',
    });
  });

  it('includes org_id in metadata', async () => {
    mockExistingCustomer();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cs_123', url: 'https://checkout.stripe.com/cs_123' }),
      text: async () => '',
    });

    await createCheckoutSession(mockDb, mockEnv, opts);

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = fetchCall[1].body as URLSearchParams;
    expect(body.get('metadata[org_id]')).toBe('org_1');
  });

  it('throws on Stripe API failure', async () => {
    mockExistingCustomer();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
      text: async () => 'Checkout error',
    });

    await expect(createCheckoutSession(mockDb, mockEnv, opts)).rejects.toThrow(
      'Failed to create Stripe checkout',
    );
  });
});

// ---------------------------------------------------------------------------
// handleCheckoutCompleted
// ---------------------------------------------------------------------------
describe('handleCheckoutCompleted', () => {
  it('updates subscription to paid/active', async () => {
    mockUpdate.mockResolvedValueOnce({ error: null, changes: 1 });

    await handleCheckoutCompleted(mockDb, mockEnv, {
      customer: 'cus_1',
      subscription: 'sub_1',
      metadata: { org_id: 'org_1' },
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'subscriptions',
      expect.objectContaining({
        plan: 'paid',
        status: 'active',
        stripe_subscription_id: 'sub_1',
        dunning_stage: 0,
      }),
      'org_id = ?',
      ['org_1'],
    );
  });

  it('throws badRequest when org_id missing from metadata', async () => {
    await expect(
      handleCheckoutCompleted(mockDb, mockEnv, {
        customer: 'cus_1',
        subscription: 'sub_1',
        metadata: {},
      }),
    ).rejects.toThrow('Missing org_id in checkout metadata');
  });

  it('calls sale webhook when URL configured', async () => {
    const envWithWebhook = {
      ...mockEnv,
      SALE_WEBHOOK_URL: 'https://hooks.example.com/sale',
      SALE_WEBHOOK_SECRET: 'whsec_test',
    };

    mockUpdate.mockResolvedValueOnce({ error: null, changes: 1 });

    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true });

    await handleCheckoutCompleted(mockDb, envWithWebhook, {
      customer: 'cus_1',
      subscription: 'sub_1',
      metadata: { org_id: 'org_1', site_id: 'site_1' },
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://hooks.example.com/sale',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Webhook-Signature': 'mock-signature',
        }),
      }),
    );

    // Verify the body contains expected fields
    const webhookCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(webhookCall[1].body);
    expect(body.org_id).toBe('org_1');
    expect(body.site_id).toBe('site_1');
    expect(body.stripe_customer_id).toBe('cus_1');
    expect(body.stripe_subscription_id).toBe('sub_1');
    expect(body.plan).toBe('paid');
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionUpdated
// ---------------------------------------------------------------------------
describe('handleSubscriptionUpdated', () => {
  it('updates subscription status and period dates', async () => {
    mockUpdate.mockResolvedValueOnce({ error: null, changes: 1 });

    const periodStart = 1700000000;
    const periodEnd = 1702592000;

    await handleSubscriptionUpdated(mockDb, {
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: false,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      metadata: { org_id: 'org_1' },
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'subscriptions',
      expect.objectContaining({
        status: 'active',
        cancel_at_period_end: 0,
        current_period_start: new Date(periodStart * 1000).toISOString(),
        current_period_end: new Date(periodEnd * 1000).toISOString(),
      }),
      'org_id = ?',
      ['org_1'],
    );
  });

  it('does nothing when org_id missing', async () => {
    const result = await handleSubscriptionUpdated(mockDb, {
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: false,
      current_period_start: 1700000000,
      current_period_end: 1702592000,
      metadata: {},
    });

    expect(result).toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('passes cancel_at_period_end correctly', async () => {
    mockUpdate.mockResolvedValueOnce({ error: null, changes: 1 });

    await handleSubscriptionUpdated(mockDb, {
      id: 'sub_1',
      status: 'active',
      cancel_at_period_end: true,
      current_period_start: 1700000000,
      current_period_end: 1702592000,
      metadata: { org_id: 'org_1' },
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'subscriptions',
      expect.objectContaining({
        cancel_at_period_end: 1,
      }),
      'org_id = ?',
      ['org_1'],
    );
  });
});

// ---------------------------------------------------------------------------
// handleSubscriptionDeleted
// ---------------------------------------------------------------------------
describe('handleSubscriptionDeleted', () => {
  it('sets plan=free, status=canceled', async () => {
    mockUpdate.mockResolvedValueOnce({ error: null, changes: 1 });

    await handleSubscriptionDeleted(mockDb, {
      id: 'sub_1',
      metadata: { org_id: 'org_1' },
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'subscriptions',
      expect.objectContaining({
        plan: 'free',
        status: 'canceled',
        stripe_subscription_id: null,
      }),
      'org_id = ?',
      ['org_1'],
    );
  });

  it('does nothing when org_id missing', async () => {
    const result = await handleSubscriptionDeleted(mockDb, {
      id: 'sub_1',
      metadata: {},
    });

    expect(result).toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// handlePaymentFailed
// ---------------------------------------------------------------------------
describe('handlePaymentFailed', () => {
  it('sets status=past_due', async () => {
    mockUpdate.mockResolvedValueOnce({ error: null, changes: 1 });

    await handlePaymentFailed(mockDb, {
      subscription: 'sub_1',
      metadata: { org_id: 'org_1' },
    });

    expect(mockUpdate).toHaveBeenCalledWith(
      mockDb,
      'subscriptions',
      expect.objectContaining({
        status: 'past_due',
      }),
      'org_id = ?',
      ['org_1'],
    );
  });

  it('does nothing when org_id missing', async () => {
    const result = await handlePaymentFailed(mockDb, {
      subscription: 'sub_1',
      metadata: {},
    });

    expect(result).toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getOrgEntitlements
// ---------------------------------------------------------------------------
describe('getOrgEntitlements', () => {
  it('returns paid entitlements when sub is paid+active', async () => {
    mockQueryOne.mockResolvedValueOnce({ plan: 'paid', status: 'active' });

    const result = await getOrgEntitlements(mockDb, 'org_1');

    expect(result).toEqual({
      org_id: 'org_1',
      plan: 'paid',
      topBarHidden: true,
      maxCustomDomains: 5,
      chatEnabled: true,
      analyticsEnabled: true,
    });
  });

  it('returns free entitlements when sub is free', async () => {
    mockQueryOne.mockResolvedValueOnce({ plan: 'free', status: 'active' });

    const result = await getOrgEntitlements(mockDb, 'org_1');

    expect(result).toEqual({
      org_id: 'org_1',
      plan: 'free',
      topBarHidden: false,
      maxCustomDomains: 0,
      chatEnabled: true,
      analyticsEnabled: false,
    });
  });

  it('returns free entitlements when no subscription found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await getOrgEntitlements(mockDb, 'org_1');

    expect(result).toEqual({
      org_id: 'org_1',
      plan: 'free',
      topBarHidden: false,
      maxCustomDomains: 0,
      chatEnabled: true,
      analyticsEnabled: false,
    });
  });
});

// ---------------------------------------------------------------------------
// getOrgSubscription
// ---------------------------------------------------------------------------
describe('getOrgSubscription', () => {
  it('returns subscription data when found', async () => {
    mockQueryOne.mockResolvedValueOnce({
      plan: 'paid',
      status: 'active',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
      cancel_at_period_end: 0,
      current_period_end: '2024-12-31T00:00:00Z',
    });

    const result = await getOrgSubscription(mockDb, 'org_1');

    expect(result).toEqual({
      plan: 'paid',
      status: 'active',
      stripe_customer_id: 'cus_1',
      stripe_subscription_id: 'sub_1',
      cancel_at_period_end: false,
      current_period_end: '2024-12-31T00:00:00Z',
    });
  });

  it('returns null when not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await getOrgSubscription(mockDb, 'org_1');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createBillingPortalSession
// ---------------------------------------------------------------------------
describe('createBillingPortalSession', () => {
  it('returns portal_url on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ url: 'https://billing.stripe.com/session/xyz' }),
      text: async () => '',
    });

    const result = await createBillingPortalSession(
      mockEnv,
      'cus_1',
      'https://example.com/settings',
    );

    expect(result).toEqual({ portal_url: 'https://billing.stripe.com/session/xyz' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.stripe.com/v1/billing_portal/sessions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk_test_123',
        }),
      }),
    );
  });

  it('throws on Stripe API failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
      text: async () => 'Portal error',
    });

    await expect(
      createBillingPortalSession(mockEnv, 'cus_1', 'https://example.com/settings'),
    ).rejects.toThrow('Failed to create billing portal');
  });
});
