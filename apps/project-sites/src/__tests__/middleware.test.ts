import { Hono } from 'hono';
import { requestIdMiddleware } from '../middleware/request_id.js';
import { payloadLimitMiddleware } from '../middleware/payload_limit.js';
import { securityHeadersMiddleware } from '../middleware/security_headers.js';

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── requestIdMiddleware ─────────────────────────────────────

describe('requestIdMiddleware', () => {
  function createApp() {
    const app = new Hono<{ Bindings: any; Variables: any }>();
    app.use('*', requestIdMiddleware);
    app.get('/test', (c) => c.text('ok'));
    return app;
  }

  it('sets x-request-id response header', async () => {
    const app = createApp();
    const res = await app.request('/test');

    expect(res.headers.get('x-request-id')).toBeTruthy();
  });

  it('uses provided x-request-id from request', async () => {
    const app = createApp();
    const customId = 'my-custom-request-id-123';
    const res = await app.request('/test', {
      headers: { 'x-request-id': customId },
    });

    expect(res.headers.get('x-request-id')).toBe(customId);
  });

  it('generates UUID when no x-request-id provided', async () => {
    const app = createApp();
    const res = await app.request('/test');

    const id = res.headers.get('x-request-id');
    expect(id).toBeTruthy();
    expect(id).not.toBe('');
  });

  it('generated ID is valid UUID format', async () => {
    const app = createApp();
    const res = await app.request('/test');

    const id = res.headers.get('x-request-id');
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidRegex);
  });
});

// ─── payloadLimitMiddleware ──────────────────────────────────

describe('payloadLimitMiddleware', () => {
  function createApp() {
    const app = new Hono<{ Bindings: any; Variables: any }>();
    app.use('*', payloadLimitMiddleware);
    app.get('/test', (c) => c.text('ok'));
    app.post('/test', (c) => c.text('ok'));
    return app;
  }

  it('allows requests under size limit', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'content-length': '1024' },
    });

    expect(res.status).toBe(200);
  });

  it('allows requests without content-length', async () => {
    const app = createApp();
    const res = await app.request('/test');

    expect(res.status).toBe(200);
  });

  it('throws payloadTooLarge for oversized requests', async () => {
    const app = createApp();
    app.onError((err, c) => {
      const status = (err as any).statusCode || 500;
      return c.json({ error: (err as any).message || 'error' }, status);
    });

    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'content-length': '999999999' },
    });

    expect(res.status).toBe(413);
  });

  it('allows exact limit size', async () => {
    const app = createApp();
    // DEFAULT_CAPS.MAX_REQUEST_BODY_BYTES = 262144 (256 * 1024)
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'content-length': '262144' },
    });

    expect(res.status).toBe(200);
  });

  it('handles non-numeric content-length', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      method: 'POST',
      headers: { 'content-length': 'not-a-number' },
    });

    // parseInt('not-a-number', 10) is NaN, so the check is skipped
    expect(res.status).toBe(200);
  });
});

// ─── securityHeadersMiddleware ───────────────────────────────

describe('securityHeadersMiddleware', () => {
  function createApp() {
    const app = new Hono<{ Bindings: any; Variables: any }>();
    app.use('*', securityHeadersMiddleware);
    app.get('/test', (c) => c.text('ok'));
    return app;
  }

  it('sets Strict-Transport-Security header', async () => {
    const app = createApp();
    const res = await app.request('/test');

    const hsts = res.headers.get('Strict-Transport-Security');
    expect(hsts).toBe('max-age=63072000; includeSubDomains; preload');
  });

  it('sets X-Content-Type-Options to nosniff', async () => {
    const app = createApp();
    const res = await app.request('/test');

    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets X-Frame-Options to DENY', async () => {
    const app = createApp();
    const res = await app.request('/test');

    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('sets Referrer-Policy', async () => {
    const app = createApp();
    const res = await app.request('/test');

    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets Permissions-Policy', async () => {
    const app = createApp();
    const res = await app.request('/test');

    expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=()');
  });

  it('sets Content-Security-Policy with correct directives', async () => {
    const app = createApp();
    const res = await app.request('/test');

    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://unpkg.com https://releases.transloadit.com https://js.stripe.com");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://releases.transloadit.com");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp).toContain("connect-src 'self' https://api.stripe.com https://lottie.host");
    expect(csp).toContain('frame-src https://js.stripe.com');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});
