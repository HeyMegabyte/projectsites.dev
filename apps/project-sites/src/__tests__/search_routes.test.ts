import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { search } from '../routes/search.js';

/**
 * Integration tests for the search routes.
 *
 * Covers:
 *   GET  /api/search/businesses   - Google Places proxy
 *   GET  /api/sites/lookup        - site existence check
 *   POST /api/sites/create-from-search - site creation + workflow enqueue
 *
 * Global fetch is mocked to intercept Google Places API and Supabase REST calls.
 * QUEUE.send is a jest.fn() mock.
 */

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockQueueSend = jest.fn().mockResolvedValue(undefined);

const mockEnv = {
  GOOGLE_PLACES_API_KEY: 'test-google-key',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  SUPABASE_ANON_KEY: 'test-anon-key',
  ENVIRONMENT: 'test',
  QUEUE: { send: mockQueueSend },
} as unknown as Env;

// ─── App setup ──────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env; Variables: Variables }>();
app.onError(errorHandler);
app.route('/', search);

function makeRequest(path: string, options?: RequestInit) {
  return app.request(path, options, mockEnv);
}

/**
 * Helper to build a Hono app that pre-sets context variables (e.g. orgId, userId).
 * Used for authenticated endpoints like POST /api/sites/create-from-search.
 */
function makeAuthenticatedApp(vars: Partial<Variables> = {}) {
  const authedApp = new Hono<{ Bindings: Env; Variables: Variables }>();
  authedApp.onError(errorHandler);
  authedApp.use('*', async (c, next) => {
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  authedApp.route('/', search);
  return authedApp;
}

// ─── Fetch interception ─────────────────────────────────────────────────────

const originalFetch = global.fetch;
let mockFetch: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockFetch = jest.fn();
  global.fetch = mockFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ─── Google Places response helpers ─────────────────────────────────────────

function makePlacesResponse(
  places: Array<{
    id: string;
    name: string;
    address: string;
    types?: string[];
  }>,
) {
  return {
    places: places.map((p) => ({
      id: p.id,
      displayName: { text: p.name, languageCode: 'en' },
      formattedAddress: p.address,
      types: p.types ?? ['establishment'],
    })),
  };
}

function makeSupabaseResponse(data: unknown[], status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/search/businesses
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/search/businesses', () => {
  it('returns 400 when q parameter is missing', async () => {
    const res = await makeRequest('/api/search/businesses');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('Missing required query parameter: q');
  });

  it('returns 400 when q parameter is empty', async () => {
    const res = await makeRequest('/api/search/businesses?q=');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('Missing required query parameter: q');
  });

  it('returns business results from Google Places API', async () => {
    const placesPayload = makePlacesResponse([
      { id: 'place_1', name: 'Coffee House', address: '123 Main St' },
      { id: 'place_2', name: 'Tea Room', address: '456 Oak Ave', types: ['cafe', 'food'] },
      { id: 'place_3', name: 'Bakery', address: '789 Elm Blvd' },
    ]);

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(placesPayload), { status: 200 }));

    const res = await makeRequest('/api/search/businesses?q=coffee+shops');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(3);

    expect(body.data[0]).toEqual({
      place_id: 'place_1',
      name: 'Coffee House',
      address: '123 Main St',
      types: ['establishment'],
    });
    expect(body.data[1]).toEqual({
      place_id: 'place_2',
      name: 'Tea Room',
      address: '456 Oak Ave',
      types: ['cafe', 'food'],
    });
    expect(body.data[2]).toEqual({
      place_id: 'place_3',
      name: 'Bakery',
      address: '789 Elm Blvd',
      types: ['establishment'],
    });

    // Verify the Google API was called correctly
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers).toMatchObject({
      'X-Goog-Api-Key': 'test-google-key',
    });
    expect(JSON.parse(calledInit.body as string)).toEqual({ textQuery: 'coffee shops' });
  });

  it('returns max 10 results even if API returns more', async () => {
    const fifteenPlaces = Array.from({ length: 15 }, (_, i) => ({
      id: `place_${i}`,
      name: `Business ${i}`,
      address: `${i} Test St`,
    }));
    const placesPayload = makePlacesResponse(fifteenPlaces);

    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(placesPayload), { status: 200 }));

    const res = await makeRequest('/api/search/businesses?q=lots+of+results');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(10);
    // First and last in the truncated set
    expect(body.data[0].place_id).toBe('place_0');
    expect(body.data[9].place_id).toBe('place_9');
  });

  it('returns empty array when Google API returns no places', async () => {
    mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

    const res = await makeRequest('/api/search/businesses?q=nonexistent+place');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
  });

  it('handles Google API errors gracefully and returns 400', async () => {
    mockFetch.mockResolvedValueOnce(new Response('API key invalid', { status: 403 }));

    const res = await makeRequest('/api/search/businesses?q=test');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('Google Places API error');
    expect(body.error.message).toContain('API key invalid');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/sites/lookup
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/sites/lookup', () => {
  /**
   * Helper: configure mockFetch to handle Supabase REST calls.
   * The Supabase client created by createServiceClient uses globalThis.fetch,
   * so our mocked global.fetch handles these calls.
   */
  function setupSupabaseFetch(responseData: unknown[], status = 200) {
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('supabase.co')) {
        return makeSupabaseResponse(responseData, status);
      }
      return new Response('Not Found', { status: 404 });
    });
  }

  it('returns 400 when neither place_id nor slug is provided', async () => {
    const res = await makeRequest('/api/sites/lookup');

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('Missing required query parameter: place_id or slug');
  });

  it('returns exists: false when no site is found by place_id', async () => {
    setupSupabaseFetch([]);

    const res = await makeRequest('/api/sites/lookup?place_id=ChIJ_unknown');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({ exists: false });
  });

  it('returns exists: true with site details when found by place_id', async () => {
    setupSupabaseFetch([
      {
        id: 'site-uuid-1',
        slug: 'joes-pizza',
        status: 'active',
        current_build_version: 'v3',
      },
    ]);

    const res = await makeRequest('/api/sites/lookup?place_id=ChIJ_abc123');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      exists: true,
      site_id: 'site-uuid-1',
      slug: 'joes-pizza',
      status: 'active',
      has_build: true,
    });

    // Verify the Supabase query includes the place_id filter
    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('google_place_id=eq.ChIJ_abc123');
    expect(calledUrl).toContain('deleted_at=is.null');
  });

  it('returns exists: true when found by slug', async () => {
    setupSupabaseFetch([
      {
        id: 'site-uuid-2',
        slug: 'bobs-bakery',
        status: 'active',
        current_build_version: 'v1',
      },
    ]);

    const res = await makeRequest('/api/sites/lookup?slug=bobs-bakery');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      exists: true,
      site_id: 'site-uuid-2',
      slug: 'bobs-bakery',
      status: 'active',
      has_build: true,
    });

    // Verify the Supabase query uses slug filter
    const calledUrl = mockFetch.mock.calls[0]![0] as string;
    expect(calledUrl).toContain('slug=eq.bobs-bakery');
  });

  it('correctly reports has_build: true when current_build_version is set', async () => {
    setupSupabaseFetch([
      {
        id: 'site-uuid-3',
        slug: 'built-site',
        status: 'active',
        current_build_version: 'v5',
      },
    ]);

    const res = await makeRequest('/api/sites/lookup?place_id=ChIJ_built');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.has_build).toBe(true);
    expect(body.data.exists).toBe(true);
  });

  it('correctly reports has_build: false when current_build_version is null', async () => {
    setupSupabaseFetch([
      {
        id: 'site-uuid-4',
        slug: 'pending-site',
        status: 'queued',
        current_build_version: null,
      },
    ]);

    const res = await makeRequest('/api/sites/lookup?place_id=ChIJ_pending');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.has_build).toBe(false);
    expect(body.data.exists).toBe(true);
    expect(body.data.status).toBe('queued');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/sites/create-from-search
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/sites/create-from-search', () => {
  /**
   * Helper: configure mockFetch to handle Supabase REST calls for site creation
   * and audit log writing.
   */
  function setupSupabaseFetchForCreate() {
    mockFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (typeof url === 'string' && url.includes('supabase.co')) {
        // Both site insert and audit log insert return 201
        return new Response(JSON.stringify([{}]), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });
  }

  it('returns 401 when not authenticated (no orgId)', async () => {
    // Use the default app (no auth middleware setting orgId)
    const res = await makeRequest('/api/sites/create-from-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business_name: 'Test Biz' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('Must be authenticated');
  });

  it('returns 400 when business_name is missing', async () => {
    const authedApp = makeAuthenticatedApp({
      orgId: 'org-123',
      userId: 'user-456',
    });

    const res = await authedApp.request(
      '/api/sites/create-from-search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      mockEnv,
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toContain('Missing required field: business_name');
  });

  it('creates site, enqueues workflow, and returns 201 with site_id and slug', async () => {
    setupSupabaseFetchForCreate();

    const authedApp = makeAuthenticatedApp({
      orgId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      requestId: 'req-789',
    });

    const requestBody = {
      business_name: "Joe's Pizza Palace",
      business_address: '100 Broadway, New York',
      google_place_id: 'ChIJ_joes_pizza',
      additional_context: 'Italian restaurant, family owned',
    };

    const res = await authedApp.request(
      '/api/sites/create-from-search',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
      mockEnv,
    );

    expect(res.status).toBe(201);
    const body = await res.json();

    // Verify response shape
    expect(body.data).toHaveProperty('site_id');
    expect(body.data).toHaveProperty('slug');
    expect(body.data.status).toBe('queued');

    // Verify slug generation: lowercase, hyphens, no leading/trailing hyphens
    expect(body.data.slug).toBe('joe-s-pizza-palace');

    // Verify site_id is a UUID-like string
    expect(typeof body.data.site_id).toBe('string');
    expect(body.data.site_id.length).toBeGreaterThan(0);

    // Verify workflow queue was called with correct payload
    expect(mockQueueSend).toHaveBeenCalledTimes(1);
    expect(mockQueueSend).toHaveBeenCalledWith(
      expect.objectContaining({
        job_name: 'generate_site',
        site_id: body.data.site_id,
        business_name: "Joe's Pizza Palace",
        google_place_id: 'ChIJ_joes_pizza',
        additional_context: 'Italian restaurant, family owned',
      }),
    );

    // Verify Supabase was called at least twice (site insert + audit log)
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call: site insert
    const [siteUrl, siteInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(siteUrl).toContain('/rest/v1/sites');
    expect(siteInit.method).toBe('POST');
    const siteBody = JSON.parse(siteInit.body as string);
    expect(siteBody.business_name).toBe("Joe's Pizza Palace");
    expect(siteBody.org_id).toBe('00000000-0000-4000-8000-000000000001');
    expect(siteBody.status).toBe('queued');
    expect(siteBody.google_place_id).toBe('ChIJ_joes_pizza');
    expect(siteBody.business_address).toBe('100 Broadway, New York');

    // Second call: audit log insert
    const [auditUrl, auditInit] = mockFetch.mock.calls[1] as [string, RequestInit];
    expect(auditUrl).toContain('/rest/v1/audit_logs');
    expect(auditInit.method).toBe('POST');
  });
});
