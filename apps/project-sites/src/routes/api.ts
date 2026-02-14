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
  badRequest,
  notFound,
  forbidden,
  unauthorized,
} from '@project-sites/shared';
import * as authService from '../services/auth.js';
import * as billingService from '../services/billing.js';
import * as domainService from '../services/domains.js';
import * as auditService from '../services/audit.js';
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

// ─── Audit Routes ────────────────────────────────────────────

api.get('/api/audit-logs', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const limit = Number(c.req.query('limit') ?? '50');
  const offset = Number(c.req.query('offset') ?? '0');

  const result = await auditService.getAuditLogs(c.env.DB, orgId, { limit, offset });
  return c.json({ data: result.data });
});

export { api };
