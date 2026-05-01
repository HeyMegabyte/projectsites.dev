/**
 * @module routes/forms
 * @description Standardized forms + newsletter integrations API.
 *
 * Two surfaces:
 *
 * 1. **Public ingest** — `POST /api/v1/forms/submit`
 *    Any *.projectsites.dev site (or external client) posts here with the
 *    `X-Site-Slug` header. We capture the submission to D1 and fan out to
 *    every active newsletter integration on that site.
 *
 * 2. **Auth-gated CRUD** — `/api/sites/:siteId/{forms,integrations}`
 *    Used by the Dashboard E-mail tab to list submissions, connect/disconnect
 *    providers, and toggle integrations.
 *
 * Provider-specific dispatch lives in `services/newsletter_dispatch.ts`.
 */

import { Hono } from 'hono';
import {
  badRequest,
  forbidden,
  notFound,
  unauthorized,
  createIntegrationSchema,
  updateIntegrationSchema,
  formSubmissionInputSchema,
  DOMAINS,
} from '@project-sites/shared';
import type { Env, Variables } from '../types/env.js';
import { dbExecute, dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import {
  dispatchToIntegrations,
  type IntegrationRow,
} from '../services/newsletter_dispatch.js';

const forms = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Public ingest ───────────────────────────────────────────

forms.post('/api/v1/forms/submit', async (c) => {
  const slug = c.req.header('x-site-slug') ?? c.req.query('slug');
  if (!slug) throw badRequest('Missing X-Site-Slug header');

  const site = await dbQueryOne<{ id: string; org_id: string; slug: string }>(
    c.env.DB,
    'SELECT id, org_id, slug FROM sites WHERE slug = ? AND deleted_at IS NULL',
    [slug],
  );
  if (!site) throw notFound('Site not found');

  // Origin allow-list: default subdomain + any provisioned hostname for the site.
  const origin = c.req.header('origin') ?? '';
  const allowed = new Set<string>([
    `https://${site.slug}${DOMAINS.SITES_SUFFIX}`,
    `https://${DOMAINS.SITES_BASE}`,
  ]);
  const hostnames = await dbQuery<{ hostname: string }>(
    c.env.DB,
    'SELECT hostname FROM hostnames WHERE site_id = ? AND deleted_at IS NULL',
    [site.id],
  );
  for (const row of hostnames.data) {
    allowed.add(`https://${row.hostname}`);
  }
  // Allow no-origin (curl, server-side) and localhost dev origins.
  const isAllowed =
    !origin ||
    allowed.has(origin) ||
    origin.startsWith('http://localhost:') ||
    origin.startsWith('http://127.0.0.1:');
  if (!isAllowed) throw forbidden(`Origin not allowed for site ${slug}`);

  const body = await c.req.json().catch(() => null);
  const validated = formSubmissionInputSchema.parse(body ?? {});

  const ip =
    c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = c.req.header('user-agent')?.slice(0, 512) ?? null;

  const submissionId = crypto.randomUUID();
  const submittedAt = new Date().toISOString();

  // Active integrations get fanned out in parallel.
  const integrationsResult = await dbQuery<IntegrationRow>(
    c.env.DB,
    `SELECT id, site_id, provider, api_key_encrypted, list_id, webhook_url, config
     FROM newsletter_integrations
     WHERE site_id = ? AND active = 1 AND deleted_at IS NULL`,
    [site.id],
  );

  const dispatchResults = await dispatchToIntegrations(
    {
      site_id: site.id,
      site_slug: site.slug,
      form_name: validated.form_name,
      email: validated.email,
      fields: validated.fields,
      origin_url: validated.origin_url ?? c.req.header('referer') ?? undefined,
      ip_address: ip ?? undefined,
      user_agent: userAgent ?? undefined,
      submitted_at: submittedAt,
    },
    integrationsResult.data,
  );

  const successful = dispatchResults.filter((r) => r.ok);
  const failures = dispatchResults.filter((r) => !r.ok);
  const status: 'received' | 'forwarded' | 'partial' | 'failed' =
    integrationsResult.data.length === 0
      ? 'received'
      : failures.length === 0
        ? 'forwarded'
        : successful.length === 0
          ? 'failed'
          : 'partial';

  await dbInsert(c.env.DB, 'form_submissions', {
    id: submissionId,
    site_id: site.id,
    org_id: site.org_id,
    form_name: validated.form_name,
    email: validated.email ?? null,
    payload: JSON.stringify(validated.fields),
    ip_address: ip,
    user_agent: userAgent,
    origin_url: validated.origin_url ?? c.req.header('referer') ?? null,
    forwarded_to: JSON.stringify(successful.map((r) => `${r.provider}:${r.integration_id}`)),
    status,
    created_at: submittedAt,
  });

  // Update integration health metadata.
  for (const result of dispatchResults) {
    if (result.ok) {
      await dbExecute(
        c.env.DB,
        'UPDATE newsletter_integrations SET last_dispatch_at = ?, last_error = NULL, updated_at = ? WHERE id = ?',
        [submittedAt, submittedAt, result.integration_id],
      );
    } else {
      await dbExecute(
        c.env.DB,
        'UPDATE newsletter_integrations SET last_error = ?, updated_at = ? WHERE id = ?',
        [String(result.error ?? '').slice(0, 1024), submittedAt, result.integration_id],
      );
    }
  }

  return c.json({
    data: {
      id: submissionId,
      status,
      forwarded: successful.length,
      failed: failures.length,
      received_at: submittedAt,
    },
  });
});

// ─── Auth-gated CRUD ─────────────────────────────────────────

async function loadOwnedSite(
  c: { env: Env; req: { param: (key: string) => string | undefined } },
  orgId: string,
): Promise<{ id: string; slug: string }> {
  const siteId = c.req.param('siteId');
  if (!siteId) throw badRequest('Missing siteId');
  const site = await dbQueryOne<{ id: string; slug: string }>(
    c.env.DB,
    'SELECT id, slug FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');
  return site;
}

forms.get('/api/sites/:siteId/forms', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const site = await loadOwnedSite(c, orgId);

  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200);
  const result = await dbQuery<{
    id: string;
    site_id: string;
    form_name: string;
    email: string | null;
    payload: string;
    ip_address: string | null;
    user_agent: string | null;
    origin_url: string | null;
    forwarded_to: string | null;
    status: string;
    created_at: string;
  }>(
    c.env.DB,
    `SELECT id, site_id, form_name, email, payload, ip_address, user_agent, origin_url, forwarded_to, status, created_at
     FROM form_submissions
     WHERE site_id = ?
     ORDER BY created_at DESC
     LIMIT ?`,
    [site.id, limit],
  );

  return c.json({
    data: result.data.map((r) => ({
      id: r.id,
      site_id: r.site_id,
      form_name: r.form_name,
      email: r.email,
      payload: safeJson(r.payload, {}),
      ip_address: r.ip_address,
      user_agent: r.user_agent,
      origin_url: r.origin_url,
      forwarded_to: safeJson<string[]>(r.forwarded_to, []),
      status: r.status,
      created_at: r.created_at,
    })),
  });
});

forms.get('/api/sites/:siteId/integrations', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const site = await loadOwnedSite(c, orgId);

  const result = await dbQuery<{
    id: string;
    site_id: string;
    provider: string;
    list_id: string | null;
    webhook_url: string | null;
    api_key_preview: string | null;
    active: number;
    last_dispatch_at: string | null;
    last_error: string | null;
    config: string | null;
    created_at: string;
    updated_at: string;
  }>(
    c.env.DB,
    `SELECT id, site_id, provider, list_id, webhook_url, api_key_preview, active,
            last_dispatch_at, last_error, config, created_at, updated_at
     FROM newsletter_integrations
     WHERE site_id = ? AND deleted_at IS NULL
     ORDER BY created_at DESC`,
    [site.id],
  );

  return c.json({
    data: result.data.map((r) => ({
      id: r.id,
      site_id: r.site_id,
      provider: r.provider,
      list_id: r.list_id,
      webhook_url: r.webhook_url,
      api_key_preview: r.api_key_preview,
      active: r.active === 1,
      last_dispatch_at: r.last_dispatch_at,
      last_error: r.last_error,
      config: safeJson(r.config, null),
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  });
});

forms.post('/api/sites/:siteId/integrations', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const site = await loadOwnedSite(c, orgId);

  const body = await c.req.json().catch(() => ({}));
  const validated = createIntegrationSchema.parse(body);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await dbInsert(c.env.DB, 'newsletter_integrations', {
    id,
    site_id: site.id,
    org_id: orgId,
    provider: validated.provider,
    api_key_encrypted: validated.api_key ?? null,
    api_key_preview: validated.api_key ? previewKey(validated.api_key) : null,
    list_id: validated.list_id ?? null,
    webhook_url: validated.webhook_url ?? null,
    config: validated.config ? JSON.stringify(validated.config) : null,
    active: 1,
    created_at: now,
    updated_at: now,
  });

  return c.json({
    data: {
      id,
      site_id: site.id,
      provider: validated.provider,
      list_id: validated.list_id ?? null,
      webhook_url: validated.webhook_url ?? null,
      api_key_preview: validated.api_key ? previewKey(validated.api_key) : null,
      active: true,
      last_dispatch_at: null,
      last_error: null,
      config: validated.config ?? null,
      created_at: now,
      updated_at: now,
    },
  });
});

forms.patch('/api/sites/:siteId/integrations/:id', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const site = await loadOwnedSite(c, orgId);

  const id = c.req.param('id');
  const existing = await dbQueryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM newsletter_integrations WHERE id = ? AND site_id = ? AND deleted_at IS NULL',
    [id, site.id],
  );
  if (!existing) throw notFound('Integration not found');

  const body = await c.req.json().catch(() => ({}));
  const validated = updateIntegrationSchema.parse(body);

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (validated.active !== undefined) updates['active'] = validated.active ? 1 : 0;
  if (validated.api_key !== undefined) {
    updates['api_key_encrypted'] = validated.api_key;
    updates['api_key_preview'] = previewKey(validated.api_key);
  }
  if (validated.list_id !== undefined) updates['list_id'] = validated.list_id;
  if (validated.webhook_url !== undefined) updates['webhook_url'] = validated.webhook_url;
  if (validated.config !== undefined) updates['config'] = JSON.stringify(validated.config);

  const keys = Object.keys(updates);
  const setClause = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => updates[k]);
  await dbExecute(
    c.env.DB,
    `UPDATE newsletter_integrations SET ${setClause} WHERE id = ?`,
    [...values, id],
  );

  return c.json({ data: { id, updated: true } });
});

forms.delete('/api/sites/:siteId/integrations/:id', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const site = await loadOwnedSite(c, orgId);

  const id = c.req.param('id');
  const result = await dbExecute(
    c.env.DB,
    "UPDATE newsletter_integrations SET deleted_at = datetime('now'), active = 0 WHERE id = ? AND site_id = ?",
    [id, site.id],
  );
  if (result.changes === 0) throw notFound('Integration not found');
  return c.json({ data: { deleted: true } });
});

// ── helpers ──────────────────────────────────────────────────

function previewKey(key: string): string {
  if (key.length <= 8) return `${key.slice(0, 2)}…${key.slice(-2)}`;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function safeJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export { forms };
