/**
 * Admin surface for the AI platform: form submissions, AI logs, chat context
 * files, AI settings (router prompt + chat persona + contact email), endpoints
 * CRUD, AI credits (balance, ledger, topup checkout), spend alerts, team
 * invites/members, per-site cost breakdown. Mounted by index.ts.
 *
 * Every route requires an authenticated org context. Public endpoints (form
 * ingest, /api/ai/:slug/:endpoint) live in their own files.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { getBalance, topupCredits, CREDIT_BUNDLES, type BundleKey } from '../services/credits.js';
import { allProviders } from '../services/mcp_client.js';
import { DEFAULT_ROUTER_PROMPT, DEFAULT_CHAT_SYSTEM_PROMPT } from '../services/form_router.js';
import { uploadUserWorker, deleteUserWorker, SUPPORTED_LANGUAGES, isWfpConfigured } from '../services/wfp_dispatch.js';
import { recordEvent, loadOverview } from '../services/cf_analytics.js';

export const aiAdmin = new Hono<{ Bindings: Env; Variables: Variables }>();

type Ctx = Context<{ Bindings: Env; Variables: Variables }>;

function need(c: Ctx): { orgId: string; userId: string } {
  const orgId = c.get('orgId') as string | undefined;
  const userId = c.get('userId') as string | undefined;
  if (!orgId || !userId) throw new HTTPError(401, 'Authentication required');
  return { orgId, userId };
}

class HTTPError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

aiAdmin.onError((err, c) => {
  if (err instanceof HTTPError) return c.json({ error: { message: err.message } }, err.status as 400);
  return c.json({ error: { message: err.message || 'internal error' } }, 500);
});

async function siteOwned(c: Ctx, orgId: string, siteId: string): Promise<{ slug: string; business_name: string | null }> {
  const row = await c.env.DB.prepare(
    `SELECT slug, business_name FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL`,
  )
    .bind(siteId, orgId)
    .first<{ slug: string; business_name: string | null }>();
  if (!row) throw new HTTPError(404, 'Site not found');
  return row;
}

function safeJson(s: string | null | undefined): unknown {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return s; }
}

/* ────────────────────────── Form Submissions + AI Logs ────────────────────────── */

aiAdmin.get('/api/sites/:siteId/form-submissions', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, form_name, email, payload, status, ip_address, origin_url, created_at
     FROM form_submissions WHERE site_id = ?
     ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(siteId)
    .all<Record<string, unknown>>();
  return c.json({
    data: (rows.results ?? []).map((r) => ({ ...r, fields: safeJson(r['payload'] as string) })),
  });
});

aiAdmin.get('/api/sites/:siteId/form-submissions/:subId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const sub = await c.env.DB.prepare(
    `SELECT id, form_name, email, payload, status, ip_address, origin_url, user_agent, created_at
     FROM form_submissions WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('subId'), siteId)
    .first<Record<string, unknown>>();
  if (!sub) throw new HTTPError(404, 'Submission not found');
  const logs = await c.env.DB.prepare(
    `SELECT * FROM ai_form_logs WHERE submission_id = ? ORDER BY created_at DESC`,
  )
    .bind(c.req.param('subId'))
    .all();
  return c.json({
    data: {
      submission: { ...sub, fields: safeJson(sub['payload'] as string) },
      ai_logs: logs.results ?? [],
    },
  });
});

aiAdmin.get('/api/sites/:siteId/ai-logs', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const kind = c.req.query('kind');
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 1000);
  const stmt = kind
    ? c.env.DB.prepare(
        `SELECT id, submission_id, trace_kind, endpoint_slug, model, status, latency_ms,
                tokens_input, tokens_output, credits_debited, tool_name, tool_status,
                substr(output_text, 1, 200) AS output_preview, error_message, created_at
         FROM ai_form_logs WHERE site_id = ? AND trace_kind = ?
         ORDER BY created_at DESC LIMIT ?`,
      ).bind(siteId, kind, limit)
    : c.env.DB.prepare(
        `SELECT id, submission_id, trace_kind, endpoint_slug, model, status, latency_ms,
                tokens_input, tokens_output, credits_debited, tool_name, tool_status,
                substr(output_text, 1, 200) AS output_preview, error_message, created_at
         FROM ai_form_logs WHERE site_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      ).bind(siteId, limit);
  const rows = await stmt.all();
  return c.json({ data: rows.results ?? [] });
});

aiAdmin.get('/api/sites/:siteId/ai-logs/:logId', async (c) => {
  const { orgId } = need(c);
  await siteOwned(c, orgId, c.req.param('siteId'));
  const row = await c.env.DB.prepare(
    `SELECT * FROM ai_form_logs WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('logId'), c.req.param('siteId'))
    .first();
  if (!row) throw new HTTPError(404, 'Log not found');
  return c.json({ data: row });
});

/* ────────────────────────── AI Chat Context Files ────────────────────────── */

aiAdmin.get('/api/sites/:siteId/ai-chat/context-files', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, filename, mime_type, size_bytes, description, enabled,
            length(extracted_text) AS text_chars, created_at
     FROM ai_chat_context_files WHERE site_id = ? ORDER BY created_at DESC`,
  )
    .bind(siteId)
    .all();
  return c.json({ data: rows.results ?? [] });
});

aiAdmin.post('/api/sites/:siteId/ai-chat/context-files', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const ct = c.req.header('content-type') ?? '';
  if (!ct.includes('multipart/form-data')) throw new HTTPError(400, 'multipart/form-data required');
  const form = await c.req.formData();
  const fileRaw = form.get('file');
  if (!fileRaw || typeof fileRaw === 'string') throw new HTTPError(400, 'file field required');
  const file = fileRaw as unknown as File;
  if (file.size > 5 * 1024 * 1024) throw new HTTPError(400, 'file too large (max 5 MB)');
  const description = (form.get('description') as string | null) ?? null;
  const id = crypto.randomUUID();
  const r2Key = `ai-context/${siteId}/${id}-${file.name}`;
  const buf = await file.arrayBuffer();
  await c.env.SITES_BUCKET.put(r2Key, buf, {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  let extracted: string | null = null;
  if (file.type.startsWith('text/') || file.type === 'application/json' || file.type === 'text/markdown') {
    extracted = new TextDecoder().decode(buf).slice(0, 60_000);
  }
  await c.env.DB.prepare(
    `INSERT INTO ai_chat_context_files (id, org_id, site_id, filename, mime_type, size_bytes, r2_key, extracted_text, description, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  )
    .bind(id, orgId, siteId, file.name, file.type || null, file.size, r2Key, extracted, description)
    .run();
  return c.json({ data: { id, filename: file.name, size_bytes: file.size, indexed: !!extracted } }, 201);
});

aiAdmin.delete('/api/sites/:siteId/ai-chat/context-files/:fileId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const row = await c.env.DB.prepare(
    `SELECT r2_key FROM ai_chat_context_files WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('fileId'), siteId)
    .first<{ r2_key: string }>();
  if (!row) throw new HTTPError(404, 'File not found');
  await c.env.SITES_BUCKET.delete(row.r2_key).catch(() => {});
  await c.env.DB.prepare(`DELETE FROM ai_chat_context_files WHERE id = ?`)
    .bind(c.req.param('fileId'))
    .run();
  return c.json({ data: { deleted: true } });
});

/* ────────────────────────── AI Site Settings (router prompt + chat + contact) ────────────────────────── */

aiAdmin.get('/api/sites/:siteId/ai-settings', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const row = await c.env.DB.prepare(
    `SELECT chat_persona, chat_system_prompt, form_router_prompt, reply_email,
            contact_email, brand_tone, search_synonyms_json, updated_at
     FROM ai_site_settings WHERE site_id = ?`,
  )
    .bind(siteId)
    .first<Record<string, string | null>>();
  return c.json({
    data: {
      site_id: siteId,
      slug: site.slug,
      business_name: site.business_name,
      chat_persona: row?.chat_persona ?? null,
      chat_system_prompt: row?.chat_system_prompt ?? null,
      chat_system_prompt_default: DEFAULT_CHAT_SYSTEM_PROMPT,
      form_router_prompt: row?.form_router_prompt ?? null,
      form_router_prompt_default: DEFAULT_ROUTER_PROMPT,
      reply_email: row?.reply_email ?? null,
      contact_email: row?.contact_email ?? null,
      brand_tone: row?.brand_tone ?? null,
      search_synonyms: row?.search_synonyms_json ? safeJson(row.search_synonyms_json) : {},
      updated_at: row?.updated_at ?? null,
    },
  });
});

aiAdmin.put('/api/sites/:siteId/ai-settings', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const body = (await c.req.json()) as Record<string, unknown>;
  const allowed = [
    'chat_persona',
    'chat_system_prompt',
    'form_router_prompt',
    'reply_email',
    'contact_email',
    'brand_tone',
  ] as const;
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in body) fields[k] = body[k];
  if ('search_synonyms' in body) fields['search_synonyms_json'] = JSON.stringify(body['search_synonyms']);
  const existing = await c.env.DB.prepare(`SELECT 1 FROM ai_site_settings WHERE site_id = ?`)
    .bind(siteId)
    .first();
  if (existing) {
    const cols = Object.keys(fields);
    const set = cols.map((k) => `${k} = ?`).join(', ');
    await c.env.DB.prepare(`UPDATE ai_site_settings SET ${set} WHERE site_id = ?`)
      .bind(...cols.map((k) => fields[k]), siteId)
      .run();
  } else {
    const cols = ['site_id', ...Object.keys(fields)];
    const placeholders = cols.map(() => '?').join(', ');
    await c.env.DB.prepare(`INSERT INTO ai_site_settings (${cols.join(', ')}) VALUES (${placeholders})`)
      .bind(siteId, ...Object.keys(fields).map((k) => fields[k]))
      .run();
  }
  return c.json({ data: { saved: true } });
});

/* ────────────────────────── AI Endpoints CRUD ────────────────────────── */

aiAdmin.get('/api/sites/:siteId/ai-endpoints', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, endpoint_slug, display_name, description, kind, method, worker_language,
            wfp_script_name, enabled, created_at, updated_at
     FROM ai_endpoints WHERE site_id = ? ORDER BY created_at DESC`,
  )
    .bind(siteId)
    .all();
  return c.json({
    data: rows.results ?? [],
    wfp_configured: isWfpConfigured(c.env),
    supported_languages: SUPPORTED_LANGUAGES,
  });
});

aiAdmin.post('/api/sites/:siteId/ai-endpoints', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  const site = await siteOwned(c, orgId, siteId);
  const body = (await c.req.json()) as {
    endpoint_slug: string;
    display_name: string;
    description?: string;
    kind: 'prompt' | 'worker';
    method?: 'GET' | 'POST' | 'BOTH';
    prompt_template?: string;
    worker_language?: string;
    worker_code?: string;
    mcp_tools?: string[];
  };
  const slug = body.endpoint_slug?.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (!slug || !body.display_name) throw new HTTPError(400, 'endpoint_slug + display_name required');
  if (body.kind !== 'prompt' && body.kind !== 'worker') throw new HTTPError(400, 'kind must be prompt | worker');
  if (body.kind === 'worker' && !isWfpConfigured(c.env)) {
    throw new HTTPError(503, 'Workers for Platforms not configured on this account');
  }
  const id = crypto.randomUUID();
  let wfpScriptName: string | null = null;
  if (body.kind === 'worker') {
    const up = await uploadUserWorker(c.env, {
      siteId,
      endpointSlug: slug,
      language: (body.worker_language ?? 'javascript') as 'javascript' | 'typescript' | 'python' | 'rust-wasm',
      code: body.worker_code ?? '',
    });
    if (!up.ok) throw new HTTPError(502, `WFP upload failed: ${up.error}`);
    wfpScriptName = up.scriptName;
  }
  await c.env.DB.prepare(
    `INSERT INTO ai_endpoints (id, org_id, site_id, endpoint_slug, display_name, description,
       kind, method, prompt_template, worker_language, worker_code, wfp_script_name, mcp_tools_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      orgId,
      siteId,
      slug,
      body.display_name,
      body.description ?? null,
      body.kind,
      body.method ?? 'POST',
      body.prompt_template ?? null,
      body.worker_language ?? null,
      body.worker_code ?? null,
      wfpScriptName,
      body.mcp_tools ? JSON.stringify(body.mcp_tools) : null,
    )
    .run();
  return c.json({ data: { id, endpoint_slug: slug, url: `https://projectsites.dev/api/ai/${site.slug}/${slug}` } }, 201);
});

aiAdmin.put('/api/sites/:siteId/ai-endpoints/:endpointId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const body = (await c.req.json()) as Record<string, unknown>;
  const existing = await c.env.DB.prepare(
    `SELECT id, endpoint_slug, kind, wfp_script_name FROM ai_endpoints WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('endpointId'), siteId)
    .first<{ id: string; endpoint_slug: string; kind: string; wfp_script_name: string | null }>();
  if (!existing) throw new HTTPError(404, 'Endpoint not found');
  // Re-upload user code on edit if kind=worker.
  let wfpScriptName = existing.wfp_script_name;
  if (existing.kind === 'worker' && body['worker_code']) {
    const up = await uploadUserWorker(c.env, {
      siteId,
      endpointSlug: existing.endpoint_slug,
      language: ((body['worker_language'] as string) ?? 'javascript') as 'javascript' | 'typescript' | 'python' | 'rust-wasm',
      code: body['worker_code'] as string,
    });
    if (!up.ok) throw new HTTPError(502, `WFP upload failed: ${up.error}`);
    wfpScriptName = up.scriptName;
  }
  const cols = ['display_name', 'description', 'method', 'prompt_template', 'worker_language', 'worker_code', 'enabled'].filter((k) => k in body);
  const set = [...cols.map((k) => `${k} = ?`), `wfp_script_name = ?`, `updated_at = datetime('now')`].join(', ');
  await c.env.DB.prepare(`UPDATE ai_endpoints SET ${set} WHERE id = ?`)
    .bind(...cols.map((k) => body[k]), wfpScriptName, c.req.param('endpointId'))
    .run();
  return c.json({ data: { saved: true } });
});

aiAdmin.delete('/api/sites/:siteId/ai-endpoints/:endpointId', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const row = await c.env.DB.prepare(
    `SELECT wfp_script_name FROM ai_endpoints WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('endpointId'), siteId)
    .first<{ wfp_script_name: string | null }>();
  if (!row) throw new HTTPError(404, 'Endpoint not found');
  if (row.wfp_script_name) await deleteUserWorker(c.env, row.wfp_script_name);
  await c.env.DB.prepare(`DELETE FROM ai_endpoints WHERE id = ?`).bind(c.req.param('endpointId')).run();
  return c.json({ data: { deleted: true } });
});

/* ────────────────────────── AI Credits + Spend Alerts ────────────────────────── */

aiAdmin.get('/api/billing/credits', async (c) => {
  const { orgId } = need(c);
  const balance = await getBalance(c.env, orgId);
  const ledger = await c.env.DB.prepare(
    `SELECT delta, reason, stripe_session_id, created_at FROM ai_credits_ledger
     WHERE org_id = ? ORDER BY created_at DESC LIMIT 50`,
  )
    .bind(orgId)
    .all();
  return c.json({
    data: {
      balance,
      bundles: CREDIT_BUNDLES,
      ledger: ledger.results ?? [],
    },
  });
});

aiAdmin.post('/api/billing/credits/topup', async (c) => {
  const { orgId } = need(c);
  const { bundle } = (await c.req.json()) as { bundle: BundleKey };
  const cfg = CREDIT_BUNDLES[bundle];
  if (!cfg) throw new HTTPError(400, 'unknown bundle');
  const priceKey = cfg.price_id as keyof Env;
  const priceId = c.env[priceKey] as string | undefined;
  if (!priceId) {
    // DEV fallback: credit immediately. In prod this would be a Stripe Checkout.
    const fresh = await topupCredits(c.env, { orgId, amount: cfg.credits, reason: 'topup_dev' });
    return c.json({ data: { mode: 'dev', balance: fresh } });
  }
  const params = new URLSearchParams({
    'mode': 'payment',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'success_url': `https://projectsites.dev/admin/billing?topup=success&bundle=${bundle}`,
    'cancel_url': `https://projectsites.dev/admin/billing?topup=cancel`,
    'metadata[org_id]': orgId,
    'metadata[bundle]': bundle,
    'metadata[credits]': String(cfg.credits),
  });
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  const json = (await res.json()) as { url?: string; id?: string };
  if (!res.ok || !json.url) throw new HTTPError(502, 'Stripe session creation failed');
  return c.json({ data: { mode: 'stripe', url: json.url, session_id: json.id } });
});

aiAdmin.get('/api/billing/spend-alerts', async (c) => {
  const { orgId } = need(c);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM spend_alerts WHERE org_id = ? ORDER BY created_at DESC`,
  )
    .bind(orgId)
    .all();
  return c.json({ data: rows.results ?? [] });
});

aiAdmin.post('/api/billing/spend-alerts', async (c) => {
  const { orgId } = need(c);
  const body = (await c.req.json()) as {
    name: string;
    threshold_credits: number;
    alert_kind: 'balance_low' | 'daily_burn';
    notify_email: string;
  };
  if (!body.name || !body.notify_email || !body.alert_kind) throw new HTTPError(400, 'invalid');
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO spend_alerts (id, org_id, name, threshold_credits, alert_kind, notify_email)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, orgId, body.name, body.threshold_credits, body.alert_kind, body.notify_email)
    .run();
  return c.json({ data: { id } }, 201);
});

aiAdmin.delete('/api/billing/spend-alerts/:id', async (c) => {
  const { orgId } = need(c);
  await c.env.DB.prepare(`DELETE FROM spend_alerts WHERE id = ? AND org_id = ?`)
    .bind(c.req.param('id'), orgId)
    .run();
  return c.json({ data: { deleted: true } });
});

aiAdmin.get('/api/billing/site-costs', async (c) => {
  const { orgId } = need(c);
  const sinceDay = c.req.query('since') ?? new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const rows = await c.env.DB.prepare(
    `SELECT site_id, SUM(ai_calls) AS ai_calls, SUM(ai_credits) AS ai_credits,
            SUM(bandwidth_bytes) AS bandwidth_bytes, SUM(storage_bytes) AS storage_bytes,
            SUM(estimated_cost_micro_usd) AS estimated_cost_micro_usd
     FROM site_cost_daily WHERE org_id = ? AND day >= ?
     GROUP BY site_id ORDER BY estimated_cost_micro_usd DESC`,
  )
    .bind(orgId, sinceDay)
    .all();
  // Enrich with site names.
  const sites = await c.env.DB.prepare(
    `SELECT id, slug, business_name FROM sites WHERE org_id = ? AND deleted_at IS NULL`,
  )
    .bind(orgId)
    .all<{ id: string; slug: string; business_name: string | null }>();
  const byId = new Map((sites.results ?? []).map((s) => [s.id, s]));
  return c.json({
    data: {
      since: sinceDay,
      rows: (rows.results ?? []).map((r) => {
        const s = byId.get(r['site_id'] as string);
        return { ...r, slug: s?.slug, business_name: s?.business_name };
      }),
    },
  });
});

/* ────────────────────────── MCP connections (list + disconnect) ────────────────────────── */

aiAdmin.get('/api/sites/:siteId/mcp/connections', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  const rows = await c.env.DB.prepare(
    `SELECT id, provider, display_name, status, scopes_json, account_metadata_json, connected_at
     FROM mcp_connections WHERE site_id = ? AND status = 'active'`,
  )
    .bind(siteId)
    .all();
  return c.json({
    data: {
      providers: allProviders(),
      connections: (rows.results ?? []).map((r) => ({
        ...r,
        metadata: safeJson(r['account_metadata_json'] as string | null),
      })),
    },
  });
});

aiAdmin.delete('/api/sites/:siteId/mcp/connections/:id', async (c) => {
  const { orgId } = need(c);
  const siteId = c.req.param('siteId');
  await siteOwned(c, orgId, siteId);
  await c.env.DB.prepare(
    `UPDATE mcp_connections SET status = 'revoked', updated_at = datetime('now') WHERE id = ? AND site_id = ?`,
  )
    .bind(c.req.param('id'), siteId)
    .run();
  return c.json({ data: { revoked: true } });
});

/* ────────────────────────── Team (Settings → Team) ────────────────────────── */

aiAdmin.get('/api/team', async (c) => {
  const { orgId } = need(c);
  const members = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.name, m.role, m.created_at
     FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = ? ORDER BY m.created_at ASC`,
  )
    .bind(orgId)
    .all();
  const invites = await c.env.DB.prepare(
    `SELECT id, email, role, created_at, expires_at FROM team_invites
     WHERE org_id = ? AND accepted_at IS NULL ORDER BY created_at DESC`,
  )
    .bind(orgId)
    .all();
  return c.json({ data: { members: members.results ?? [], invites: invites.results ?? [] } });
});

aiAdmin.post('/api/team/invites', async (c) => {
  const { orgId, userId } = need(c);
  const { email, role } = (await c.req.json()) as { email: string; role: 'owner' | 'editor' | 'viewer' };
  if (!email || !role) throw new HTTPError(400, 'email + role required');
  const id = crypto.randomUUID();
  const token = crypto.randomUUID().replace(/-/g, '');
  const expires = new Date(Date.now() + 14 * 86400 * 1000).toISOString();
  await c.env.DB.prepare(
    `INSERT INTO team_invites (id, org_id, email, role, invite_token, invited_by_user_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, orgId, email, role, token, userId, expires)
    .run();
  if (c.env.RESEND_API_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${c.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'team@projectsites.dev',
        to: [email],
        subject: 'You’ve been invited to a Project Sites team',
        text: `You were invited as ${role}. Accept here: https://projectsites.dev/admin/accept-invite?token=${token}`,
      }),
    }).catch(() => {});
  }
  return c.json({ data: { id, token } }, 201);
});

aiAdmin.delete('/api/team/invites/:id', async (c) => {
  const { orgId } = need(c);
  await c.env.DB.prepare(`DELETE FROM team_invites WHERE id = ? AND org_id = ?`)
    .bind(c.req.param('id'), orgId)
    .run();
  return c.json({ data: { revoked: true } });
});

aiAdmin.delete('/api/team/members/:userId', async (c) => {
  const { orgId } = need(c);
  await c.env.DB.prepare(`DELETE FROM memberships WHERE user_id = ? AND org_id = ?`)
    .bind(c.req.param('userId'), orgId)
    .run();
  return c.json({ data: { removed: true } });
});

/* ────────────────────────── Audit Log (ag-grid friendly) ────────────────────────── */

/* ────────────────────────── Cloudflare Analytics ────────────────────────── */

// Public, unauthenticated — the admin SPA fires this on every route change.
// Records one Analytics Engine data point. Seeds a sentinel visit on first
// hit so the Analytics page always shows ≥ 1 visit out of the box.
aiAdmin.post('/api/analytics/track', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { route?: string; site_id?: string };
  const orgId = (c.get('orgId') as string | undefined) ?? 'anonymous';
  recordEvent(c.env, {
    event: 'admin_visit',
    routePath: body.route ?? '/admin',
    siteId: body.site_id ?? null,
    orgId,
    userAgent: c.req.header('user-agent'),
    referrer: c.req.header('referer'),
    country: c.req.header('cf-ipcountry'),
  });
  return c.json({ data: { tracked: true } });
});

aiAdmin.get('/api/analytics/overview', async (c) => {
  const { orgId } = need(c);
  // Seed at least one visit so the page never reads empty on first load.
  recordEvent(c.env, {
    event: 'admin_visit',
    routePath: '/admin/analytics',
    orgId,
    userAgent: c.req.header('user-agent'),
    country: c.req.header('cf-ipcountry'),
  });
  try {
    const data = await loadOverview(c.env, orgId);
    return c.json({ data });
  } catch (err) {
    return c.json({
      error: { message: err instanceof Error ? err.message : 'analytics unavailable' },
      data: null,
    }, 200);
  }
});

aiAdmin.get('/api/audit/rows', async (c) => {
  const { orgId } = need(c);
  const limit = Math.min(Number(c.req.query('limit') ?? 500), 5000);
  const rows = await c.env.DB.prepare(
    `SELECT id, action, target_type, target_id, actor_id, metadata_json, request_id, created_at
     FROM audit_logs WHERE org_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(orgId, limit)
    .all();
  return c.json({
    data: (rows.results ?? []).map((r) => ({
      ...r,
      metadata: safeJson(r['metadata_json'] as string | null),
    })),
  });
});
