jest.mock('../services/db.js', () => ({ supabaseQuery: jest.fn() }));

import { supabaseQuery } from '../services/db.js';
import { writeAuditLog, getAuditLogs } from '../services/audit.js';
import { createAuditLogSchema } from '@project-sites/shared';

const mockQuery = supabaseQuery as jest.MockedFunction<typeof supabaseQuery>;

const mockDb = {
  url: 'https://test.supabase.co',
  headers: {
    apikey: 'test-key',
    Authorization: 'Bearer test-key',
    'Content-Type': 'application/json',
  },
  fetch: jest.fn(),
} as any;

const validEntry = {
  org_id: crypto.randomUUID(),
  actor_id: crypto.randomUUID(),
  action: 'auth.login',
  target_type: 'session',
  target_id: crypto.randomUUID(),
  request_id: crypto.randomUUID(),
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── writeAuditLog ───────────────────────────────────────────

describe('writeAuditLog', () => {
  it('writes valid audit entry to DB', async () => {
    mockQuery.mockResolvedValue({ data: null, error: null, status: 201 });

    await writeAuditLog(mockDb, validEntry);

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'audit_logs',
      expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          org_id: validEntry.org_id,
          action: validEntry.action,
        }),
      }),
    );
  });

  it('does not throw on DB failure (logs error instead)', async () => {
    mockQuery.mockResolvedValue({ data: null, error: 'DB write failed', status: 500 });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(writeAuditLog(mockDb, validEntry)).resolves.not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('validates entry with createAuditLogSchema', async () => {
    mockQuery.mockResolvedValue({ data: null, error: null, status: 201 });

    await writeAuditLog(mockDb, validEntry);

    // Verify the body passed to supabaseQuery matches the schema-parsed output
    const call = mockQuery.mock.calls[0];
    const body = (call[2] as any).body;
    const parsed = createAuditLogSchema.parse(validEntry);
    expect(body).toEqual(
      expect.objectContaining({
        org_id: parsed.org_id,
        actor_id: parsed.actor_id,
        action: parsed.action,
        target_type: parsed.target_type,
        target_id: parsed.target_id,
        request_id: parsed.request_id,
      }),
    );
  });

  it('throws on invalid entry (schema validation failure)', async () => {
    const invalidEntry = {
      // Missing required org_id
      action: 'auth.login',
      actor_id: null,
    } as any;

    await expect(writeAuditLog(mockDb, invalidEntry)).rejects.toThrow();
  });

  it('adds created_at timestamp', async () => {
    mockQuery.mockResolvedValue({ data: null, error: null, status: 201 });

    await writeAuditLog(mockDb, validEntry);

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'audit_logs',
      expect.objectContaining({
        body: expect.objectContaining({
          created_at: expect.any(String),
        }),
      }),
    );

    const call = mockQuery.mock.calls[0];
    const body = (call[2] as any).body;
    // Verify created_at is a valid ISO date
    expect(new Date(body.created_at).toISOString()).toBe(body.created_at);
  });
});

// ─── getAuditLogs ────────────────────────────────────────────

describe('getAuditLogs', () => {
  const orgId = crypto.randomUUID();

  it('returns data array on success', async () => {
    const logs = [
      { id: 'log-1', action: 'auth.login' },
      { id: 'log-2', action: 'billing.changed' },
    ];
    mockQuery.mockResolvedValue({ data: logs, error: null, status: 200 });

    const result = await getAuditLogs(mockDb, orgId);

    expect(result.data).toEqual(logs);
    expect(result.error).toBeNull();
  });

  it('returns empty array when no logs', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null, status: 200 });

    const result = await getAuditLogs(mockDb, orgId);

    expect(result.data).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('uses default limit=50 and offset=0', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null, status: 200 });

    await getAuditLogs(mockDb, orgId);

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'audit_logs',
      expect.objectContaining({
        query: expect.stringContaining('limit=50'),
      }),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'audit_logs',
      expect.objectContaining({
        query: expect.stringContaining('offset=0'),
      }),
    );
  });

  it('passes custom limit and offset', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null, status: 200 });

    await getAuditLogs(mockDb, orgId, { limit: 10, offset: 20 });

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'audit_logs',
      expect.objectContaining({
        query: expect.stringContaining('limit=10'),
      }),
    );
    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      'audit_logs',
      expect.objectContaining({
        query: expect.stringContaining('offset=20'),
      }),
    );
  });

  it('returns error when DB fails', async () => {
    mockQuery.mockResolvedValue({ data: null, error: 'Query failed', status: 500 });

    const result = await getAuditLogs(mockDb, orgId);

    expect(result.data).toEqual([]);
    expect(result.error).toBe('Query failed');
  });
});
