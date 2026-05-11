/**
 * Guards the subscription-auth path that bypasses metered API credits.
 * If any of these break, container builds will silently fall back to (or
 * burn through) the API-key path again — both the visible failure mode
 * (#26+#27 incident) and the silent template-only build are back on the
 * table. Every assertion here maps to a real production failure prior to
 * the OAuth integration.
 */
import { hasClaudeOauth, getValidClaudeOauth } from '../services/anthropic_oauth';

function makeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    put: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
  } as any;
}

describe('hasClaudeOauth', () => {
  it('returns false when any secret missing', () => {
    expect(hasClaudeOauth({ CACHE_KV: {} as any })).toBe(false);
    expect(hasClaudeOauth({
      CACHE_KV: {} as any,
      CLAUDE_OAUTH_ACCESS_TOKEN: 'a',
      CLAUDE_OAUTH_REFRESH_TOKEN: 'r',
    })).toBe(false);
  });

  it('returns true when all three secrets present', () => {
    expect(hasClaudeOauth({
      CACHE_KV: {} as any,
      CLAUDE_OAUTH_ACCESS_TOKEN: 'a',
      CLAUDE_OAUTH_REFRESH_TOKEN: 'r',
      CLAUDE_OAUTH_EXPIRES_AT: '1',
    })).toBe(true);
  });
});

describe('getValidClaudeOauth', () => {
  const realFetch = global.fetch;
  afterEach(() => { (global as any).fetch = realFetch; jest.clearAllMocks(); });

  it('throws when secrets missing', async () => {
    await expect(getValidClaudeOauth({ CACHE_KV: makeKv() })).rejects.toThrow(/not configured/);
  });

  it('returns env-seeded token without refresh when expiry far away', async () => {
    const future = Date.now() + 60 * 60_000;
    const fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
    const kv = makeKv();
    const tokens = await getValidClaudeOauth({
      CACHE_KV: kv,
      CLAUDE_OAUTH_ACCESS_TOKEN: 'env-access',
      CLAUDE_OAUTH_REFRESH_TOKEN: 'env-refresh',
      CLAUDE_OAUTH_EXPIRES_AT: String(future),
    });
    expect(tokens.accessToken).toBe('env-access');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
  });

  it('prefers KV-cached token over env when KV is fresher', async () => {
    const envFuture = Date.now() + 10 * 60_000;
    const kvFuture = Date.now() + 60 * 60_000;
    const kv = makeKv({
      'anthropic:oauth:current': JSON.stringify({
        accessToken: 'kv-access', refreshToken: 'kv-refresh', expiresAt: kvFuture,
      }),
    });
    const tokens = await getValidClaudeOauth({
      CACHE_KV: kv,
      CLAUDE_OAUTH_ACCESS_TOKEN: 'env-access',
      CLAUDE_OAUTH_REFRESH_TOKEN: 'env-refresh',
      CLAUDE_OAUTH_EXPIRES_AT: String(envFuture),
    });
    expect(tokens.accessToken).toBe('kv-access');
  });

  it('refreshes via OAuth endpoint when within 5min slack and writes back to KV', async () => {
    const expiringSoon = Date.now() + 60_000;
    const fetchSpy = jest.fn(async () => new Response(JSON.stringify({
      access_token: 'fresh-access', refresh_token: 'fresh-refresh', expires_in: 3600,
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    (global as any).fetch = fetchSpy;
    const kv = makeKv();
    const tokens = await getValidClaudeOauth({
      CACHE_KV: kv,
      CLAUDE_OAUTH_ACCESS_TOKEN: 'old', CLAUDE_OAUTH_REFRESH_TOKEN: 'old-r', CLAUDE_OAUTH_EXPIRES_AT: String(expiringSoon),
    });
    expect(tokens.accessToken).toBe('fresh-access');
    expect(tokens.refreshToken).toBe('fresh-refresh');
    expect(fetchSpy).toHaveBeenCalledWith('https://console.anthropic.com/v1/oauth/token', expect.objectContaining({
      method: 'POST',
    }));
    expect(kv.put).toHaveBeenCalledWith(
      'anthropic:oauth:current',
      expect.stringContaining('fresh-access'),
      expect.objectContaining({ expirationTtl: 60 * 60 * 24 * 30 }),
    );
  });

  it('throws with body excerpt when refresh endpoint returns non-2xx', async () => {
    (global as any).fetch = jest.fn(async () => new Response('{"error":"invalid_grant"}', { status: 400 }));
    await expect(getValidClaudeOauth({
      CACHE_KV: makeKv(),
      CLAUDE_OAUTH_ACCESS_TOKEN: 'a', CLAUDE_OAUTH_REFRESH_TOKEN: 'r', CLAUDE_OAUTH_EXPIRES_AT: '1',
    })).rejects.toThrow(/Anthropic OAuth refresh failed: 400/);
  });

  it('throws when refresh response is missing expected fields', async () => {
    (global as any).fetch = jest.fn(async () => new Response(JSON.stringify({ access_token: 'x' }), { status: 200 }));
    await expect(getValidClaudeOauth({
      CACHE_KV: makeKv(),
      CLAUDE_OAUTH_ACCESS_TOKEN: 'a', CLAUDE_OAUTH_REFRESH_TOKEN: 'r', CLAUDE_OAUTH_EXPIRES_AT: '1',
    })).rejects.toThrow(/missing fields/);
  });
});
