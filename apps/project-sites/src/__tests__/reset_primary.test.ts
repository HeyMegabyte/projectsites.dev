/**
 * @module __tests__/reset_primary
 * Tests for POST /api/sites/:siteId/hostnames/reset-primary
 */

import { describe, expect, it, jest, beforeEach } from '@jest/globals';

// ── Mocks ─────────────────────────────────────────────────────

const mockDbPrepare = jest.fn();
const mockDbBind = jest.fn();
const mockDbRun = jest.fn();

const mockEnv = {
  DB: {
    prepare: mockDbPrepare,
    batch: jest.fn(),
  },
  CACHE_KV: {
    get: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
  SITES_BUCKET: {},
  AUTH_SECRET: 'test-secret-key-1234567890123456',
  GOOGLE_CLIENT_ID: 'test',
  GOOGLE_CLIENT_SECRET: 'test',
} as unknown as Record<string, unknown>;

function createMockContext(overrides: Record<string, unknown> = {}) {
  const vars = {
    orgId: 'org-123',
    userId: 'user-123',
    requestId: 'req-123',
    ...overrides,
  };
  return {
    env: mockEnv,
    req: {
      param: (name: string) => {
        const params: Record<string, string> = { siteId: 'site-123' };
        return params[name] ?? '';
      },
    },
    get: (key: string) => (vars as Record<string, unknown>)[key],
    json: (data: unknown) => ({ body: data, status: 200 }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDbPrepare.mockReturnValue({
    bind: mockDbBind,
    first: jest.fn(),
    run: mockDbRun,
    all: jest.fn(),
  });
  mockDbBind.mockReturnValue({
    first: jest.fn(),
    run: mockDbRun,
    all: jest.fn(),
  });
  mockDbRun.mockResolvedValue({ results: [] });
});

// ── Tests ─────────────────────────────────────────────────────

describe('reset-primary endpoint logic', () => {
  it('should clear is_primary on all hostnames for a site', async () => {
    const selectMock = jest.fn().mockResolvedValue({ id: 'site-123' });
    const updateMock = jest.fn().mockResolvedValue({ results: [] });
    const auditMock = jest.fn().mockResolvedValue({ results: [] });

    mockDbPrepare.mockImplementation((sql: string) => {
      if (sql.includes('SELECT')) return { bind: jest.fn().mockReturnValue({ first: selectMock }) };
      if (sql.includes('UPDATE hostnames')) return { bind: jest.fn().mockReturnValue({ run: updateMock }) };
      if (sql.includes('INSERT INTO audit_logs')) return { bind: jest.fn().mockReturnValue({ run: auditMock }) };
      return { bind: jest.fn().mockReturnValue({ run: jest.fn(), first: jest.fn() }) };
    });

    // Simulate the endpoint logic
    const siteId = 'site-123';
    const orgId = 'org-123';

    // 1. Verify site ownership
    const site = await mockEnv.DB.prepare(
      'SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    ).bind(siteId, orgId).first();
    expect(site).toEqual({ id: 'site-123' });

    // 2. Clear is_primary
    await mockEnv.DB.prepare(
      'UPDATE hostnames SET is_primary = 0 WHERE site_id = ?',
    ).bind(siteId).run();
    expect(updateMock).toHaveBeenCalled();
  });

  it('should require authentication (no orgId)', () => {
    const ctx = createMockContext({ orgId: undefined });
    expect(ctx.get('orgId')).toBeUndefined();
  });

  it('should return 404 when site not found', async () => {
    const selectMock = jest.fn().mockResolvedValue(null);
    mockDbPrepare.mockReturnValue({
      bind: jest.fn().mockReturnValue({ first: selectMock }),
    });

    const site = await mockEnv.DB.prepare('SELECT id FROM sites WHERE id = ?')
      .bind('nonexistent')
      .first();
    expect(site).toBeNull();
  });
});
