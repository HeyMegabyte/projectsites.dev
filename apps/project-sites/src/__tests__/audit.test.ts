jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
}));

import { dbQuery, dbInsert } from '../services/db.js';
import { writeAuditLog, getAuditLogs } from '../services/audit.js';
import { createAuditLogSchema } from '@project-sites/shared';

const mockInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;

const mockDb = {} as D1Database;

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
    mockInsert.mockResolvedValue({ error: null });

    await writeAuditLog(mockDb, validEntry);

    expect(mockInsert).toHaveBeenCalledWith(
      mockDb,
      'audit_logs',
      expect.objectContaining({
        org_id: validEntry.org_id,
        action: validEntry.action,
        actor_id: validEntry.actor_id,
        target_type: validEntry.target_type,
        target_id: validEntry.target_id,
        request_id: validEntry.request_id,
      }),
    );
  });

  it('does not throw on DB failure (logs error instead)', async () => {
    mockInsert.mockResolvedValue({ error: 'DB write failed' });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(writeAuditLog(mockDb, validEntry)).resolves.not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('validates entry with createAuditLogSchema', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await writeAuditLog(mockDb, validEntry);

    // Verify the row passed to dbInsert matches the schema-parsed output
    const call = mockInsert.mock.calls[0];
    const row = call[2] as Record<string, unknown>;
    const parsed = createAuditLogSchema.parse(validEntry);
    expect(row).toEqual(
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

  it('does not throw on invalid entry (silently logs error)', async () => {
    const invalidEntry = {
      // Missing required org_id
      action: 'auth.login',
      actor_id: null,
    } as any;

    // writeAuditLog should never throw — it catches schema validation errors internally
    await expect(writeAuditLog(mockDb, invalidEntry)).resolves.toBeUndefined();
  });

  it('adds created_at timestamp', async () => {
    mockInsert.mockResolvedValue({ error: null });

    await writeAuditLog(mockDb, validEntry);

    expect(mockInsert).toHaveBeenCalledWith(
      mockDb,
      'audit_logs',
      expect.objectContaining({
        created_at: expect.any(String),
      }),
    );

    const call = mockInsert.mock.calls[0];
    const row = call[2] as Record<string, unknown>;
    // Verify created_at is a valid ISO date
    expect(new Date(row.created_at as string).toISOString()).toBe(row.created_at);
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
    mockQuery.mockResolvedValue({ data: logs, error: null });

    const result = await getAuditLogs(mockDb, orgId);

    expect(result.data).toEqual(logs);
    expect(result.error).toBeNull();
  });

  it('returns empty array when no logs', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null });

    const result = await getAuditLogs(mockDb, orgId);

    expect(result.data).toEqual([]);
    expect(result.error).toBeNull();
  });

  it('uses default limit=50 and offset=0', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null });

    await getAuditLogs(mockDb, orgId);

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      expect.stringContaining('LIMIT'),
      expect.arrayContaining([orgId, 50, 0]),
    );
  });

  it('passes custom limit and offset', async () => {
    mockQuery.mockResolvedValue({ data: [], error: null });

    await getAuditLogs(mockDb, orgId, { limit: 10, offset: 20 });

    expect(mockQuery).toHaveBeenCalledWith(
      mockDb,
      expect.stringContaining('LIMIT'),
      expect.arrayContaining([orgId, 10, 20]),
    );
  });

  it('returns error when DB fails', async () => {
    mockQuery.mockResolvedValue({ data: [], error: 'Query failed' });

    const result = await getAuditLogs(mockDb, orgId);

    expect(result.data).toEqual([]);
    expect(result.error).toBe('Query failed');
  });
});
