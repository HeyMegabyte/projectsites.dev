/**
 * @module anthropic_oauth
 * @description Subscription-auth tokens for Anthropic API (Claude Code Max plan).
 *
 * Bridges Brian's local `claude /login` Max 20x subscription to the
 * projectsites.dev build pipeline so container `claude -p` runs draw from
 * his flat-rate quota instead of the metered API key. Bootstrap script
 * `scripts/import-claude-oauth.mjs` seeds the three secrets; this module
 * keeps the access token fresh by hitting the public OAuth refresh
 * endpoint when the cached copy is within 5 minutes of expiring.
 *
 * Token rotation results are written to KV (key `anthropic:oauth:current`)
 * so subsequent worker invocations skip the refresh fetch. Wrangler secrets
 * are immutable at runtime — KV is the only writable durable store
 * available to the worker.
 *
 * Refresh endpoint + client_id are public (they ship inside the open-source
 * Claude Code CLI). No client_secret involved — this is the OAuth
 * device-flow / public-client variant.
 */

const TOKEN_ENDPOINT = 'https://console.anthropic.com/v1/oauth/token';
const PUBLIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const KV_KEY = 'anthropic:oauth:current';
const REFRESH_SLACK_MS = 5 * 60_000;

export interface ClaudeOauthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface OauthEnvSlice {
  CACHE_KV: KVNamespace;
  CLAUDE_OAUTH_ACCESS_TOKEN?: string;
  CLAUDE_OAUTH_REFRESH_TOKEN?: string;
  CLAUDE_OAUTH_EXPIRES_AT?: string;
}

/**
 * Returns whether subscription-auth secrets are loaded. Cheap call —
 * use it to decide between subscription path and API-key fallback path.
 */
export function hasClaudeOauth(env: OauthEnvSlice): boolean {
  return Boolean(
    env.CLAUDE_OAUTH_ACCESS_TOKEN &&
      env.CLAUDE_OAUTH_REFRESH_TOKEN &&
      env.CLAUDE_OAUTH_EXPIRES_AT,
  );
}

/**
 * Returns a valid (unexpired) access token + refresh token + expiry.
 * Refreshes via Anthropic's OAuth token endpoint when the cached copy is
 * within `REFRESH_SLACK_MS` of expiring. Persists rotated tokens to KV
 * so subsequent worker invocations reuse them.
 *
 * @throws when no tokens are configured (caller should check `hasClaudeOauth`)
 *         or when the refresh call fails terminally (e.g. revoked token).
 */
export async function getValidClaudeOauth(env: OauthEnvSlice): Promise<ClaudeOauthTokens> {
  if (!hasClaudeOauth(env)) {
    throw new Error('Claude OAuth secrets not configured (run scripts/import-claude-oauth.mjs).');
  }

  const cached = await readCached(env.CACHE_KV);
  const seedFromEnv: ClaudeOauthTokens = {
    accessToken: env.CLAUDE_OAUTH_ACCESS_TOKEN!,
    refreshToken: env.CLAUDE_OAUTH_REFRESH_TOKEN!,
    expiresAt: Number(env.CLAUDE_OAUTH_EXPIRES_AT!),
  };

  // Pick whichever copy is fresher. KV survives across invocations and may
  // hold a token rotated by an earlier request; secrets are immutable.
  const current = cached && cached.expiresAt > seedFromEnv.expiresAt ? cached : seedFromEnv;

  if (current.expiresAt - Date.now() > REFRESH_SLACK_MS) {
    return current;
  }

  const refreshed = await refreshAccessToken(current.refreshToken);
  await writeCached(env.CACHE_KV, refreshed);
  return refreshed;
}

async function readCached(kv: KVNamespace): Promise<ClaudeOauthTokens | null> {
  const raw = await kv.get(KV_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ClaudeOauthTokens>;
    if (!parsed.accessToken || !parsed.refreshToken || typeof parsed.expiresAt !== 'number') return null;
    return parsed as ClaudeOauthTokens;
  } catch {
    return null;
  }
}

async function writeCached(kv: KVNamespace, tokens: ClaudeOauthTokens): Promise<void> {
  // Long TTL — refresh tokens last for weeks. Re-rotation triggers a write.
  await kv.put(KV_KEY, JSON.stringify(tokens), { expirationTtl: 60 * 60 * 24 * 30 });
}

async function refreshAccessToken(refreshToken: string): Promise<ClaudeOauthTokens> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: PUBLIC_CLIENT_ID,
    }),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic OAuth refresh failed: ${res.status} ${bodyText.slice(0, 300)}`);
  }

  let body: { access_token?: string; refresh_token?: string; expires_in?: number };
  try {
    body = JSON.parse(bodyText);
  } catch {
    throw new Error(`Anthropic OAuth refresh returned non-JSON: ${bodyText.slice(0, 200)}`);
  }

  if (!body.access_token || !body.refresh_token || typeof body.expires_in !== 'number') {
    throw new Error(`Anthropic OAuth refresh missing fields: ${bodyText.slice(0, 200)}`);
  }

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
}
