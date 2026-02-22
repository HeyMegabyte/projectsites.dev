jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
}));

import { dbQuery, dbQueryOne } from '../services/db.js';
import { resolveSite, serveSiteFromR2 } from '../services/site_serving.js';
import { DOMAINS } from '@project-sites/shared';

const mockQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

const createMockKV = () => ({
  get: jest.fn().mockResolvedValue(null),
  put: jest.fn().mockResolvedValue(undefined),
});

const createMockR2Object = (content: string) => ({
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(content));
      controller.close();
    },
  }),
  text: jest.fn().mockResolvedValue(content),
  arrayBuffer: jest.fn().mockResolvedValue(new TextEncoder().encode(content).buffer),
});

const createMockR2 = () => ({
  get: jest.fn().mockResolvedValue(null),
  put: jest.fn(),
});

const createMockEnv = () => ({
  CACHE_KV: createMockKV(),
  SITES_BUCKET: createMockR2(),
  DB: {} as D1Database,
});

const createMockDb = () => ({} as D1Database);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_HTML = '<html><body><h1>Hello</h1></body></html>';

const makeSite = (overrides: Record<string, unknown> = {}) => ({
  site_id: 'site-001',
  slug: 'my-site',
  org_id: 'org-001',
  current_build_version: 'v1',
  plan: 'free',
  ...overrides,
});

// ---------------------------------------------------------------------------
// resolveSite
// ---------------------------------------------------------------------------

describe('resolveSite', () => {
  let env: ReturnType<typeof createMockEnv>;
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    jest.clearAllMocks();
    env = createMockEnv();
    db = createMockDb();
  });

  it('returns cached result from KV when available', async () => {
    const cached = makeSite();
    (env.CACHE_KV.get as jest.Mock).mockResolvedValue(cached);

    const result = await resolveSite(env as any, db, 'my-site-sites.megabyte.space');

    expect(result).toEqual(cached);
    expect(env.CACHE_KV.get).toHaveBeenCalledWith('host:my-site-sites.megabyte.space', 'json');
    // Should NOT have queried the database
    expect(mockQueryOne).not.toHaveBeenCalled();
  });

  it('extracts slug from dash-based hostname and looks up site in DB', async () => {
    mockQueryOne
      // sites table query
      .mockResolvedValueOnce({
        id: 'site-001', slug: 'cool-biz', org_id: 'org-001', current_build_version: 'v2',
      })
      // subscriptions query
      .mockResolvedValueOnce({ plan: 'paid', status: 'active' });

    const result = await resolveSite(env as any, db, `cool-biz${DOMAINS.SITES_SUFFIX}`);

    expect(result).toEqual({
      site_id: 'site-001',
      slug: 'cool-biz',
      org_id: 'org-001',
      current_build_version: 'v2',
      plan: 'paid',
    });
  });

  it('looks up site by slug in DB', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'site-abc', slug: 'test-slug', org_id: 'org-abc', current_build_version: 'v5',
      })
      .mockResolvedValueOnce(null); // no subscription

    const result = await resolveSite(env as any, db, `test-slug${DOMAINS.SITES_SUFFIX}`);

    expect(result).not.toBeNull();
    expect(result!.slug).toBe('test-slug');
    expect(result!.site_id).toBe('site-abc');
  });

  it('looks up custom domain in hostnames table', async () => {
    mockQueryOne
      // hostnames table
      .mockResolvedValueOnce({ site_id: 'site-custom', org_id: 'org-custom' })
      // sites table
      .mockResolvedValueOnce({ slug: 'custom-slug', current_build_version: 'v3' })
      // subscriptions
      .mockResolvedValueOnce({ plan: 'paid', status: 'active' });

    const result = await resolveSite(env as any, db, 'www.custom-domain.com');

    expect(result).toEqual({
      site_id: 'site-custom',
      slug: 'custom-slug',
      org_id: 'org-custom',
      current_build_version: 'v3',
      plan: 'paid',
    });
  });

  it('returns plan=paid when subscription is paid and active', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'site-p', slug: 'paid-site', org_id: 'org-p', current_build_version: 'v1' })
      .mockResolvedValueOnce({ plan: 'paid', status: 'active' });

    const result = await resolveSite(env as any, db, `paid-site${DOMAINS.SITES_SUFFIX}`);

    expect(result!.plan).toBe('paid');
  });

  it('returns plan=free when no subscription exists', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'site-f', slug: 'free-site', org_id: 'org-f', current_build_version: 'v1' })
      .mockResolvedValueOnce(null);

    const result = await resolveSite(env as any, db, `free-site${DOMAINS.SITES_SUFFIX}`);

    expect(result!.plan).toBe('free');
  });

  it('returns plan=free when subscription exists but is not active', async () => {
    mockQueryOne
      .mockResolvedValueOnce({
        id: 'site-i', slug: 'inactive-site', org_id: 'org-i', current_build_version: 'v1',
      })
      .mockResolvedValueOnce({ plan: 'paid', status: 'canceled' });

    const result = await resolveSite(env as any, db, `inactive-site${DOMAINS.SITES_SUFFIX}`);

    expect(result!.plan).toBe('free');
  });

  it('returns null when site not found', async () => {
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await resolveSite(env as any, db, `nonexistent${DOMAINS.SITES_SUFFIX}`);

    expect(result).toBeNull();
  });

  it('caches resolved site in KV with 60-second TTL', async () => {
    mockQueryOne
      .mockResolvedValueOnce({ id: 'site-c', slug: 'cached-site', org_id: 'org-c', current_build_version: 'v1' })
      .mockResolvedValueOnce({ plan: 'paid', status: 'active' });

    await resolveSite(env as any, db, `cached-site${DOMAINS.SITES_SUFFIX}`);

    expect(env.CACHE_KV.put).toHaveBeenCalledWith(
      `host:cached-site${DOMAINS.SITES_SUFFIX}`,
      expect.any(String),
      { expirationTtl: 60 },
    );

    // Verify the cached value is correct JSON
    const cachedJson = JSON.parse((env.CACHE_KV.put as jest.Mock).mock.calls[0][1]);
    expect(cachedJson.slug).toBe('cached-site');
    expect(cachedJson.plan).toBe('paid');
  });

  it('returns null for unknown custom domain', async () => {
    // hostnames lookup returns null
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await resolveSite(env as any, db, 'unknown.example.com');

    expect(result).toBeNull();
    expect(env.CACHE_KV.put).not.toHaveBeenCalled();
  });

  it('handles DB query errors gracefully', async () => {
    // dbQueryOne returns null on error (it catches internally)
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await resolveSite(env as any, db, `broken${DOMAINS.SITES_SUFFIX}`);

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// serveSiteFromR2
// ---------------------------------------------------------------------------

describe('serveSiteFromR2', () => {
  let env: ReturnType<typeof createMockEnv>;

  beforeEach(() => {
    jest.clearAllMocks();
    env = createMockEnv();
  });

  it('returns file from R2 with correct content type for .html', async () => {
    const r2Obj = createMockR2Object(SAMPLE_HTML);
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ plan: 'paid' });
    const response = await serveSiteFromR2(env as any, site, '/page.html');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
  });

  it('returns file from R2 with correct content type for .css', async () => {
    const cssContent = 'body { color: red; }';
    const r2Obj = createMockR2Object(cssContent);
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ plan: 'paid' });
    const response = await serveSiteFromR2(env as any, site, '/styles.css');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/css');
  });

  it('returns file from R2 with correct content type for .js', async () => {
    const jsContent = 'console.log("hello");';
    const r2Obj = createMockR2Object(jsContent);
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ plan: 'paid' });
    const response = await serveSiteFromR2(env as any, site, '/app.js');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/javascript');
  });

  it('returns file from R2 with correct content type for .png', async () => {
    const r2Obj = createMockR2Object('PNG_BINARY_DATA');
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ plan: 'paid' });
    const response = await serveSiteFromR2(env as any, site, '/logo.png');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
  });

  it('falls back to index.html for paths without extensions (SPA)', async () => {
    const indexHtml = createMockR2Object(SAMPLE_HTML);
    (env.SITES_BUCKET.get as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(indexHtml);

    const site = makeSite({ plan: 'paid' });
    const response = await serveSiteFromR2(env as any, site, '/about/team');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(env.SITES_BUCKET.get).toHaveBeenCalledTimes(2);
    expect(env.SITES_BUCKET.get).toHaveBeenNthCalledWith(2, `sites/my-site/v1/index.html`);
  });

  it('returns 404 when file not found', async () => {
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(null);

    const site = makeSite();
    const response = await serveSiteFromR2(env as any, site, '/missing.css');

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toBe('Not Found');
  });

  it('returns 404 when SPA fallback also not found', async () => {
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const site = makeSite();
    const response = await serveSiteFromR2(env as any, site, '/dashboard');

    expect(response.status).toBe(404);
  });

  it('injects top bar for unpaid site HTML responses', async () => {
    const r2Obj = createMockR2Object(SAMPLE_HTML);
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ plan: 'free' });
    const response = await serveSiteFromR2(env as any, site, '/index.html');

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('ps-topbar');
    expect(html).toContain('Project Sites');
    expect(html).toContain('<h1>Hello</h1>');
    const bodyIndex = html.indexOf('<body>');
    const topBarIndex = html.indexOf('ps-topbar');
    expect(topBarIndex).toBeGreaterThan(bodyIndex);
  });

  it('does NOT inject top bar for paid site HTML responses', async () => {
    const r2Obj = createMockR2Object(SAMPLE_HTML);
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ plan: 'paid' });
    const response = await serveSiteFromR2(env as any, site, '/index.html');

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain('ps-topbar');
    expect(body).not.toContain('Project Sites Top Bar');
  });

  it('does NOT inject top bar for non-HTML responses (CSS, JS)', async () => {
    const cssContent = 'body { margin: 0; }';
    const r2Obj = createMockR2Object(cssContent);
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ plan: 'free' });
    const response = await serveSiteFromR2(env as any, site, '/styles.css');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/css');
  });

  it('serves index.html for root path /', async () => {
    const r2Obj = createMockR2Object(SAMPLE_HTML);
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ plan: 'paid' });
    const response = await serveSiteFromR2(env as any, site, '/');

    expect(response.status).toBe(200);
    expect(env.SITES_BUCKET.get).toHaveBeenCalledWith('sites/my-site/v1/index.html');
  });

  it('constructs correct R2 path with slug and version', async () => {
    const r2Obj = createMockR2Object('data');
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ slug: 'acme-corp', current_build_version: 'v42' });
    await serveSiteFromR2(env as any, site, '/assets/logo.svg');

    expect(env.SITES_BUCKET.get).toHaveBeenCalledWith('sites/acme-corp/v42/assets/logo.svg');
  });

  it('uses "latest" as version when current_build_version is null', async () => {
    const r2Obj = createMockR2Object('data');
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ current_build_version: null });
    await serveSiteFromR2(env as any, site, '/file.txt');

    expect(env.SITES_BUCKET.get).toHaveBeenCalledWith('sites/my-site/latest/file.txt');
  });

  it('sets cache-control and X-Site-Slug headers', async () => {
    const r2Obj = createMockR2Object(SAMPLE_HTML);
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ slug: 'header-test', plan: 'paid' });
    const response = await serveSiteFromR2(env as any, site, '/page.html');

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=3600');
    expect(response.headers.get('X-Site-Slug')).toBe('header-test');
  });

  it('returns correct content type for .json files', async () => {
    const r2Obj = createMockR2Object('{"key":"value"}');
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ plan: 'paid' });
    const response = await serveSiteFromR2(env as any, site, '/data.json');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
  });

  it('returns application/octet-stream for unknown file extensions', async () => {
    const r2Obj = createMockR2Object('binary data');
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ plan: 'paid' });
    const response = await serveSiteFromR2(env as any, site, '/archive.xyz');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('injects top bar with correct slug in upgrade link for unpaid HTML', async () => {
    const r2Obj = createMockR2Object(SAMPLE_HTML);
    (env.SITES_BUCKET.get as jest.Mock).mockResolvedValue(r2Obj);

    const site = makeSite({ slug: 'joe-pizza', plan: 'free' });
    const response = await serveSiteFromR2(env as any, site, '/index.html');

    const html = await response.text();
    expect(html).toContain('upgrade=joe-pizza');
    expect(html).toContain(`https://${DOMAINS.SITES_BASE}`);
  });

  it('injects top bar for SPA fallback on unpaid sites', async () => {
    const indexHtml = createMockR2Object(SAMPLE_HTML);
    (env.SITES_BUCKET.get as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(indexHtml);

    const site = makeSite({ plan: 'free' });
    const response = await serveSiteFromR2(env as any, site, '/some/route');

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('ps-topbar');
  });
});
