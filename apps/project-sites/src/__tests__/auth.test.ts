jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

import { dbQuery, dbQueryOne, dbInsert, dbUpdate, dbExecute } from '../services/db.js';
import {
  createMagicLink,
  verifyMagicLink,
  createGoogleOAuthState,
  handleGoogleOAuthCallback,
  createSession,
  getSession,
  revokeSession,
  getUserSessions,
} from '../services/auth.js';
import { AppError } from '@project-sites/shared';

const mockDbQuery = dbQuery as jest.MockedFunction<typeof dbQuery>;
const mockDbQueryOne = dbQueryOne as jest.MockedFunction<typeof dbQueryOne>;
const mockDbInsert = dbInsert as jest.MockedFunction<typeof dbInsert>;
const mockDbUpdate = dbUpdate as jest.MockedFunction<typeof dbUpdate>;
const mockDbExecute = dbExecute as jest.MockedFunction<typeof dbExecute>;

const mockEnv = {
  ENVIRONMENT: 'staging',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  RESEND_API_KEY: 'test-resend-api-key',
} as any;

const mockDb = {} as D1Database;

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  // Default: mock fetch to return 200 for email sends
  global.fetch = jest.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'mock-msg-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

afterEach(() => {
  global.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// createMagicLink
// ---------------------------------------------------------------------------
describe('createMagicLink', () => {
  const input = { email: 'user@example.com' };

  beforeEach(() => {
    mockDbInsert.mockResolvedValue({ error: null });
  });

  it('returns a 64-character hex token', async () => {
    const result = await createMagicLink(mockDb, mockEnv, input);
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns expires_at as an ISO 8601 string', async () => {
    const result = await createMagicLink(mockDb, mockEnv, input);
    expect(() => new Date(result.expires_at).toISOString()).not.toThrow();
    expect(new Date(result.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('calls dbInsert on magic_links table', async () => {
    await createMagicLink(mockDb, mockEnv, input);

    expect(mockDbInsert).toHaveBeenCalledWith(
      mockDb,
      'magic_links',
      expect.objectContaining({
        email: 'user@example.com',
        used: 0,
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// verifyMagicLink
// ---------------------------------------------------------------------------
describe('verifyMagicLink', () => {
  const token = 'a'.repeat(64);
  const input = { token };

  it('returns email when a valid token is found', async () => {
    const futureDate = new Date(Date.now() + 3_600_000).toISOString();
    mockDbQueryOne.mockResolvedValueOnce({
      id: 'link-1',
      email: 'user@example.com',
      redirect_url: null,
      used: 0,
      expires_at: futureDate,
    });
    mockDbUpdate.mockResolvedValueOnce({ error: null, changes: 1 });

    const result = await verifyMagicLink(mockDb, input);
    expect(result.email).toBe('user@example.com');
    expect(result.redirect_url).toBeNull();
  });

  it('throws unauthorized when no matching link is found', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null);

    await expect(verifyMagicLink(mockDb, input)).rejects.toThrow(AppError);

    mockDbQueryOne.mockResolvedValueOnce(null);
    await expect(verifyMagicLink(mockDb, input)).rejects.toThrow('Invalid or expired magic link');
  });

  it('throws unauthorized when the link is expired', async () => {
    const pastDate = new Date(Date.now() - 3_600_000).toISOString();
    mockDbQueryOne.mockResolvedValueOnce({
      id: 'link-2',
      email: 'old@example.com',
      redirect_url: null,
      used: 0,
      expires_at: pastDate,
    });

    await expect(verifyMagicLink(mockDb, input)).rejects.toThrow('Magic link has expired');
  });

  it('marks the link as used after successful verification', async () => {
    const futureDate = new Date(Date.now() + 3_600_000).toISOString();
    mockDbQueryOne.mockResolvedValueOnce({
      id: 'link-3',
      email: 'mark@example.com',
      redirect_url: null,
      used: 0,
      expires_at: futureDate,
    });
    mockDbUpdate.mockResolvedValueOnce({ error: null, changes: 1 });

    await verifyMagicLink(mockDb, input);

    expect(mockDbUpdate).toHaveBeenCalledWith(
      mockDb,
      'magic_links',
      expect.objectContaining({ used: 1 }),
      'id = ?',
      ['link-3'],
    );
  });
});

// ---------------------------------------------------------------------------
// sendEmail fallback behavior
// ---------------------------------------------------------------------------
describe('sendEmail fallback (Resend → SendGrid)', () => {
  const input = { email: 'fallback@example.com' };

  beforeEach(() => {
    mockDbInsert.mockResolvedValue({ error: null });
  });

  it('falls back to SendGrid when Resend returns a non-200 status', async () => {
    const envWithBoth = {
      ...mockEnv,
      RESEND_API_KEY: 'test-resend-key',
      SENDGRID_API_KEY: 'test-sendgrid-key',
    } as any;

    const mockFetch = jest.fn()
      // First call (Resend) → 403 error
      .mockResolvedValueOnce(
        new Response('Domain not verified', { status: 403 }),
      )
      // Second call (SendGrid) → 202 success
      .mockResolvedValueOnce(
        new Response('', { status: 202 }),
      );
    global.fetch = mockFetch;

    const result = await createMagicLink(mockDb, envWithBoth, input);
    expect(result.token).toMatch(/^[0-9a-f]{64}$/);

    // Verify both providers were called
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    expect(mockFetch.mock.calls[1][0]).toBe('https://api.sendgrid.com/v3/mail/send');
  });

  it('uses only Resend when it succeeds', async () => {
    const envWithBoth = {
      ...mockEnv,
      RESEND_API_KEY: 'test-resend-key',
      SENDGRID_API_KEY: 'test-sendgrid-key',
    } as any;

    const mockFetch = jest.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 }),
    );
    global.fetch = mockFetch;

    await createMagicLink(mockDb, envWithBoth, input);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.resend.com/emails');
  });

  it('throws when Resend fails and SendGrid is not configured', async () => {
    const envResendOnly = {
      ...mockEnv,
      RESEND_API_KEY: 'test-resend-key',
    } as any;

    global.fetch = jest.fn().mockResolvedValueOnce(
      new Response('Unauthorized', { status: 401 }),
    );

    await expect(createMagicLink(mockDb, envResendOnly, input)).rejects.toThrow(
      'Failed to send email (status 401)',
    );
  });
});

// ---------------------------------------------------------------------------
// createGoogleOAuthState
// ---------------------------------------------------------------------------
describe('createGoogleOAuthState', () => {
  beforeEach(() => {
    mockDbInsert.mockResolvedValue({ error: null });
  });

  it('returns an authUrl containing accounts.google.com', async () => {
    const result = await createGoogleOAuthState(mockDb, mockEnv);
    expect(result.authUrl).toContain('accounts.google.com');
  });

  it('returns a hex state string', async () => {
    const result = await createGoogleOAuthState(mockDb, mockEnv);
    expect(result.state).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores the state in the oauth_states table', async () => {
    const result = await createGoogleOAuthState(mockDb, mockEnv);

    expect(mockDbInsert).toHaveBeenCalledWith(
      mockDb,
      'oauth_states',
      expect.objectContaining({
        state: result.state,
        provider: 'google',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// handleGoogleOAuthCallback
// ---------------------------------------------------------------------------
describe('handleGoogleOAuthCallback', () => {
  it('returns email and user info on successful callback', async () => {
    const futureDate = new Date(Date.now() + 600_000).toISOString();

    // dbQueryOne: find state
    mockDbQueryOne.mockResolvedValueOnce({
      id: 'state-1',
      state: 'valid-state',
      expires_at: futureDate,
    });
    // dbExecute: delete used state
    mockDbExecute.mockResolvedValueOnce({ error: null, changes: 1 });

    // global.fetch: token exchange
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'mock-access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      // global.fetch: userinfo
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            email: 'google-user@gmail.com',
            name: 'Google User',
            picture: 'https://example.com/avatar.jpg',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      );

    const result = await handleGoogleOAuthCallback(mockDb, mockEnv, 'auth-code', 'valid-state');

    expect(result.email).toBe('google-user@gmail.com');
    expect(result.display_name).toBe('Google User');
    expect(result.avatar_url).toBe('https://example.com/avatar.jpg');
  });

  it('throws unauthorized when the state is not found', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null);

    await expect(handleGoogleOAuthCallback(mockDb, mockEnv, 'code', 'bad-state')).rejects.toThrow(
      'Invalid OAuth state',
    );
  });

  it('throws unauthorized when the state is expired', async () => {
    const pastDate = new Date(Date.now() - 600_000).toISOString();

    mockDbQueryOne.mockResolvedValueOnce({
      id: 'state-2',
      state: 'expired-state',
      expires_at: pastDate,
    });

    await expect(
      handleGoogleOAuthCallback(mockDb, mockEnv, 'code', 'expired-state'),
    ).rejects.toThrow('OAuth state expired');
  });
});

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------
describe('createSession', () => {
  beforeEach(() => {
    mockDbInsert.mockResolvedValue({ error: null });
  });

  it('returns a 64-character hex token and expires_at', async () => {
    const result = await createSession(mockDb, 'user-id-1');

    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(result.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('creates a session record in the sessions table', async () => {
    await createSession(mockDb, 'user-id-2', 'Chrome on macOS', '192.168.1.1');

    expect(mockDbInsert).toHaveBeenCalledWith(
      mockDb,
      'sessions',
      expect.objectContaining({
        user_id: 'user-id-2',
        device_info: 'Chrome on macOS',
        ip_address: '192.168.1.1',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------
describe('getSession', () => {
  const token = 'b'.repeat(64);

  it('returns session data for a valid token', async () => {
    const futureDate = new Date(Date.now() + 86_400_000).toISOString();

    mockDbQueryOne.mockResolvedValueOnce({
      id: 'sess-1',
      user_id: 'user-1',
      expires_at: futureDate,
    });
    mockDbUpdate.mockResolvedValueOnce({ error: null, changes: 1 }); // update last_active_at

    const result = await getSession(mockDb, token);

    expect(result).toEqual({
      id: 'sess-1',
      user_id: 'user-1',
      expires_at: futureDate,
    });
  });

  it('returns null when no session matches the token', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null);

    const result = await getSession(mockDb, token);
    expect(result).toBeNull();
  });

  it('returns null when the session is expired', async () => {
    const pastDate = new Date(Date.now() - 86_400_000).toISOString();

    mockDbQueryOne.mockResolvedValueOnce({
      id: 'sess-2',
      user_id: 'user-2',
      expires_at: pastDate,
    });

    const result = await getSession(mockDb, token);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// revokeSession
// ---------------------------------------------------------------------------
describe('revokeSession', () => {
  it('calls dbUpdate with deleted_at set on the sessions table', async () => {
    mockDbUpdate.mockResolvedValue({ error: null, changes: 1 });

    await revokeSession(mockDb, 'sess-to-revoke');

    expect(mockDbUpdate).toHaveBeenCalledWith(
      mockDb,
      'sessions',
      expect.objectContaining({
        deleted_at: expect.any(String),
      }),
      'id = ?',
      ['sess-to-revoke'],
    );
  });

  it('passes a valid ISO date as deleted_at', async () => {
    mockDbUpdate.mockResolvedValue({ error: null, changes: 1 });

    await revokeSession(mockDb, 'sess-99');

    const updates = mockDbUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(updates.deleted_at).toBeDefined();
    // updated_at is added internally by dbUpdate, not by the service
    expect(() => new Date(updates.deleted_at as string).toISOString()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getUserSessions
// ---------------------------------------------------------------------------
describe('getUserSessions', () => {
  it('returns an empty array when no sessions exist', async () => {
    mockDbQuery.mockResolvedValueOnce({ data: [], error: null });

    const result = await getUserSessions(mockDb, 'user-no-sessions');
    expect(result).toEqual([]);
  });

  it('returns active sessions for the given user', async () => {
    const sessions = [
      {
        id: 's1',
        device_info: 'Firefox',
        last_active_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
      {
        id: 's2',
        device_info: null,
        last_active_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ];
    mockDbQuery.mockResolvedValueOnce({ data: sessions, error: null });

    const result = await getUserSessions(mockDb, 'user-with-sessions');

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('s1');
    expect(result[1].device_info).toBeNull();
  });
});
