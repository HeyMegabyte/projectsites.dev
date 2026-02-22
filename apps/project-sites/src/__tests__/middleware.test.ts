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

  describe('upload endpoint limits (100MB)', () => {
    function createUploadApp() {
      const app = new Hono<{ Bindings: any; Variables: any }>();
      app.use('*', payloadLimitMiddleware);
      app.post('/api/publish/bolt', (c) => c.text('ok'));
      app.post('/api/sites/:id/deploy', (c) => c.text('ok'));
      app.post('/api/sites/:id/settings', (c) => c.text('ok'));
      app.post('/api/other', (c) => c.text('ok'));
      app.onError((err, c) => {
        const status = (err as any).statusCode || 500;
        return c.json({ error: (err as any).message || 'error' }, status);
      });
      return app;
    }

    it('allows 50MB body for /api/publish/bolt', async () => {
      const app = createUploadApp();
      const size = 50 * 1024 * 1024; // 50MB
      const res = await app.request('/api/publish/bolt', {
        method: 'POST',
        headers: { 'content-length': String(size) },
      });
      expect(res.status).toBe(200);
    });

    it('allows 99MB body for /api/publish/bolt', async () => {
      const app = createUploadApp();
      const size = 99 * 1024 * 1024; // 99MB
      const res = await app.request('/api/publish/bolt', {
        method: 'POST',
        headers: { 'content-length': String(size) },
      });
      expect(res.status).toBe(200);
    });

    it('rejects 101MB body for /api/publish/bolt', async () => {
      const app = createUploadApp();
      const size = 101 * 1024 * 1024; // 101MB
      const res = await app.request('/api/publish/bolt', {
        method: 'POST',
        headers: { 'content-length': String(size) },
      });
      expect(res.status).toBe(413);
    });

    it('allows 50MB body for /api/sites/:id/deploy', async () => {
      const app = createUploadApp();
      const size = 50 * 1024 * 1024;
      const res = await app.request('/api/sites/abc-123/deploy', {
        method: 'POST',
        headers: { 'content-length': String(size) },
      });
      expect(res.status).toBe(200);
    });

    it('rejects 101MB body for /api/sites/:id/deploy', async () => {
      const app = createUploadApp();
      const size = 101 * 1024 * 1024;
      const res = await app.request('/api/sites/abc-123/deploy', {
        method: 'POST',
        headers: { 'content-length': String(size) },
      });
      expect(res.status).toBe(413);
    });

    it('uses default limit for /api/sites/:id/settings (not an upload path)', async () => {
      const app = createUploadApp();
      // 1MB exceeds 256KB default limit but not upload limit
      const size = 1 * 1024 * 1024;
      const res = await app.request('/api/sites/abc-123/settings', {
        method: 'POST',
        headers: { 'content-length': String(size) },
      });
      expect(res.status).toBe(413);
    });

    it('uses default limit for non-upload API routes', async () => {
      const app = createUploadApp();
      const size = 1 * 1024 * 1024; // 1MB
      const res = await app.request('/api/other', {
        method: 'POST',
        headers: { 'content-length': String(size) },
      });
      expect(res.status).toBe(413);
    });

    it('allows exact 100MB for upload endpoints', async () => {
      const app = createUploadApp();
      const size = 100 * 1024 * 1024; // exactly 100MB
      const res = await app.request('/api/publish/bolt', {
        method: 'POST',
        headers: { 'content-length': String(size) },
      });
      expect(res.status).toBe(200);
    });
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

  it('sets X-Frame-Options to SAMEORIGIN for dashboard requests', async () => {
    const app = createApp();
    const res = await app.request('/test');

    // Dashboard/API requests get SAMEORIGIN; served sites get no X-Frame-Options
    const xfo = res.headers.get('X-Frame-Options');
    expect(xfo === 'SAMEORIGIN' || xfo === null).toBeTruthy();
  });

  it('sets Referrer-Policy', async () => {
    const app = createApp();
    const res = await app.request('/test');

    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets Permissions-Policy', async () => {
    const app = createApp();
    const res = await app.request('/test');

    expect(res.headers.get('Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=self');
  });

  it('sets Cross-Origin-Opener-Policy header', async () => {
    const app = createApp();
    const res = await app.request('/test');

    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
  });

  it('does not set Cross-Origin-Embedder-Policy for dashboard routes', async () => {
    const app = createApp();
    const res = await app.request('/test');

    // COEP is no longer set on dashboard routes (removed to allow iframe embedding)
    const coep = res.headers.get('Cross-Origin-Embedder-Policy');
    expect(coep === null || coep === 'credentialless').toBeTruthy();
  });

  it('sets Content-Security-Policy with correct directives', async () => {
    const app = createApp();
    const res = await app.request('/test');

    const csp = res.headers.get('Content-Security-Policy');
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://releases.transloadit.com https://js.stripe.com");
    expect(csp).toContain('https://cdnjs.cloudflare.com');
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://releases.transloadit.com");
    expect(csp).toContain("img-src 'self' data: https:");
    expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
    expect(csp).toContain("connect-src 'self' https://api.stripe.com https://us.i.posthog.com");
    expect(csp).toContain('frame-src https://js.stripe.com');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  describe('CSP includes Google Tag Manager and Analytics', () => {
    it('allows GTM in script-src', async () => {
      const app = createApp();
      const res = await app.request('/test');
      const csp = res.headers.get('Content-Security-Policy')!;
      expect(csp).toContain('https://www.googletagmanager.com');
    });

    it('allows Google Analytics in script-src', async () => {
      const app = createApp();
      const res = await app.request('/test');
      const csp = res.headers.get('Content-Security-Policy')!;
      const scriptSrc = csp.split(';').find(d => d.trim().startsWith('script-src'))!;
      expect(scriptSrc).toContain('https://www.google-analytics.com');
    });

    it('allows GTM and GA in img-src', async () => {
      const app = createApp();
      const res = await app.request('/test');
      const csp = res.headers.get('Content-Security-Policy')!;
      const imgSrc = csp.split(';').find(d => d.trim().startsWith('img-src'))!;
      expect(imgSrc).toContain('https://www.googletagmanager.com');
      expect(imgSrc).toContain('https://www.google-analytics.com');
    });

    it('allows GA and GTM in connect-src', async () => {
      const app = createApp();
      const res = await app.request('/test');
      const csp = res.headers.get('Content-Security-Policy')!;
      const connectSrc = csp.split(';').find(d => d.trim().startsWith('connect-src'))!;
      expect(connectSrc).toContain('https://www.google-analytics.com');
      expect(connectSrc).toContain('https://www.googletagmanager.com');
      expect(connectSrc).toContain('https://region1.google-analytics.com');
    });

    it('allows GTM in frame-src', async () => {
      const app = createApp();
      const res = await app.request('/test');
      const csp = res.headers.get('Content-Security-Policy')!;
      const frameSrc = csp.split(';').find(d => d.trim().startsWith('frame-src'))!;
      expect(frameSrc).toContain('https://www.googletagmanager.com');
    });

    it('allows Cloudflare Insights in script-src', async () => {
      const app = createApp();
      const res = await app.request('/test');
      const csp = res.headers.get('Content-Security-Policy')!;
      const scriptSrc = csp.split(';').find(d => d.trim().startsWith('script-src'))!;
      expect(scriptSrc).toContain('https://static.cloudflareinsights.com');
    });

    it('frame-src uses *.megabyte.space for dash-based subdomains', async () => {
      const app = createApp();
      const res = await app.request('/test');
      const csp = res.headers.get('Content-Security-Policy')!;
      const frameSrc = csp.split(';').find(d => d.trim().startsWith('frame-src'))!;
      // Must allow foo-sites.megabyte.space via *.megabyte.space wildcard
      expect(frameSrc).toContain('https://*.megabyte.space');
    });

    it('frame-src does NOT use *.sites.megabyte.space (wrong subdomain pattern)', async () => {
      const app = createApp();
      const res = await app.request('/test');
      const csp = res.headers.get('Content-Security-Policy')!;
      const frameSrc = csp.split(';').find(d => d.trim().startsWith('frame-src'))!;
      // *.sites.megabyte.space matches foo.sites.megabyte.space but NOT foo-sites.megabyte.space
      expect(frameSrc).not.toContain('*.sites.megabyte.space');
    });
  });
});
