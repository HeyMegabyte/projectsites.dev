import { generateTopBar, serveSiteFromR2 } from '../services/site_serving';
import { DOMAINS, BRAND } from '@project-sites/shared';

describe('generateTopBar', () => {
  it('generates valid HTML with CTA', () => {
    const html = generateTopBar('my-biz');
    expect(html).toContain('ps-topbar');
    expect(html).toContain(BRAND.PRIMARY_CTA);
    expect(html).toContain('Project Sites');
  });

  it('includes upgrade link with slug', () => {
    const html = generateTopBar('joe-pizza');
    expect(html).toContain('upgrade=joe-pizza');
  });

  it('includes close button', () => {
    const html = generateTopBar('test');
    expect(html).toContain('&times;');
    expect(html).toContain("display='none'");
  });

  it('sets body padding', () => {
    const html = generateTopBar('test');
    expect(html).toContain('padding-top:44px');
  });

  it('links to the main domain', () => {
    const html = generateTopBar('test');
    expect(html).toContain(`https://${DOMAINS.SITES_BASE}`);
  });

  it('escapes slug in URL to prevent XSS', () => {
    const html = generateTopBar('a"onmouseover="alert(1)');
    expect(html).not.toContain('"onmouseover="');
    expect(html).toContain(encodeURIComponent('a"onmouseover="alert(1)'));
  });

  it('has correct z-index for overlay', () => {
    const html = generateTopBar('test');
    expect(html).toContain('z-index:99999');
  });

  it('is wrapped in HTML comments for identification', () => {
    const html = generateTopBar('test');
    expect(html).toContain('<!-- Project Sites Top Bar -->');
    expect(html).toContain('<!-- End Project Sites Top Bar -->');
  });

  it('generates non-empty HTML for various slugs', () => {
    const slugs = ['a-b-c', 'my-business-123', 'test'];
    for (const slug of slugs) {
      const html = generateTopBar(slug);
      expect(html.length).toBeGreaterThan(100);
    }
  });

  it('uses fixed positioning', () => {
    const html = generateTopBar('test');
    expect(html).toContain('position:fixed');
    expect(html).toContain('top:0');
  });
});

describe('serveSiteFromR2', () => {
  function createMockEnv(files: Record<string, string> = {}) {
    return {
      SITES_BUCKET: {
        get: jest.fn(async (key: string) => {
          const content = files[key];
          if (!content) return null;
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode(content));
              controller.close();
            },
          });
          return {
            body: stream,
            text: async () => content,
            key,
            httpMetadata: { contentType: 'text/html' },
            size: content.length,
          };
        }),
      },
      CACHE_KV: {
        get: jest.fn(async () => null),
        put: jest.fn(async () => {}),
        delete: jest.fn(async () => {}),
      },
    } as unknown as import('../types/env').Env;
  }

  const baseSite = {
    site_id: 'test-id',
    slug: 'my-biz',
    current_build_version: 'v1',
    plan: 'free',
  };

  it('returns text/html Content-Type for root path /', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/index.html': '<html><body>Hello</body></html>',
    });

    const response = await serveSiteFromR2(env, baseSite, '/');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html');
  });

  it('does NOT download root path as application/octet-stream', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/index.html': '<html><body>Test</body></html>',
    });

    const response = await serveSiteFromR2(env, baseSite, '/');
    expect(response.headers.get('Content-Type')).not.toBe('application/octet-stream');
  });

  it('returns text/css for .css files', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/style.css': 'body { color: red; }',
    });

    const response = await serveSiteFromR2(env, baseSite, '/style.css');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/css');
  });

  it('returns application/javascript for .js files', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/app.js': 'console.log("hello")',
    });

    const response = await serveSiteFromR2(env, baseSite, '/app.js');
    expect(response.headers.get('Content-Type')).toBe('application/javascript');
  });

  it('returns 404 for non-existent files', async () => {
    const env = createMockEnv({});

    const response = await serveSiteFromR2(env, baseSite, '/missing.txt');
    expect(response.status).toBe(404);
  });

  it('falls back to index.html for extensionless SPA routes', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/index.html': '<html><body>SPA</body></html>',
    });

    const response = await serveSiteFromR2(env, baseSite, '/about');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html');
  });

  it('injects top bar for free plan HTML', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/index.html': '<html><body>Content</body></html>',
    });

    const response = await serveSiteFromR2(env, baseSite, '/');
    const html = await response.text();
    expect(html).toContain('ps-topbar');
    expect(html).toContain('Project Sites');
  });

  it('does NOT inject top bar for paid plan HTML', async () => {
    const paidSite = { ...baseSite, plan: 'paid' };
    const env = createMockEnv({
      'sites/my-biz/v1/index.html': '<html><body>Content</body></html>',
    });

    const response = await serveSiteFromR2(env, paidSite, '/');
    const body = await response.text();
    expect(body).not.toContain('ps-topbar');
  });

  it('blocks access to _meta/ paths', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/_meta/chat.json': '{}',
    });

    const response = await serveSiteFromR2(env, baseSite, '/_meta/chat.json');
    expect(response.status).toBe(404);
  });

  it('blocks access to _manifest.json', async () => {
    const env = createMockEnv({});

    const response = await serveSiteFromR2(env, baseSite, '/_manifest.json');
    expect(response.status).toBe(404);
  });

  it('sets caching headers', async () => {
    const env = createMockEnv({
      'sites/my-biz/v1/index.html': '<html><body>Cached</body></html>',
    });

    const response = await serveSiteFromR2(env, baseSite, '/');
    expect(response.headers.get('Cache-Control')).toContain('public');
    expect(response.headers.get('X-Site-Slug')).toBe('my-biz');
  });
});
