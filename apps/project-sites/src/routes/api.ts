/**
 * @module routes/api
 * @description Authenticated API routes for Project Sites.
 *
 * Mounts all JSON API endpoints under `/api/*` that require (or benefit from)
 * authentication context. Every route reads the D1 database via `c.env.DB`.
 *
 * ## Route Map
 *
 * | Method | Path                              | Description                   |
 * | ------ | --------------------------------- | ----------------------------- |
 * | POST   | `/api/auth/magic-link`            | Request a magic-link email    |
 * | GET    | `/api/auth/magic-link/verify`     | Verify a magic-link token (email click) |
 * | POST   | `/api/auth/magic-link/verify`     | Verify a magic-link token (API)  |
 * | GET    | `/api/auth/google`                | Start Google OAuth flow       |
 * | GET    | `/api/auth/google/callback`       | Google OAuth callback         |
 * | POST   | `/api/sites`                      | Create a new site             |
 * | GET    | `/api/sites`                      | List org sites                |
 * | GET    | `/api/sites/:id`                  | Get a single site             |
 * | POST   | `/api/billing/checkout`           | Create Stripe checkout        |
 * | GET    | `/api/billing/subscription`       | Get org subscription          |
 * | GET    | `/api/billing/entitlements`       | Get org entitlements          |
 * | GET    | `/api/sites/:siteId/hostnames`    | List site hostnames           |
 * | POST   | `/api/sites/:siteId/hostnames`    | Provision a hostname          |
 * | GET    | `/api/audit-logs`                 | List org audit logs           |
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import {
  createSiteSchema,
  createCheckoutSessionSchema,
  createMagicLinkSchema,
  verifyMagicLinkSchema,
  createHostnameSchema,
  DOMAINS,
  badRequest,
  notFound,
  forbidden,
  unauthorized,
} from '@project-sites/shared';
import * as authService from '../services/auth.js';
import * as billingService from '../services/billing.js';
import * as domainService from '../services/domains.js';
import * as auditService from '../services/audit.js';
import * as contactService from '../services/contact.js';
import * as posthog from '../lib/posthog.js';
import { captureError } from '../lib/sentry.js';

const api = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Auth Routes ─────────────────────────────────────────────

api.post('/api/auth/magic-link', async (c) => {
  const body = await c.req.json();
  const validated = createMagicLinkSchema.parse(body);
  const result = await authService.createMagicLink(c.env.DB, c.env, validated);
  posthog.trackAuth(c.env, c.executionCtx, 'magic_link', 'requested', validated.email);
  return c.json({ data: { expires_at: result.expires_at } });
});

// GET handler: user clicks the magic link in their email → verify & redirect to homepage
api.get('/api/auth/magic-link/verify', async (c) => {
  const token = c.req.query('token');
  if (!token) {
    return c.redirect('/?error=missing_token');
  }

  try {
    const validated = verifyMagicLinkSchema.parse({ token });
    const result = await authService.verifyMagicLink(c.env.DB, validated);

    const user = await authService.findOrCreateUser(c.env.DB, { email: result.email });
    const session = await authService.createSession(c.env.DB, user.user_id);

    if (result.redirect_url) {
      const redirectTarget = new URL(result.redirect_url);
      redirectTarget.searchParams.set('token', session.token);
      redirectTarget.searchParams.set('email', result.email);
      redirectTarget.searchParams.set('auth_callback', 'email');
      return c.redirect(redirectTarget.toString());
    }

    // Default: redirect to homepage with auth params
    const baseUrl =
      c.env.ENVIRONMENT === 'production'
        ? 'https://sites.megabyte.space'
        : 'https://sites-staging.megabyte.space';
    posthog.trackAuth(c.env, c.executionCtx, 'magic_link', 'verified', result.email);
    return c.redirect(
      `${baseUrl}/?token=${encodeURIComponent(session.token)}&email=${encodeURIComponent(result.email)}&auth_callback=email`,
    );
  } catch (err) {
    captureError(c, err, { route: 'magic-link-verify-get' });
    posthog.trackAuth(c.env, c.executionCtx, 'magic_link', 'failed', 'unknown');
    return c.redirect('/?error=invalid_or_expired_link');
  }
});

// POST handler: programmatic API verification
api.post('/api/auth/magic-link/verify', async (c) => {
  const body = await c.req.json();
  const validated = verifyMagicLinkSchema.parse(body);
  const result = await authService.verifyMagicLink(c.env.DB, validated);

  const user = await authService.findOrCreateUser(c.env.DB, { email: result.email });
  const session = await authService.createSession(c.env.DB, user.user_id);

  if (result.redirect_url) {
    const redirectTarget = new URL(result.redirect_url);
    redirectTarget.searchParams.set('token', session.token);
    redirectTarget.searchParams.set('email', result.email);
    return c.redirect(redirectTarget.toString());
  }

  return c.json({
    data: {
      token: session.token,
      email: result.email,
      user_id: user.user_id,
      org_id: user.org_id,
    },
  });
});

api.get('/api/auth/google', async (c) => {
  const redirectUrl = c.req.query('redirect_url');
  const result = await authService.createGoogleOAuthState(c.env.DB, c.env, redirectUrl);
  return c.redirect(result.authUrl);
});

api.get('/api/auth/google/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    throw badRequest('Missing code or state parameter');
  }

  const result = await authService.handleGoogleOAuthCallback(c.env.DB, c.env, code, state);

  const user = await authService.findOrCreateUser(c.env.DB, {
    email: result.email,
    display_name: result.display_name ?? undefined,
    avatar_url: result.avatar_url ?? undefined,
  });
  const session = await authService.createSession(c.env.DB, user.user_id);

  // Redirect to the original redirect_url (or homepage) with token and email
  const baseUrl =
    c.env.ENVIRONMENT === 'production'
      ? 'https://sites.megabyte.space'
      : 'https://sites-staging.megabyte.space';

  const redirectTarget = new URL(result.redirect_url ?? baseUrl);
  redirectTarget.searchParams.set('token', session.token);
  redirectTarget.searchParams.set('email', result.email);
  posthog.trackAuth(c.env, c.executionCtx, 'google_oauth', 'verified', result.email);
  return c.redirect(redirectTarget.toString());
});

// ─── Session Validation ─────────────────────────────────────

api.get('/api/auth/me', async (c) => {
  const userId = c.get('userId');
  const orgId = c.get('orgId');
  if (!userId) throw unauthorized('Must be authenticated');

  const user = await dbQueryOne<{ email: string; display_name: string | null }>(
    c.env.DB,
    'SELECT email, display_name FROM users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  );
  if (!user) throw unauthorized('User not found');

  return c.json({
    data: { user_id: userId, org_id: orgId, email: user.email, display_name: user.display_name },
  });
});

// ─── Sites Routes ────────────────────────────────────────────

api.post('/api/sites', async (c) => {
  const body = await c.req.json();
  const validated = createSiteSchema.parse(body);

  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const slug =
    validated.slug ??
    validated.business_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 63);

  const site = {
    id: crypto.randomUUID(),
    org_id: orgId,
    slug,
    business_name: validated.business_name,
    business_phone: validated.business_phone ?? null,
    business_email: validated.business_email ?? null,
    business_address: validated.business_address ?? null,
    google_place_id: validated.google_place_id ?? null,
    bolt_chat_id: null,
    current_build_version: null,
    status: 'draft',
    lighthouse_score: null,
    lighthouse_last_run: null,
    deleted_at: null,
  };

  const result = await dbInsert(c.env.DB, 'sites', site);

  if (result.error) {
    throw badRequest(`Failed to create site: ${result.error}`);
  }

  // Log audit
  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.created',
    target_type: 'site',
    target_id: site.id,
    request_id: c.get('requestId'),
  });

  return c.json({ data: site }, 201);
});

api.get('/api/sites', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const { data } = await dbQuery<Record<string, unknown>>(
    c.env.DB,
    'SELECT * FROM sites WHERE org_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
    [orgId],
  );

  return c.json({ data });
});

api.get('/api/sites/:id', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  const site = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    'SELECT * FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );

  if (!site) {
    throw notFound('Site not found');
  }

  return c.json({ data: site });
});

// ─── Workflow Status ─────────────────────────────────────────

api.get('/api/sites/:id/workflow', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');

  // Verify the site belongs to this org
  const site = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    'SELECT id, status FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );

  if (!site) {
    throw notFound('Site not found');
  }

  if (!c.env.SITE_WORKFLOW) {
    return c.json({
      data: {
        site_id: siteId,
        workflow_available: false,
        site_status: site.status,
      },
    });
  }

  try {
    const instance = await c.env.SITE_WORKFLOW.get(siteId);
    const status = await instance.status();
    return c.json({
      data: {
        site_id: siteId,
        workflow_available: true,
        instance_id: instance.id,
        workflow_status: status.status,
        workflow_error: status.error ?? null,
        workflow_output: status.output ?? null,
        site_status: site.status,
      },
    });
  } catch {
    // Instance not found — may have been created before workflows were enabled
    return c.json({
      data: {
        site_id: siteId,
        workflow_available: true,
        instance_id: null,
        workflow_status: null,
        site_status: site.status,
      },
    });
  }
});

// ─── Billing Routes ──────────────────────────────────────────

api.post('/api/billing/checkout', async (c) => {
  const body = await c.req.json();
  const validated = createCheckoutSessionSchema.parse(body);

  const orgId = c.get('orgId');
  if (!orgId || orgId !== validated.org_id) {
    throw forbidden('Cannot create checkout for another org');
  }

  const result = await billingService.createCheckoutSession(c.env.DB, c.env, {
    orgId: validated.org_id,
    siteId: validated.site_id,
    customerEmail: '', // Retrieved from user context
    successUrl: validated.success_url,
    cancelUrl: validated.cancel_url,
  });

  return c.json({ data: result });
});

api.get('/api/billing/subscription', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const sub = await billingService.getOrgSubscription(c.env.DB, orgId);
  return c.json({ data: sub });
});

api.get('/api/billing/entitlements', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const entitlements = await billingService.getOrgEntitlements(c.env.DB, orgId);
  return c.json({ data: entitlements });
});

// ─── Hostname Routes ─────────────────────────────────────────

api.get('/api/sites/:siteId/hostnames', async (c) => {
  const siteId = c.req.param('siteId');

  const hostnames = await domainService.getSiteHostnames(c.env.DB, siteId);
  return c.json({ data: hostnames });
});

api.post('/api/sites/:siteId/hostnames', async (c) => {
  const body = await c.req.json();
  const siteId = c.req.param('siteId');
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const validated = createHostnameSchema.parse({ ...body, site_id: siteId });

  let result;
  if (validated.type === 'free_subdomain') {
    // Extract slug from hostname
    const slug = validated.hostname.split('.')[0]!;
    result = await domainService.provisionFreeDomain(c.env.DB, c.env, {
      org_id: orgId,
      site_id: siteId,
      slug,
    });
  } else {
    // Check entitlements for custom domains
    const entitlements = await billingService.getOrgEntitlements(c.env.DB, orgId);
    if (!entitlements.topBarHidden) {
      throw forbidden('Custom domains require a paid plan');
    }

    result = await domainService.provisionCustomDomain(c.env.DB, c.env, {
      org_id: orgId,
      site_id: siteId,
      hostname: validated.hostname,
    });
  }

  // Log audit
  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'hostname.provisioned',
    target_type: 'hostname',
    metadata_json: { hostname: result.hostname, type: validated.type },
    request_id: c.get('requestId'),
  });

  return c.json({ data: result }, 201);
});

// ─── Delete Site ────────────────────────────────────────────

api.delete('/api/sites/:id', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  const site = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    'SELECT id, slug FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );

  if (!site) {
    throw notFound('Site not found');
  }

  // Soft-delete
  await c.env.DB.prepare('UPDATE sites SET deleted_at = datetime(\'now\'), status = \'archived\' WHERE id = ?').bind(siteId).run();

  // Invalidate KV cache for the site's subdomain
  const slug = site.slug as string;
  if (slug) {
    await c.env.CACHE_KV.delete(`host:${slug}-sites.megabyte.space`).catch(() => {});
  }

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.deleted',
    target_type: 'site',
    metadata_json: { site_id: siteId, slug },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { deleted: true } });
});

// ─── Delete Hostname ────────────────────────────────────────

api.delete('/api/sites/:siteId/hostnames/:hostnameId', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('siteId');
  const hostnameId = c.req.param('hostnameId');

  // Verify ownership
  const site = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    'SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  const hostname = await dbQueryOne<{ id: string; hostname: string }>(
    c.env.DB,
    'SELECT id, hostname FROM hostnames WHERE id = ? AND site_id = ?',
    [hostnameId, siteId],
  );
  if (!hostname) throw notFound('Hostname not found');

  await c.env.DB.prepare('DELETE FROM hostnames WHERE id = ?').bind(hostnameId).run();

  // Invalidate KV cache
  await c.env.CACHE_KV.delete(`host:${hostname.hostname}`).catch(() => {});

  return c.json({ data: { deleted: true } });
});

// ─── Billing Portal ─────────────────────────────────────────

api.post('/api/billing/portal', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const body = await c.req.json();
  const returnUrl = (body as { return_url?: string }).return_url || 'https://sites.megabyte.space';

  // Look up Stripe customer ID for this org
  const sub = await dbQueryOne<{ stripe_customer_id: string | null }>(
    c.env.DB,
    'SELECT stripe_customer_id FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
    [orgId],
  );

  if (!sub?.stripe_customer_id) {
    throw badRequest('No billing account found. Please subscribe first.');
  }

  const result = await billingService.createBillingPortalSession(c.env, sub.stripe_customer_id, returnUrl);
  return c.json({ data: result });
});

// ─── Audit Routes ────────────────────────────────────────────

api.get('/api/audit-logs', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const limit = Number(c.req.query('limit') ?? '50');
  const offset = Number(c.req.query('offset') ?? '0');

  const result = await auditService.getAuditLogs(c.env.DB, orgId, { limit, offset });
  return c.json({ data: result.data });
});

// ─── Bolt Publish Route ─────────────────────────────────────

/**
 * Publish a bolt.diy project to Project Sites R2 storage.
 *
 * Accepts dist/ files and chat export, generates a slug via AI if needed,
 * and makes the site available at {slug}-sites.megabyte.space.
 *
 * No auth required — bolt.diy users publish freely under the "free" plan.
 */
api.post('/api/publish/bolt', async (c) => {
  const body = await c.req.json();
  const { files, chat, slug: existingSlug } = body as {
    files: { path: string; content: string }[];
    chat: { messages: unknown[]; description?: string; exportDate: string };
    slug: string | null;
  };

  if (!files || !Array.isArray(files) || files.length === 0) {
    throw badRequest('No files provided');
  }

  // Determine slug
  let slug: string;

  if (existingSlug) {
    slug = existingSlug;
  } else {
    slug = await generateSlugFromChat(c.env, chat);
    slug = await ensureUniqueSlug(c.env, slug);
  }

  // Generate version
  const version = new Date().toISOString().replace(/[:.]/g, '-');

  // MIME type map for content-type headers
  const mimeTypes: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    mjs: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
    webp: 'image/webp',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    xml: 'application/xml',
    txt: 'text/plain',
    webmanifest: 'application/manifest+json',
  };

  // Upload all dist files to R2
  const uploads: Promise<R2Object>[] = files.map((f) => {
    const ext = f.path.split('.').pop()?.toLowerCase() ?? '';
    const contentType = mimeTypes[ext] ?? 'application/octet-stream';

    return c.env.SITES_BUCKET.put(
      `sites/${slug}/${version}/${f.path}`,
      f.content,
      { httpMetadata: { contentType } },
    );
  });

  // Store chat export as meta file (not publicly served)
  uploads.push(
    c.env.SITES_BUCKET.put(
      `sites/${slug}/${version}/_meta/chat.json`,
      JSON.stringify(chat, null, 2),
      { httpMetadata: { contentType: 'application/json' } },
    ),
  );

  // Write/update manifest with current version
  uploads.push(
    c.env.SITES_BUCKET.put(
      `sites/${slug}/_manifest.json`,
      JSON.stringify({
        current_version: version,
        slug,
        updated_at: new Date().toISOString(),
        source: 'bolt',
      }),
      { httpMetadata: { contentType: 'application/json' } },
    ),
  );

  await Promise.all(uploads);

  // Invalidate KV cache for this slug's hostname
  const hostSuffix = c.env.ENVIRONMENT === 'production'
    ? DOMAINS.SITES_SUFFIX
    : DOMAINS.SITES_STAGING_SUFFIX;
  const cacheKey = `host:${slug}${hostSuffix}`;
  await c.env.CACHE_KV.delete(cacheKey);

  const siteUrl = `https://${slug}${hostSuffix}`;

  return c.json({
    data: {
      slug,
      version,
      url: siteUrl,
      files_uploaded: files.length,
    },
  }, 201);
});

/**
 * Generate a slug from chat export data.
 * Uses the chat description (project title) with simple slugification.
 * Falls back to Workers AI for complex names, then random suffix.
 */
async function generateSlugFromChat(
  env: Env,
  chat: { messages?: unknown[]; description?: string },
): Promise<string> {
  // 1. Try simple slugification of description
  if (chat?.description) {
    const simple = chat.description
      .toLowerCase()
      .replace(/'/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 63);

    if (simple && simple.length >= 3) {
      return simple;
    }
  }

  // 2. Try AI slug generation from chat messages
  try {
    const messages = (chat?.messages ?? []) as { role?: string; content?: string }[];
    const firstUserMsg = messages.find((m) => m.role === 'user')?.content ?? '';

    const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct' as Parameters<typeof env.AI.run>[0], {
      messages: [
        {
          role: 'system',
          content: 'Generate a short URL slug for a website. Output ONLY the slug, nothing else. Use lowercase letters, numbers, and hyphens. Maximum 3-4 words. Examples: vitos-mens-salon, pizza-palace, janes-bakery',
        },
        {
          role: 'user',
          content: `Project: ${chat?.description ?? 'Unknown'}\nContext: ${firstUserMsg.substring(0, 300)}`,
        },
      ],
      max_tokens: 50,
    });

    const response = (result as { response?: string }).response ?? '';
    const aiSlug = response
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 63);

    if (aiSlug && aiSlug.length >= 3) {
      return aiSlug;
    }
  } catch {
    // AI unavailable or failed — fall through to random slug
  }

  // 3. Fallback: random slug
  return `site-${Date.now().toString(36)}`;
}

/**
 * Ensure the slug is unique by checking R2 for existing manifests.
 * Appends incrementing suffix if taken.
 */
async function ensureUniqueSlug(env: Env, slug: string): Promise<string> {
  let candidate = slug;

  for (let attempt = 0; attempt < 10; attempt++) {
    const manifest = await env.SITES_BUCKET.get(`sites/${candidate}/_manifest.json`);

    if (!manifest) {
      return candidate;
    }

    candidate = `${slug}-${attempt + 2}`;
  }

  // All attempts exhausted — use random suffix
  return `${slug}-${Date.now().toString(36).slice(-4)}`;
}

// ─── Contact Form Route ─────────────────────────────────────

api.post('/api/contact', async (c) => {
  const body = await c.req.json();
  await contactService.handleContactForm(c.env, body);
  return c.json({ data: { success: true } });
});

export { api };
