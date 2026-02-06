jest.mock('../services/db.js', () => ({
  supabaseQuery: jest.fn(),
}));

import { supabaseQuery } from '../services/db.js';
import {
  createMagicLink,
  verifyMagicLink,
  createPhoneOtp,
  verifyPhoneOtp,
  createGoogleOAuthState,
  handleGoogleOAuthCallback,
  createSession,
  getSession,
  revokeSession,
  getUserSessions,
} from '../services/auth.js';
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
import {
  createCustomHostname,
  checkHostnameStatus,
  deleteCustomHostname,
  provisionFreeDomain,
  provisionCustomDomain,
  getSiteHostnames,
  getHostnameByDomain,
  verifyPendingHostnames,
} from '../services/domains.js';
import { AppError } from '@project-sites/shared';

const mockQuery = supabaseQuery as jest.MockedFunction<typeof supabaseQuery>;

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
const originalFetch = globalThis.fetch;

const mockEnv = {
  ENVIRONMENT: 'test',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service',
  STRIPE_SECRET_KEY: 'sk_test_123',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  CF_API_TOKEN: 'cf-token',
  CF_ZONE_ID: 'zone-123',
  GOOGLE_CLIENT_ID: 'google-id',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  SENDGRID_API_KEY: 'sg-key',
  GOOGLE_PLACES_API_KEY: 'places-key',
  SENTRY_DSN: 'https://sentry.example.com',
} as any;

const mockDb = {
  url: 'https://test.supabase.co',
  headers: {
    apikey: 'test',
    Authorization: 'Bearer test',
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  },
  fetch: jest.fn(),
} as any;

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ===========================================================================
// Auth Service Error Paths
// ===========================================================================
describe('Auth Service Error Paths', () => {
  // -------------------------------------------------------------------------
  // verifyMagicLink
  // -------------------------------------------------------------------------
  describe('verifyMagicLink', () => {
    const token = 'a'.repeat(64);

    it('throws unauthorized when no matching token found', async () => {
      mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });

      const err = await verifyMagicLink(mockDb, { token }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
      expect((err as AppError).message).toBe('Invalid or expired magic link');
    });

    it('throws unauthorized when magic link is expired', async () => {
      const pastDate = new Date(Date.now() - 3_600_000).toISOString();
      mockQuery.mockResolvedValueOnce({
        data: [
          {
            id: 'link-expired',
            email: 'expired@example.com',
            redirect_url: null,
            used: false,
            expires_at: pastDate,
          },
        ],
        error: null,
        status: 200,
      });

      const err = await verifyMagicLink(mockDb, { token }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
      expect((err as AppError).message).toBe('Magic link has expired');
    });

    it('marks link as used on successful verification via PATCH', async () => {
      const futureDate = new Date(Date.now() + 3_600_000).toISOString();
      mockQuery
        .mockResolvedValueOnce({
          data: [
            {
              id: 'link-valid',
              email: 'valid@example.com',
              redirect_url: null,
              used: false,
              expires_at: futureDate,
            },
          ],
          error: null,
          status: 200,
        })
        .mockResolvedValueOnce({ data: null, error: null, status: 200 });

      const result = await verifyMagicLink(mockDb, { token });

      expect(result.email).toBe('valid@example.com');
      expect(mockQuery).toHaveBeenCalledTimes(2);
      expect(mockQuery).toHaveBeenLastCalledWith(
        mockDb,
        'magic_links',
        expect.objectContaining({
          method: 'PATCH',
          query: 'id=eq.link-valid',
          body: expect.objectContaining({ used: true }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // createPhoneOtp
  // -------------------------------------------------------------------------
  describe('createPhoneOtp', () => {
    const input = { phone: '+15551234567' };

    it('throws rateLimited when a recent OTP exists for this phone', async () => {
      mockQuery.mockResolvedValueOnce({
        data: [{ id: 'recent-otp' }],
        error: null,
        status: 200,
      });

      const err = await createPhoneOtp(mockDb, mockEnv, input).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(429);
      expect((err as AppError).message).toBe('Please wait before requesting another OTP');
    });

    it('does NOT log OTP in production environment', async () => {
      const prodEnv = { ...mockEnv, ENVIRONMENT: 'production' };
      mockQuery
        .mockResolvedValueOnce({ data: [], error: null, status: 200 })
        .mockResolvedValueOnce({ data: null, error: null, status: 201 });

      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await createPhoneOtp(mockDb, prodEnv, input);

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // verifyPhoneOtp
  // -------------------------------------------------------------------------
  describe('verifyPhoneOtp', () => {
    const phone = '+15551234567';

    it('throws unauthorized when no pending OTP found', async () => {
      mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });

      const err = await verifyPhoneOtp(mockDb, { phone, otp: '123456' }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
      expect((err as AppError).message).toBe('No pending OTP found');
    });

    it('throws rateLimited when max attempts exceeded (attempts >= 3)', async () => {
      mockQuery.mockResolvedValueOnce({
        data: [{ id: 'otp-maxed', otp_hash: 'some-hash', attempts: 3 }],
        error: null,
        status: 200,
      });

      const err = await verifyPhoneOtp(mockDb, { phone, otp: '123456' }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(429);
      expect((err as AppError).message).toBe('Too many OTP attempts');
    });

    it('throws unauthorized when OTP hash does not match', async () => {
      // The DB record has a known hash that will never match sha256('999999')
      mockQuery
        .mockResolvedValueOnce({
          data: [{ id: 'otp-wrong', otp_hash: 'definitely-wrong-hash', attempts: 0 }],
          error: null,
          status: 200,
        })
        .mockResolvedValueOnce({ data: null, error: null, status: 200 }); // increment attempts

      const err = await verifyPhoneOtp(mockDb, { phone, otp: '999999' }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
      expect((err as AppError).message).toBe('Invalid OTP');
    });
  });

  // -------------------------------------------------------------------------
  // handleGoogleOAuthCallback
  // -------------------------------------------------------------------------
  describe('handleGoogleOAuthCallback', () => {
    it('throws unauthorized when state not found in DB', async () => {
      mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });

      const err = await handleGoogleOAuthCallback(mockDb, mockEnv, 'some-code', 'bad-state').catch(
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
      expect((err as AppError).message).toBe('Invalid OAuth state');
    });

    it('throws unauthorized when state is expired', async () => {
      const pastDate = new Date(Date.now() - 600_000).toISOString();
      mockQuery.mockResolvedValueOnce({
        data: [{ id: 'state-old', state: 'expired-state', expires_at: pastDate }],
        error: null,
        status: 200,
      });

      const err = await handleGoogleOAuthCallback(
        mockDb,
        mockEnv,
        'some-code',
        'expired-state',
      ).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
      expect((err as AppError).message).toBe('OAuth state expired');
    });
  });

  // -------------------------------------------------------------------------
  // getSession
  // -------------------------------------------------------------------------
  describe('getSession', () => {
    const token = 'b'.repeat(64);

    it('returns null when no session found', async () => {
      mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });

      const result = await getSession(mockDb, token);

      expect(result).toBeNull();
    });

    it('returns null when session is expired', async () => {
      const pastDate = new Date(Date.now() - 86_400_000).toISOString();
      mockQuery.mockResolvedValueOnce({
        data: [{ id: 'sess-expired', user_id: 'user-1', expires_at: pastDate }],
        error: null,
        status: 200,
      });

      const result = await getSession(mockDb, token);

      expect(result).toBeNull();
    });
  });
});

// ===========================================================================
// Billing Service Error Paths
// ===========================================================================
describe('Billing Service Error Paths', () => {
  // -------------------------------------------------------------------------
  // getOrCreateStripeCustomer
  // -------------------------------------------------------------------------
  describe('getOrCreateStripeCustomer', () => {
    it('returns existing customer ID when subscription already exists', async () => {
      mockQuery.mockResolvedValueOnce({
        data: [{ id: 'sub-1', stripe_customer_id: 'cus_existing' }],
        error: null,
        status: 200,
      });

      const result = await getOrCreateStripeCustomer(mockDb, mockEnv, 'org-1', 'a@b.com');

      expect(result).toEqual({ stripe_customer_id: 'cus_existing' });
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when Stripe API returns non-OK response', async () => {
      mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });
      mockFetch.mockResolvedValueOnce(
        new Response('Stripe error: invalid API key', { status: 401 }),
      );

      const err = await getOrCreateStripeCustomer(mockDb, mockEnv, 'org-1', 'a@b.com').catch(
        (e: unknown) => e,
      );

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).message).toMatch(/Failed to create Stripe customer/);
    });
  });

  // -------------------------------------------------------------------------
  // createCheckoutSession
  // -------------------------------------------------------------------------
  describe('createCheckoutSession', () => {
    it('throws when Stripe checkout API returns non-OK response', async () => {
      // getOrCreateStripeCustomer finds existing customer
      mockQuery.mockResolvedValueOnce({
        data: [{ id: 'sub-1', stripe_customer_id: 'cus_existing' }],
        error: null,
        status: 200,
      });
      // Stripe checkout creation fails
      mockFetch.mockResolvedValueOnce(new Response('Checkout creation failed', { status: 400 }));

      const err = await createCheckoutSession(mockDb, mockEnv, {
        orgId: 'org-1',
        customerEmail: 'a@b.com',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).message).toMatch(/Failed to create Stripe checkout/);
    });
  });

  // -------------------------------------------------------------------------
  // handleCheckoutCompleted
  // -------------------------------------------------------------------------
  describe('handleCheckoutCompleted', () => {
    it('throws badRequest when org_id missing from metadata', async () => {
      const err = await handleCheckoutCompleted(mockDb, mockEnv, {
        customer: 'cus_1',
        subscription: 'sub_1',
        metadata: {},
      }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).message).toBe('Missing org_id in checkout metadata');
    });

    it('calls sale webhook when SALE_WEBHOOK_URL and SALE_WEBHOOK_SECRET are set', async () => {
      const envWithWebhook = {
        ...mockEnv,
        SALE_WEBHOOK_URL: 'https://hooks.example.com/sale',
        SALE_WEBHOOK_SECRET: 'webhook-secret-123',
      };

      // DB PATCH for subscription update
      mockQuery.mockResolvedValueOnce({ data: null, error: null, status: 200 });
      // Sale webhook call succeeds on first attempt
      mockFetch.mockResolvedValueOnce(new Response('OK', { status: 200 }));

      await handleCheckoutCompleted(mockDb, envWithWebhook, {
        customer: 'cus_1',
        subscription: 'sub_1',
        metadata: { org_id: 'org-1', site_id: 'site-1' },
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hooks.example.com/sale',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Webhook-Signature': expect.any(String),
          }),
        }),
      );

      // Verify the webhook body payload
      const webhookCall = mockFetch.mock.calls[0];
      const body = JSON.parse(webhookCall[1]!.body as string);
      expect(body.org_id).toBe('org-1');
      expect(body.site_id).toBe('site-1');
      expect(body.stripe_customer_id).toBe('cus_1');
      expect(body.stripe_subscription_id).toBe('sub_1');
      expect(body.plan).toBe('paid');
    });
  });

  // -------------------------------------------------------------------------
  // handleSubscriptionUpdated
  // -------------------------------------------------------------------------
  describe('handleSubscriptionUpdated', () => {
    it('returns early with no DB update when org_id missing from metadata', async () => {
      const result = await handleSubscriptionUpdated(mockDb, {
        id: 'sub_1',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1700000000,
        current_period_end: 1702592000,
        metadata: {},
      });

      expect(result).toBeUndefined();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // handleSubscriptionDeleted
  // -------------------------------------------------------------------------
  describe('handleSubscriptionDeleted', () => {
    it('returns early when org_id missing from metadata', async () => {
      const result = await handleSubscriptionDeleted(mockDb, {
        id: 'sub_1',
        metadata: {},
      });

      expect(result).toBeUndefined();
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // getOrgEntitlements
  // -------------------------------------------------------------------------
  describe('getOrgEntitlements', () => {
    it('returns FREE entitlements when no subscription found', async () => {
      mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });

      const result = await getOrgEntitlements(mockDb, 'org-no-sub');

      expect(result).toEqual(
        expect.objectContaining({
          plan: 'free',
          topBarHidden: false,
          maxCustomDomains: 0,
          analyticsEnabled: false,
        }),
      );
    });

    it('returns FREE entitlements when subscription status is past_due', async () => {
      mockQuery.mockResolvedValueOnce({
        data: [{ plan: 'paid', status: 'past_due' }],
        error: null,
        status: 200,
      });

      const result = await getOrgEntitlements(mockDb, 'org-past-due');

      expect(result).toEqual(
        expect.objectContaining({
          plan: 'free',
          topBarHidden: false,
          maxCustomDomains: 0,
          analyticsEnabled: false,
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // getOrgSubscription
  // -------------------------------------------------------------------------
  describe('getOrgSubscription', () => {
    it('returns null when no subscription exists', async () => {
      mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });

      const result = await getOrgSubscription(mockDb, 'org-none');

      expect(result).toBeNull();
    });
  });
});

// ===========================================================================
// Domains Service Error Paths
// ===========================================================================
describe('Domains Service Error Paths', () => {
  // -------------------------------------------------------------------------
  // createCustomHostname
  // -------------------------------------------------------------------------
  describe('createCustomHostname', () => {
    it('throws when CF API returns non-OK response', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Zone not found', { status: 403 }));

      const err = await createCustomHostname(mockEnv, 'bad.example.com').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).message).toMatch(/Failed to create custom hostname/);
    });

    it('returns cf_id, status, and ssl_status on success', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              id: 'cf-host-abc',
              status: 'pending',
              ssl: { status: 'pending_validation' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const result = await createCustomHostname(mockEnv, 'app.example.com');

      expect(result).toEqual({
        cf_id: 'cf-host-abc',
        status: 'pending',
        ssl_status: 'pending_validation',
      });
    });
  });

  // -------------------------------------------------------------------------
  // checkHostnameStatus
  // -------------------------------------------------------------------------
  describe('checkHostnameStatus', () => {
    it('throws notFound when CF API returns non-OK (e.g. 404)', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Not found', { status: 404 }));

      const err = await checkHostnameStatus(mockEnv, 'cf-nonexistent').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(404);
      expect((err as AppError).message).toBe('Custom hostname not found');
    });
  });

  // -------------------------------------------------------------------------
  // deleteCustomHostname
  // -------------------------------------------------------------------------
  describe('deleteCustomHostname', () => {
    it('succeeds without throwing when CF returns 404', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Not found', { status: 404 }));

      await expect(deleteCustomHostname(mockEnv, 'cf-already-gone')).resolves.toBeUndefined();
    });

    it('throws when CF returns non-OK and not 404', async () => {
      mockFetch.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }));

      const err = await deleteCustomHostname(mockEnv, 'cf-host-err').catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(400);
      expect((err as AppError).message).toMatch(/Failed to delete custom hostname/);
    });
  });

  // -------------------------------------------------------------------------
  // provisionFreeDomain
  // -------------------------------------------------------------------------
  describe('provisionFreeDomain', () => {
    it('returns existing hostname when already provisioned', async () => {
      mockQuery.mockResolvedValueOnce({
        data: [{ id: 'existing-id', status: 'active' }],
        error: null,
        status: 200,
      });

      const result = await provisionFreeDomain(mockDb, mockEnv, {
        org_id: 'org-1',
        site_id: 'site-1',
        slug: 'existing-app',
      });

      expect(result).toEqual({
        hostname: 'existing-app.sites.megabyte.space',
        status: 'active',
      });
      // Should not call CF API or insert into DB
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // provisionCustomDomain
  // -------------------------------------------------------------------------
  describe('provisionCustomDomain', () => {
    it('throws conflict when max custom domains reached (5 existing)', async () => {
      const fiveDomains = Array.from({ length: 5 }, (_, i) => ({ id: `dom-${i}` }));
      mockQuery.mockResolvedValueOnce({
        data: fiveDomains,
        error: null,
        status: 200,
      });

      const err = await provisionCustomDomain(mockDb, mockEnv, {
        org_id: 'org-full',
        site_id: 'site-1',
        hostname: 'sixth.example.com',
      }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).message).toMatch(/Maximum custom domains.*5/);
    });
  });

  // -------------------------------------------------------------------------
  // verifyPendingHostnames
  // -------------------------------------------------------------------------
  describe('verifyPendingHostnames', () => {
    it('returns correct verified/failed counts after checking multiple hostnames', async () => {
      // Return 3 pending hostnames from DB
      mockQuery
        .mockResolvedValueOnce({
          data: [
            { id: 'h1', cf_custom_hostname_id: 'cf-1', hostname: 'a.example.com' },
            { id: 'h2', cf_custom_hostname_id: 'cf-2', hostname: 'b.example.com' },
            { id: 'h3', cf_custom_hostname_id: 'cf-3', hostname: 'c.example.com' },
          ],
          error: null,
          status: 200,
        })
        // PATCH for h1
        .mockResolvedValueOnce({ data: null, error: null, status: 200 })
        // PATCH for h2
        .mockResolvedValueOnce({ data: null, error: null, status: 200 })
        // PATCH for h3
        .mockResolvedValueOnce({ data: null, error: null, status: 200 });

      // h1: becomes active
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: { status: 'active', ssl: { status: 'active' } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      // h2: has verification errors -> verification_failed
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              status: 'pending',
              ssl: { status: 'pending_validation' },
              verification_errors: ['CNAME not found'],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );
      // h3: still pending, no errors -> stays pending (not counted as verified or failed)
      mockFetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            result: {
              status: 'pending',
              ssl: { status: 'pending_validation' },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

      const result = await verifyPendingHostnames(mockDb, mockEnv);

      expect(result).toEqual({ verified: 1, failed: 1 });
      // 3 CF status checks
      expect(mockFetch).toHaveBeenCalledTimes(3);
      // 1 initial query + 3 PATCH updates
      expect(mockQuery).toHaveBeenCalledTimes(4);
    });
  });
});
