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
 * Cheap predicate: are subscription-auth secrets loaded into this Worker?
 *
 * @param env - Slice of `Env` containing the three Claude OAuth secrets
 *   plus `CACHE_KV`. Wrangler exposes secrets as plain strings on `env`;
 *   missing secrets are `undefined`.
 * @returns `true` iff all three secrets (`CLAUDE_OAUTH_ACCESS_TOKEN`,
 *   `CLAUDE_OAUTH_REFRESH_TOKEN`, `CLAUDE_OAUTH_EXPIRES_AT`) are present.
 *   Empty strings count as missing (Boolean coercion).
 *
 * @remarks
 * Call this BEFORE every container-build dispatch to decide between the
 * subscription path (flat-rate Max 20x quota) and the metered-API
 * fallback path. Performing the boolean check is ~1 microsecond — the
 * actual {@link getValidClaudeOauth} call may hit KV + Anthropic's
 * refresh endpoint, so guard with this first to avoid wasted work when
 * secrets aren't seeded yet.
 *
 * @throws Never — pure synchronous boolean check.
 *
 * @example
 * ```ts
 * if (hasClaudeOauth(env)) {
 *   const tokens = await getValidClaudeOauth(env);
 *   headers['x-anthropic-oauth-token'] = tokens.accessToken;
 * } else {
 *   headers['x-api-key'] = env.ANTHROPIC_API_KEY;
 * }
 * ```
 */
export function hasClaudeOauth(env: OauthEnvSlice): boolean {
  return Boolean(
    env.CLAUDE_OAUTH_ACCESS_TOKEN &&
      env.CLAUDE_OAUTH_REFRESH_TOKEN &&
      env.CLAUDE_OAUTH_EXPIRES_AT,
  );
}

/**
 * Resolve a valid (unexpired) Claude subscription OAuth bundle, refreshing
 * via Anthropic's public token endpoint when the cached copy is within
 * `REFRESH_SLACK_MS` (5 min) of expiration. Persists rotated tokens to KV
 * (`anthropic:oauth:current`, 30-day TTL) so subsequent invocations skip
 * the network refresh until the slack window opens again.
 *
 * @param env - Slice of `Env` containing the three OAuth secrets plus
 *   `CACHE_KV`. Caller MUST gate with {@link hasClaudeOauth}.
 * @returns Fresh `ClaudeOauthTokens` — guaranteed `expiresAt > Date.now() + 5min`
 *   at return time. Caller should NOT cache the result across requests
 *   (KV does that already); always re-call per invocation so a different
 *   request that just rotated the token wins.
 *
 * @remarks
 * Token-precedence rule: KV-cached copy wins over Wrangler secret seed
 * iff its `expiresAt` is fresher. This handles the bootstrap case where
 * `scripts/import-claude-oauth.mjs` seeded an older token via Wrangler
 * secrets but a more recent refresh has since landed in KV. Secrets are
 * immutable at runtime — KV is the only writable durable store the
 * Worker has.
 *
 * Refresh-token rotation: Anthropic's OAuth issues a NEW refresh_token
 * on every refresh (RFC 6749 §6 rotation pattern). We write the new
 * pair atomically; partial failure (refresh succeeds but KV write
 * rejects) means the next call must re-refresh with the OLD token —
 * which Anthropic still honors for a short grace period. Don't try to
 * eagerly invalidate the old token here.
 *
 * Side effect: 1 KV read worst case (cache miss → fall back to env),
 * 0-1 outbound `POST` to `console.anthropic.com/v1/oauth/token`, 0-1
 * KV write when refresh fires.
 *
 * @throws {Error} `'Claude OAuth secrets not configured ...'` when
 *   secrets are missing — caller MUST gate with {@link hasClaudeOauth}.
 * @throws {Error} `'Anthropic OAuth refresh failed: <status> <body>'`
 *   when refresh endpoint returns non-2xx (revoked token, account
 *   suspended, Anthropic outage). Caller SHOULD fall back to metered
 *   API-key path and emit a Sentry alert — the refresh token has
 *   likely been revoked and Brian needs to re-run
 *   `scripts/import-claude-oauth.mjs`.
 * @throws {Error} `'Anthropic OAuth refresh returned non-JSON ...'` or
 *   `'... missing fields ...'` when response is malformed — typically
 *   indicates an Anthropic-side breaking change to the token-endpoint
 *   contract.
 *
 * @example
 * ```ts
 * if (!hasClaudeOauth(env)) {
 *   return runWithApiKey(env);
 * }
 * const { accessToken } = await getValidClaudeOauth(env);
 * await dispatchBuild(env, { authorization: `Bearer ${accessToken}` });
 * ```
 *
 * @see {@link hasClaudeOauth}
 * @see {@link https://datatracker.ietf.org/doc/html/rfc6749#section-6 RFC 6749 §6}
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
