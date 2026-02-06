jest.mock('../services/db.js', () => ({
  supabaseQuery: jest.fn(),
}));

import { supabaseQuery } from '../services/db.js';
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

const mockEnv = {
  CF_API_TOKEN: 'test-cf-token',
  CF_ZONE_ID: 'test-zone-id',
} as any;

const mockDb = {
  url: 'https://test.supabase.co',
  headers: {},
  fetch: jest.fn(),
} as any;

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn();
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// createCustomHostname
// ---------------------------------------------------------------------------
describe('createCustomHostname', () => {
  it('returns cf_id, status, and ssl_status on success', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: { id: 'cf-host-123', status: 'pending', ssl: { status: 'pending_validation' } },
      }),
      text: async () => '',
    });

    const result = await createCustomHostname(mockEnv, 'app.example.com');

    expect(result).toEqual({
      cf_id: 'cf-host-123',
      status: 'pending',
      ssl_status: 'pending_validation',
    });
  });

  it('throws badRequest on CF API failure', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
      text: async () => 'Zone not found',
    });

    const err = await createCustomHostname(mockEnv, 'bad.example.com').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toMatch(/Failed to create custom hostname/);
    expect((err as AppError).statusCode).toBe(400);
  });

  it('sends correct auth header and body', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: { id: 'cf-1', status: 'pending', ssl: { status: 'pending_validation' } },
      }),
      text: async () => '',
    });

    await createCustomHostname(mockEnv, 'test.example.com');

    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/zones/test-zone-id/custom_hostnames`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-cf-token',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({
          hostname: 'test.example.com',
          ssl: {
            method: 'http',
            type: 'dv',
            settings: { min_tls_version: '1.2' },
          },
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// checkHostnameStatus
// ---------------------------------------------------------------------------
describe('checkHostnameStatus', () => {
  it('returns status, ssl_status, and empty verification_errors', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: { status: 'active', ssl: { status: 'active' } },
      }),
      text: async () => '',
    });

    const result = await checkHostnameStatus(mockEnv, 'cf-host-123');

    expect(result).toEqual({
      status: 'active',
      ssl_status: 'active',
      verification_errors: [],
    });
  });

  it('returns verification_errors array when present', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          status: 'pending',
          ssl: { status: 'pending_validation' },
          verification_errors: ['CNAME not found', 'DNS timeout'],
        },
      }),
      text: async () => '',
    });

    const result = await checkHostnameStatus(mockEnv, 'cf-host-456');

    expect(result.verification_errors).toEqual(['CNAME not found', 'DNS timeout']);
  });

  it('throws notFound when hostname not found', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'Not found',
    });

    const err = await checkHostnameStatus(mockEnv, 'cf-nonexistent').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toMatch(/Custom hostname not found/);
    expect((err as AppError).statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// deleteCustomHostname
// ---------------------------------------------------------------------------
describe('deleteCustomHostname', () => {
  it('succeeds with no return value', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: { id: 'cf-host-123' } }),
      text: async () => '',
    });

    const result = await deleteCustomHostname(mockEnv, 'cf-host-123');

    expect(result).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/zones/test-zone-id/custom_hostnames/cf-host-123`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-cf-token',
        }),
      }),
    );
  });

  it('ignores 404 errors', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => 'Not found',
    });

    await expect(deleteCustomHostname(mockEnv, 'cf-already-gone')).resolves.toBeUndefined();
  });

  it('throws on other errors', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'Internal Server Error',
    });

    const err = await deleteCustomHostname(mockEnv, 'cf-host-err').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).message).toMatch(/Failed to delete custom hostname/);
    expect((err as AppError).statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// provisionFreeDomain
// ---------------------------------------------------------------------------
describe('provisionFreeDomain', () => {
  it('returns hostname in format slug-sites.megabyte.space', async () => {
    mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: { id: 'cf-free-1', status: 'pending', ssl: { status: 'pending_validation' } },
      }),
      text: async () => '',
    });

    mockQuery.mockResolvedValueOnce({ data: null, error: null, status: 201 });

    const result = await provisionFreeDomain(mockDb, mockEnv, {
      org_id: 'org-1',
      site_id: 'site-1',
      slug: 'my-app',
    });

    expect(result.hostname).toBe('my-app-sites.megabyte.space');
    expect(result.status).toBe('pending');
  });

  it('returns existing hostname if already exists', async () => {
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
      hostname: 'existing-app-sites.megabyte.space',
      status: 'active',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('creates new hostname when none exists', async () => {
    mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: { id: 'cf-new-1', status: 'active', ssl: { status: 'active' } },
      }),
      text: async () => '',
    });

    mockQuery.mockResolvedValueOnce({ data: null, error: null, status: 201 });

    const result = await provisionFreeDomain(mockDb, mockEnv, {
      org_id: 'org-2',
      site_id: 'site-2',
      slug: 'new-app',
    });

    expect(result).toEqual({
      hostname: 'new-app-sites.megabyte.space',
      status: 'active',
    });

    // Verify CF API was called
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Verify DB insert was called
    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenLastCalledWith(
      mockDb,
      'hostnames',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          org_id: 'org-2',
          site_id: 'site-2',
          hostname: 'new-app-sites.megabyte.space',
          type: 'free_subdomain',
          status: 'active',
          cf_custom_hostname_id: 'cf-new-1',
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// provisionCustomDomain
// ---------------------------------------------------------------------------
describe('provisionCustomDomain', () => {
  it('returns hostname and status on success', async () => {
    // Domain limit check
    mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });
    // Existing hostname check
    mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: { id: 'cf-custom-1', status: 'pending', ssl: { status: 'pending_validation' } },
      }),
      text: async () => '',
    });

    // DB insert
    mockQuery.mockResolvedValueOnce({ data: null, error: null, status: 201 });

    const result = await provisionCustomDomain(mockDb, mockEnv, {
      org_id: 'org-1',
      site_id: 'site-1',
      hostname: 'app.example.com',
    });

    expect(result).toEqual({
      hostname: 'app.example.com',
      status: 'pending',
    });
  });

  it('throws conflict when max domains reached', async () => {
    const fiveDomains = Array.from({ length: 5 }, (_, i) => ({ id: `dom-${i}` }));
    mockQuery.mockResolvedValueOnce({ data: fiveDomains, error: null, status: 200 });

    await expect(
      provisionCustomDomain(mockDb, mockEnv, {
        org_id: 'org-full',
        site_id: 'site-1',
        hostname: 'sixth.example.com',
      }),
    ).rejects.toThrow(/Maximum custom domains/);
  });

  it('throws conflict when hostname already registered', async () => {
    // Domain limit check: under limit
    mockQuery.mockResolvedValueOnce({ data: [{ id: 'dom-1' }], error: null, status: 200 });
    // Existing hostname check: already taken
    mockQuery.mockResolvedValueOnce({
      data: [{ id: 'existing-host' }],
      error: null,
      status: 200,
    });

    await expect(
      provisionCustomDomain(mockDb, mockEnv, {
        org_id: 'org-1',
        site_id: 'site-1',
        hostname: 'taken.example.com',
      }),
    ).rejects.toThrow(/already registered/);
  });

  it('creates CF hostname and DB record', async () => {
    mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });
    mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: { id: 'cf-custom-2', status: 'active', ssl: { status: 'active' } },
      }),
      text: async () => '',
    });

    mockQuery.mockResolvedValueOnce({ data: null, error: null, status: 201 });

    await provisionCustomDomain(mockDb, mockEnv, {
      org_id: 'org-3',
      site_id: 'site-3',
      hostname: 'custom.example.com',
    });

    // CF API called with hostname
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('custom_hostnames'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('custom.example.com'),
      }),
    );

    // DB insert with correct fields
    expect(mockQuery).toHaveBeenCalledTimes(3);
    expect(mockQuery).toHaveBeenLastCalledWith(
      mockDb,
      'hostnames',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          org_id: 'org-3',
          site_id: 'site-3',
          hostname: 'custom.example.com',
          type: 'custom_cname',
          status: 'active',
          cf_custom_hostname_id: 'cf-custom-2',
          ssl_status: 'active',
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getSiteHostnames
// ---------------------------------------------------------------------------
describe('getSiteHostnames', () => {
  it('returns array of hostnames', async () => {
    const hostnames = [
      {
        id: 'h1',
        hostname: 'app-sites.megabyte.space',
        type: 'free_subdomain',
        status: 'active',
        ssl_status: 'active',
      },
      {
        id: 'h2',
        hostname: 'custom.example.com',
        type: 'custom_cname',
        status: 'pending',
        ssl_status: 'pending_validation',
      },
    ];
    mockQuery.mockResolvedValueOnce({ data: hostnames, error: null, status: 200 });

    const result = await getSiteHostnames(mockDb, 'site-1');

    expect(result).toEqual(hostnames);
    expect(result).toHaveLength(2);
  });

  it('returns empty array when none found', async () => {
    mockQuery.mockResolvedValueOnce({ data: null, error: null, status: 200 });

    const result = await getSiteHostnames(mockDb, 'site-empty');

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getHostnameByDomain
// ---------------------------------------------------------------------------
describe('getHostnameByDomain', () => {
  it('returns hostname record when found', async () => {
    const record = {
      id: 'h1',
      site_id: 'site-1',
      org_id: 'org-1',
      type: 'custom_cname',
      status: 'active',
    };
    mockQuery.mockResolvedValueOnce({ data: [record], error: null, status: 200 });

    const result = await getHostnameByDomain(mockDb, 'custom.example.com');

    expect(result).toEqual(record);
  });

  it('returns null when not found', async () => {
    mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });

    const result = await getHostnameByDomain(mockDb, 'nonexistent.example.com');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// verifyPendingHostnames
// ---------------------------------------------------------------------------
describe('verifyPendingHostnames', () => {
  it('returns { verified: 1, failed: 0 } when hostname becomes active', async () => {
    mockQuery.mockResolvedValueOnce({
      data: [
        { id: 'h-pending', cf_custom_hostname_id: 'cf-pending-1', hostname: 'pending.example.com' },
      ],
      error: null,
      status: 200,
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: { status: 'active', ssl: { status: 'active' } },
      }),
      text: async () => '',
    });

    // PATCH update
    mockQuery.mockResolvedValueOnce({ data: null, error: null, status: 200 });

    const result = await verifyPendingHostnames(mockDb, mockEnv);

    expect(result).toEqual({ verified: 1, failed: 0 });

    // Verify PATCH was called with active status
    expect(mockQuery).toHaveBeenLastCalledWith(
      mockDb,
      'hostnames',
      expect.objectContaining({
        method: 'PATCH',
        query: 'id=eq.h-pending',
        body: expect.objectContaining({
          status: 'active',
          ssl_status: 'active',
          verification_errors: null,
        }),
      }),
    );
  });

  it('returns { verified: 0, failed: 1 } when verification errors', async () => {
    mockQuery.mockResolvedValueOnce({
      data: [{ id: 'h-fail', cf_custom_hostname_id: 'cf-fail-1', hostname: 'fail.example.com' }],
      error: null,
      status: 200,
    });

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        result: {
          status: 'pending',
          ssl: { status: 'pending_validation' },
          verification_errors: ['CNAME record missing'],
        },
      }),
      text: async () => '',
    });

    // PATCH update
    mockQuery.mockResolvedValueOnce({ data: null, error: null, status: 200 });

    const result = await verifyPendingHostnames(mockDb, mockEnv);

    expect(result).toEqual({ verified: 0, failed: 1 });

    expect(mockQuery).toHaveBeenLastCalledWith(
      mockDb,
      'hostnames',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.objectContaining({
          status: 'verification_failed',
          verification_errors: ['CNAME record missing'],
        }),
      }),
    );
  });

  it('returns { verified: 0, failed: 0 } when no pending hostnames', async () => {
    mockQuery.mockResolvedValueOnce({ data: [], error: null, status: 200 });

    const result = await verifyPendingHostnames(mockDb, mockEnv);

    expect(result).toEqual({ verified: 0, failed: 0 });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
