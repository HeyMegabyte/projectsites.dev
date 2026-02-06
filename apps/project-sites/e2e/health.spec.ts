import { test, expect } from '@playwright/test';

test.describe('Health Check', () => {
  test('returns healthy status', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
    expect(['ok', 'degraded']).toContain(body.status);
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('environment');
    expect(body).toHaveProperty('timestamp');
  });

  test('includes dependency checks', async ({ request }) => {
    const res = await request.get('/health');
    const body = await res.json();
    expect(body).toHaveProperty('checks');
  });

  test('returns valid ISO timestamp', async ({ request }) => {
    const res = await request.get('/health');
    const body = await res.json();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  test('responds within 5 seconds', async ({ request }) => {
    const start = Date.now();
    await request.get('/health');
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

test.describe('Marketing Site', () => {
  test('loads the marketing homepage', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Project Sites')).toBeVisible();
  });

  test('has correct content-type for homepage', async ({ request }) => {
    const res = await request.get('/');
    expect(res.headers()['content-type']).toContain('text/html');
  });
});

test.describe('API Auth Gates', () => {
  test('returns 401/403 for unauthenticated /api/sites', async ({ request }) => {
    const res = await request.get('/api/sites');
    expect([401, 403]).toContain(res.status());
  });

  test('returns 401/403 for unauthenticated /api/billing/subscription', async ({ request }) => {
    const res = await request.get('/api/billing/subscription');
    expect([401, 403]).toContain(res.status());
  });

  test('returns 401/403 for unauthenticated /api/hostnames', async ({ request }) => {
    const res = await request.get('/api/hostnames');
    expect([401, 403]).toContain(res.status());
  });

  test('returns 401/403 for unauthenticated /api/audit-logs', async ({ request }) => {
    const res = await request.get('/api/audit-logs');
    expect([401, 403]).toContain(res.status());
  });
});

test.describe('Request Tracing', () => {
  test('returns x-request-id header', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.headers()).toHaveProperty('x-request-id');
  });

  test('propagates provided x-request-id', async ({ request }) => {
    const testId = `e2e-test-${Date.now()}`;
    const res = await request.get('/health', {
      headers: { 'x-request-id': testId },
    });
    expect(res.headers()['x-request-id']).toBe(testId);
  });
});

test.describe('CORS', () => {
  test('includes request-id for allowed origin', async ({ request }) => {
    const res = await request.get('/health', {
      headers: { Origin: 'https://sites.megabyte.space' },
    });
    expect(res.headers()).toHaveProperty('x-request-id');
  });
});

test.describe('Error Handling', () => {
  test('returns error for unknown API routes', async ({ request }) => {
    const res = await request.get('/api/nonexistent-route-xyz');
    expect([401, 403, 404]).toContain(res.status());
  });

  test('returns 413 for oversized payloads', async ({ request }) => {
    const largeBody = 'x'.repeat(300_000);
    const res = await request.post('/api/auth/magic-link', {
      data: largeBody,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(largeBody.length),
      },
    });
    expect([413, 400]).toContain(res.status());
  });
});
