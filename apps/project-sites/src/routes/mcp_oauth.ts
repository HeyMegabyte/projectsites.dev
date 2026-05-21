/**
 * MCP OAuth start + callback for MailChimp, Stripe, Resend, HubSpot.
 *
 *   GET  /api/mcp/:provider/connect?site_id=…&return_url=…
 *   GET  /api/mcp/:provider/callback?code=…&state=…
 *
 * After a successful exchange, we encrypt + store the access token in
 * `mcp_connections` (one row per site+provider) and redirect the user
 * back to the dashboard MCP tab.
 *
 * Resend is special — it has no OAuth, so /connect returns a JSON form
 * spec the UI uses to render a paste-key form posting to
 * /api/mcp/resend/paste.
 */
import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { getAdapter, type Provider } from '../services/mcp_client.js';
import { encrypt } from '../services/ai_crypto.js';

export const mcpOauth = new Hono<{ Bindings: Env; Variables: Variables }>();

mcpOauth.get('/api/mcp/:provider/connect', async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId) return c.json({ error: { message: 'auth required' } }, 401);
  const provider = c.req.param('provider') as Provider;
  const adapter = getAdapter(provider);
  if (!adapter) return c.json({ error: { message: 'unknown provider' } }, 404);
  const siteId = c.req.query('site_id');
  if (!siteId) return c.json({ error: { message: 'site_id required' } }, 400);
  const returnUrl = c.req.query('return_url') ?? '/admin/mcp';
  const state = crypto.randomUUID().replace(/-/g, '');
  const codeVerifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(48))))
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 64);

  await c.env.DB.prepare(
    `INSERT INTO mcp_oauth_states (state, org_id, site_id, provider, code_verifier, return_url)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(state, orgId, siteId, provider, codeVerifier, returnUrl)
    .run();

  const url = adapter.authorizeUrl(c.env, {
    state,
    codeVerifier,
    returnUrl: `https://projectsites.dev${returnUrl}`,
  });
  if (url.startsWith('__paste_key__')) {
    // Provider has no OAuth — return paste-key spec.
    return c.json({
      data: {
        mode: 'paste_key',
        provider,
        state,
        post_to: `/api/mcp/${provider}/paste?state=${state}`,
        instructions:
          provider === 'resend'
            ? 'Paste your Resend API key (starts with re_). Find it at https://resend.com/api-keys.'
            : 'Paste the API key.',
      },
    });
  }
  return Response.redirect(url, 302);
});

mcpOauth.get('/api/mcp/:provider/callback', async (c) => {
  const provider = c.req.param('provider') as Provider;
  const adapter = getAdapter(provider);
  if (!adapter) return c.json({ error: { message: 'unknown provider' } }, 404);
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) return c.json({ error: { message: 'code + state required' } }, 400);

  const stateRow = await c.env.DB.prepare(
    `SELECT org_id, site_id, code_verifier, return_url FROM mcp_oauth_states WHERE state = ?`,
  )
    .bind(state)
    .first<{ org_id: string; site_id: string; code_verifier: string; return_url: string }>();
  if (!stateRow) return c.json({ error: { message: 'invalid state' } }, 400);

  let exchange;
  try {
    exchange = await adapter.exchangeCode(c.env, {
      code,
      codeVerifier: stateRow.code_verifier,
      redirectUri: `https://projectsites.dev/api/mcp/${provider}/callback`,
    });
  } catch (err) {
    return c.json({ error: { message: err instanceof Error ? err.message : 'exchange failed' } }, 502);
  }
  const enc = await encrypt(c.env, exchange.access_token);
  const encRefresh = exchange.refresh_token ? await encrypt(c.env, exchange.refresh_token) : null;
  const expiresAt = exchange.expires_in
    ? new Date(Date.now() + exchange.expires_in * 1000).toISOString()
    : null;
  const id = crypto.randomUUID();
  // Upsert by (site_id, provider).
  await c.env.DB.prepare(
    `INSERT INTO mcp_connections (id, org_id, site_id, provider, display_name,
       access_token_encrypted, refresh_token_encrypted, token_expires_at, account_metadata_json, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
     ON CONFLICT(site_id, provider) DO UPDATE SET
       access_token_encrypted = excluded.access_token_encrypted,
       refresh_token_encrypted = excluded.refresh_token_encrypted,
       token_expires_at = excluded.token_expires_at,
       account_metadata_json = excluded.account_metadata_json,
       status = 'active',
       updated_at = datetime('now')`,
  )
    .bind(
      id,
      stateRow.org_id,
      stateRow.site_id,
      provider,
      `${provider} connection`,
      enc,
      encRefresh,
      expiresAt,
      exchange.metadata ? JSON.stringify(exchange.metadata) : null,
    )
    .run();
  await c.env.DB.prepare(`DELETE FROM mcp_oauth_states WHERE state = ?`).bind(state).run();
  return Response.redirect(`https://projectsites.dev${stateRow.return_url}?connected=${provider}`, 302);
});

// Paste-key flow for providers with no OAuth (Resend).
mcpOauth.post('/api/mcp/:provider/paste', async (c) => {
  const orgId = c.get('orgId') as string | undefined;
  if (!orgId) return c.json({ error: { message: 'auth required' } }, 401);
  const provider = c.req.param('provider') as Provider;
  const state = c.req.query('state');
  const { api_key } = (await c.req.json()) as { api_key: string };
  if (!api_key) return c.json({ error: { message: 'api_key required' } }, 400);
  const stateRow = state
    ? await c.env.DB.prepare(
        `SELECT site_id FROM mcp_oauth_states WHERE state = ? AND org_id = ?`,
      )
        .bind(state, orgId)
        .first<{ site_id: string }>()
    : null;
  const siteId = stateRow?.site_id ?? (c.req.query('site_id') as string | undefined);
  if (!siteId) return c.json({ error: { message: 'site_id required' } }, 400);
  const enc = await encrypt(c.env, api_key);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO mcp_connections (id, org_id, site_id, provider, display_name,
       access_token_encrypted, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')
     ON CONFLICT(site_id, provider) DO UPDATE SET
       access_token_encrypted = excluded.access_token_encrypted,
       status = 'active',
       updated_at = datetime('now')`,
  )
    .bind(id, orgId, siteId, provider, `${provider} (pasted key)`, enc)
    .run();
  if (state) await c.env.DB.prepare(`DELETE FROM mcp_oauth_states WHERE state = ?`).bind(state).run();
  return c.json({ data: { connected: true } });
});
