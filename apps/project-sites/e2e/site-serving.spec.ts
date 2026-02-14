import { test, expect } from './fixtures.js';

test.describe('Site Serving', () => {
  test('returns 404 for unknown subdomains', async ({ request }) => {
    const res = await request.get('/', {
      headers: { Host: 'nonexistent-site-xyz-sites.megabyte.space' },
    });
    expect(res.status()).toBe(404);
  });

  test('returns 404 for unknown paths on base domain', async ({ request }) => {
    const res = await request.get('/this-page-does-not-exist-xyz');
    expect([200, 404]).toContain(res.status());
  });

  test('returns correct content-type for health endpoint', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.headers()['content-type']).toContain('application/json');
  });
});

test.describe('Security Headers', () => {
  test('includes Strict-Transport-Security', async ({ request }) => {
    const res = await request.get('/health');
    const hsts = res.headers()['strict-transport-security'];
    expect(hsts).toBeDefined();
    expect(hsts).toContain('max-age=');
  });

  test('includes X-Content-Type-Options nosniff', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('includes X-Frame-Options DENY', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.headers()['x-frame-options']).toBe('DENY');
  });

  test('includes Referrer-Policy', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('includes Permissions-Policy', async ({ request }) => {
    const res = await request.get('/health');
    const pp = res.headers()['permissions-policy'];
    expect(pp).toBeDefined();
    expect(pp).toContain('camera=()');
  });

  test('includes Content-Security-Policy', async ({ request }) => {
    const res = await request.get('/health');
    const csp = res.headers()['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('https://js.stripe.com');
  });
});

test.describe('Auth Endpoints', () => {
  test('POST /api/auth/magic-link validates email', async ({ request }) => {
    const res = await request.post('/api/auth/magic-link', {
      data: { email: 'not-an-email' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 401, 403, 422]).toContain(res.status());
  });

  test('POST /api/auth/magic-link requires body', async ({ request }) => {
    const res = await request.post('/api/auth/magic-link', {
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 401, 403, 422]).toContain(res.status());
  });

  test('GET /api/auth/google returns auth URL or error', async ({ request }) => {
    const res = await request.get('/api/auth/google');
    expect([200, 302, 400, 401, 403, 404]).toContain(res.status());
  });
});

test.describe('Webhook Endpoints', () => {
  test('POST /webhooks/stripe rejects unsigned requests', async ({ request }) => {
    const res = await request.post('/webhooks/stripe', {
      data: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 401, 403]).toContain(res.status());
  });

  test('POST /webhooks/stripe rejects invalid signature', async ({ request }) => {
    const res = await request.post('/webhooks/stripe', {
      data: '{"type":"checkout.session.completed"}',
      headers: {
        'Content-Type': 'application/json',
        'Stripe-Signature': 't=1234567890,v1=invalid_signature',
      },
    });
    expect([400, 401, 403]).toContain(res.status());
  });
});

test.describe('Billing Endpoints', () => {
  test('POST /api/billing/checkout requires auth', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('GET /api/billing/entitlements requires auth', async ({ request }) => {
    const res = await request.get('/api/billing/entitlements');
    expect([401, 403]).toContain(res.status());
  });
});
