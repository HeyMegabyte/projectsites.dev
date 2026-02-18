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

    await auditService.writeAuditLog(c.env.DB, {
      org_id: user.org_id,
      actor_id: user.user_id,
      action: 'auth.magic_link_verified',
      target_type: 'user',
      target_id: user.user_id,
      metadata_json: { method: 'magic_link' },
      request_id: c.get('requestId'),
    });

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

  await auditService.writeAuditLog(c.env.DB, {
    org_id: user.org_id,
    actor_id: user.user_id,
    action: 'auth.magic_link_verified',
    target_type: 'user',
    target_id: user.user_id,
    metadata_json: { method: 'magic_link' },
    request_id: c.get('requestId'),
  });

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

  await auditService.writeAuditLog(c.env.DB, {
    org_id: user.org_id,
    actor_id: user.user_id,
    action: 'auth.google_oauth_verified',
    target_type: 'user',
    target_id: user.user_id,
    metadata_json: { method: 'google_oauth' },
    request_id: c.get('requestId'),
  });

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

// ─── Check Slug Availability (must be before /api/sites/:id) ──

api.get('/api/slug/check', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const slug = c.req.query('slug');
  const excludeId = c.req.query('exclude_id');

  if (!slug || !slug.trim()) {
    return c.json({ data: { available: false, reason: 'Slug is required' } });
  }

  const normalized = slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);

  if (!normalized || normalized.length < 3) {
    return c.json({ data: { available: false, reason: 'Slug must be at least 3 characters' } });
  }

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(normalized)) {
    return c.json({ data: { available: false, reason: 'Slug must start and end with a letter or number' } });
  }

  const query = excludeId
    ? 'SELECT id FROM sites WHERE slug = ? AND id != ? AND deleted_at IS NULL'
    : 'SELECT id FROM sites WHERE slug = ? AND deleted_at IS NULL';
  const params = excludeId ? [normalized, excludeId] : [normalized];

  const existing = await dbQueryOne<{ id: string }>(c.env.DB, query, params);

  return c.json({
    data: {
      available: !existing,
      slug: normalized,
      reason: existing ? 'Slug is already taken' : null,
    },
  });
});

// ─── List Sites ─────────────────────────────────────────────

api.get('/api/sites', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const { data } = await dbQuery<Record<string, unknown>>(
    c.env.DB,
    'SELECT * FROM sites WHERE org_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
    [orgId],
  );

  // Enrich each site with its primary hostname + custom domain info
  const enriched = await Promise.all(
    data.map(async (site) => {
      const primaryHostname = await domainService.getPrimaryHostname(c.env.DB, site.id as string);
      // Check if site has a custom/premium domain
      const customDomain = await dbQueryOne<{ hostname: string; type: string }>(
        c.env.DB,
        "SELECT hostname, type FROM hostnames WHERE site_id = ? AND type = 'custom_cname' AND deleted_at IS NULL LIMIT 1",
        [site.id as string],
      );
      return {
        ...site,
        primary_hostname: primaryHostname,
        has_premium_domain: !!customDomain,
        premium_domain: customDomain?.hostname ?? null,
      };
    }),
  );

  return c.json({ data: enriched });
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

    // Serialize workflow error to a human-readable string.
    // Cloudflare Workflow status.error can be an Error object, a plain object,
    // or a string — ensure we always return a string for the client.
    let workflowError: string | null = null;
    if (status.error != null) {
      if (typeof status.error === 'string') {
        workflowError = status.error;
      } else if (status.error instanceof Error) {
        workflowError = status.error.message;
      } else if (typeof status.error === 'object') {
        const errObj = status.error as Record<string, unknown>;
        workflowError = (errObj.message as string) ?? (errObj.name as string) ?? JSON.stringify(status.error);
      } else {
        workflowError = String(status.error);
      }
    }

    return c.json({
      data: {
        site_id: siteId,
        workflow_available: true,
        instance_id: instance.id,
        workflow_status: status.status,
        workflow_error: workflowError,
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
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const site = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    'SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

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

    // Validate CNAME points to sites.megabyte.space
    const cnameTarget = await domainService.checkCnameTarget(validated.hostname);
    if (!cnameTarget || cnameTarget !== DOMAINS.SITES_BASE) {
      throw badRequest(
        `The domain "${validated.hostname}" does not have a CNAME record pointing to ${DOMAINS.SITES_BASE}. ` +
        `Please add a CNAME record for "${validated.hostname}" pointing to "${DOMAINS.SITES_BASE}" in your DNS settings, then try again.`,
      );
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
    metadata_json: { site_id: siteId, hostname: result.hostname, type: validated.type },
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
    'SELECT id, slug, plan FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );

  if (!site) {
    throw notFound('Site not found');
  }

  // Check if user wants to also cancel their subscription
  const body = await c.req.json().catch(() => ({}));
  const cancelSubscription = body && (body as Record<string, unknown>).cancel_subscription === true;

  // Soft-delete
  await c.env.DB.prepare("UPDATE sites SET deleted_at = datetime('now'), status = 'archived' WHERE id = ?").bind(siteId).run();

  // Invalidate KV cache for the site's subdomain
  const slug = site.slug as string;
  if (slug) {
    await c.env.CACHE_KV.delete(`host:${slug}-sites.megabyte.space`).catch(() => {});
  }

  // Optionally cancel the Stripe subscription
  let subscriptionCanceled = false;
  if (cancelSubscription && site.plan === 'paid') {
    const sub = await dbQueryOne<{ stripe_subscription_id: string | null }>(
      c.env.DB,
      'SELECT stripe_subscription_id FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
      [orgId],
    );
    if (sub?.stripe_subscription_id && c.env.STRIPE_SECRET_KEY) {
      try {
        await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${btoa(c.env.STRIPE_SECRET_KEY + ':')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'cancel_at_period_end=true',
        });
        subscriptionCanceled = true;
      } catch {
        // Subscription cancel failure shouldn't block site deletion
      }
    }
  }

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.deleted',
    target_type: 'site',
    target_id: siteId,
    metadata_json: { site_id: siteId, slug, subscription_canceled: subscriptionCanceled },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { deleted: true, subscription_canceled: subscriptionCanceled } });
});

// ─── Set Primary Hostname ────────────────────────────────────

api.put('/api/sites/:siteId/hostnames/:hostnameId/primary', async (c) => {
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

  await domainService.setPrimaryHostname(c.env.DB, siteId, hostnameId);

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'hostname.set_primary',
    target_type: 'hostname',
    target_id: hostnameId,
    metadata_json: { site_id: siteId },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { primary: true } });
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

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'hostname.deleted',
    target_type: 'hostname',
    target_id: hostnameId,
    metadata_json: { hostname: hostname.hostname, site_id: siteId },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { deleted: true } });
});

// ─── Unsubscribe Domain (cancel premium domain subscription + delete) ──

api.post('/api/sites/:siteId/hostnames/:hostnameId/unsubscribe', async (c) => {
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

  const hostname = await dbQueryOne<{ id: string; hostname: string; type: string }>(
    c.env.DB,
    'SELECT id, hostname, type FROM hostnames WHERE id = ? AND site_id = ?',
    [hostnameId, siteId],
  );
  if (!hostname) throw notFound('Hostname not found');

  // Soft-delete the hostname
  await c.env.DB.prepare("UPDATE hostnames SET deleted_at = datetime('now') WHERE id = ?")
    .bind(hostnameId)
    .run();

  // Invalidate KV cache
  await c.env.CACHE_KV.delete(`host:${hostname.hostname}`).catch(() => {});

  // Log the unsubscribe action
  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'hostname.unsubscribed',
    target_type: 'hostname',
    target_id: hostnameId,
    metadata_json: { site_id: siteId, hostname: hostname.hostname, type: hostname.type },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { unsubscribed: true, hostname: hostname.hostname } });
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

  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const offset = Math.max(Number(c.req.query('offset') ?? '0'), 0);

  const result = await auditService.getAuditLogs(c.env.DB, orgId, { limit, offset });
  return c.json({ data: result.data });
});

// ─── Site-Specific Logs ─────────────────────────────────────

api.get('/api/sites/:id/logs', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');

  // Verify the site belongs to this org
  const site = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    'SELECT id FROM sites WHERE id = ? AND org_id = ?',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  const limit = Math.min(Number(c.req.query('limit') ?? '100'), 200);
  const offset = Math.max(Number(c.req.query('offset') ?? '0'), 0);

  const result = await auditService.getSiteAuditLogs(c.env.DB, orgId, siteId, { limit, offset });
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

// ─── Chat Export Retrieval Route ─────────────────────────────

/**
 * Retrieve the bolt.diy chat JSON for a given site slug.
 *
 * Reads the _manifest.json to find the current version, then returns
 * the chat export stored at sites/{slug}/{version}/_meta/chat.json.
 *
 * No auth required — the slug serves as an access token.
 */
api.get('/api/sites/by-slug/:slug/chat', async (c) => {
  const slug = c.req.param('slug');

  // Read manifest to get current version
  const manifest = await c.env.SITES_BUCKET.get(`sites/${slug}/_manifest.json`);

  if (!manifest) {
    throw notFound('Site not found or no version published');
  }

  const manifestData = (await manifest.json()) as { current_version: string };

  if (!manifestData.current_version) {
    throw notFound('No published version found');
  }

  // Read chat JSON from R2
  const chatObj = await c.env.SITES_BUCKET.get(
    `sites/${slug}/${manifestData.current_version}/_meta/chat.json`,
  );

  if (!chatObj) {
    throw notFound('No chat export found for this site');
  }

  const chatData = await chatObj.text();

  return new Response(chatData, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

// ─── Update Site (Title / Slug) ──────────────────────────────

api.patch('/api/sites/:id', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  const body = (await c.req.json()) as {
    business_name?: string;
    slug?: string;
  };

  // Verify ownership
  const site = await dbQueryOne<{ id: string; slug: string; org_id: string }>(
    c.env.DB,
    'SELECT id, slug, org_id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  const updates: string[] = [];
  const params: unknown[] = [];

  if (body.business_name && body.business_name.trim()) {
    updates.push('business_name = ?');
    params.push(body.business_name.trim().slice(0, 200));
  }

  if (body.slug && body.slug.trim()) {
    const newSlug = body.slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100);

    if (newSlug && newSlug !== site.slug) {
      // Check uniqueness
      const existing = await dbQueryOne<{ id: string }>(
        c.env.DB,
        'SELECT id FROM sites WHERE slug = ? AND id != ? AND deleted_at IS NULL',
        [newSlug, siteId],
      );
      if (existing) throw badRequest('Slug "' + newSlug + '" is already taken');

      updates.push('slug = ?');
      params.push(newSlug);

      // Invalidate old KV cache
      if (site.slug) {
        await c.env.CACHE_KV.delete(`host:${site.slug}-sites.megabyte.space`).catch(() => {});
      }
    }
  }

  if (updates.length === 0) {
    return c.json({ data: { updated: false } });
  }

  updates.push('updated_at = datetime(\'now\')');
  params.push(siteId);

  await c.env.DB.prepare(`UPDATE sites SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run();

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.updated',
    target_type: 'site',
    target_id: siteId,
    metadata_json: { site_id: siteId, ...body },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { updated: true } });
});

// ─── Reset Site (Re-crawl & Rebuild) ─────────────────────────

api.post('/api/sites/:id/reset', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');

  // Verify ownership
  const site = await dbQueryOne<{ id: string; slug: string; org_id: string }>(
    c.env.DB,
    'SELECT id, slug, org_id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  const body = (await c.req.json()) as {
    business?: { name?: string; address?: string; place_id?: string };
    additional_context?: string;
  };

  // Update business info if provided
  const updates: string[] = ['status = \'building\'', 'updated_at = datetime(\'now\')'];
  const params: unknown[] = [];

  if (body.business?.name) {
    updates.push('business_name = ?');
    params.push(body.business.name.trim().slice(0, 200));
  }
  if (body.business?.address) {
    updates.push('business_address = ?');
    params.push(body.business.address.trim().slice(0, 500));
  }
  if (body.business?.place_id) {
    updates.push('google_place_id = ?');
    params.push(body.business.place_id);
  }
  if (body.additional_context) {
    updates.push('additional_context = ?');
    params.push(body.additional_context.slice(0, 5000));
  }

  params.push(siteId);
  await c.env.DB.prepare(`UPDATE sites SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run();

  // Trigger rebuild workflow
  let workflowInstanceId: string | null = null;
  if (c.env.SITE_WORKFLOW) {
    try {
      const instance = await c.env.SITE_WORKFLOW.create({
        id: siteId,
        params: {
          siteId,
          slug: site.slug,
          businessName: body.business?.name || '',
          businessAddress: body.business?.address || '',
          additionalContext: body.additional_context || '',
          isReset: true,
        },
      });
      workflowInstanceId = instance.id;
    } catch {
      // Workflow creation may fail if instance with same ID exists
      // Try with a unique suffix
      try {
        const resetId = `${siteId}-reset-${Date.now()}`;
        const instance = await c.env.SITE_WORKFLOW.create({
          id: resetId,
          params: {
            siteId,
            slug: site.slug,
            businessName: body.business?.name || '',
            businessAddress: body.business?.address || '',
            additionalContext: body.additional_context || '',
            isReset: true,
          },
        });
        workflowInstanceId = instance.id;
      } catch {
        // Workflow not available
      }
    }
  }

  try {
    await auditService.writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'site.reset',
      target_type: 'site',
      target_id: siteId,
      metadata_json: { site_id: siteId, slug: site.slug },
      request_id: c.get('requestId'),
    });
  } catch {
    // Audit log failure should not block reset
    console.warn('Failed to write audit log for site.reset');
  }

  return c.json({
    data: {
      site_id: siteId,
      slug: site.slug,
      status: 'building',
      workflow_instance_id: workflowInstanceId,
    },
  });
});

// ─── Deploy to Site (ZIP + JSON upload) ──────────────────────

api.post('/api/sites/:id/deploy', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');

  // Verify ownership
  const site = await dbQueryOne<{ id: string; slug: string; org_id: string }>(
    c.env.DB,
    'SELECT id, slug, org_id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  const formData = await c.req.formData();
  const zipFile = formData.get('zip') as File | null;
  const chatFile = formData.get('chat') as File | null;
  const distPath = ((formData.get('dist_path') as string) || 'dist/').replace(/\/$/, '') + '/';

  if (!zipFile) throw badRequest('ZIP file is required');

  // Read ZIP file
  const JSZip = (await import('jszip')).default;
  const zipBuffer = await zipFile.arrayBuffer();
  const zip = await JSZip.loadAsync(zipBuffer);

  const slug = site.slug as string;
  const version = `v${Date.now()}`;
  const uploadedFiles: string[] = [];

  // Upload files from the dist directory within the ZIP
  const entries = Object.entries(zip.files);
  for (const [path, file] of entries) {
    if (file.dir) continue;

    // Only include files under the dist path
    let relativePath = path;
    if (path.startsWith(distPath)) {
      relativePath = path.slice(distPath.length);
    } else if (distPath !== '/' && !path.startsWith(distPath)) {
      continue;
    }

    if (!relativePath) continue;

    const content = await file.async('arraybuffer');
    const r2Key = `sites/${slug}/${version}/${relativePath}`;
    await c.env.SITES_BUCKET.put(r2Key, content);
    uploadedFiles.push(relativePath);
  }

  // Upload chat JSON if provided
  if (chatFile) {
    const chatContent = await chatFile.arrayBuffer();
    await c.env.SITES_BUCKET.put(`sites/${slug}/${version}/_meta/chat.json`, chatContent, {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  // Update manifest
  const manifest = { current_version: version, updated_at: new Date().toISOString(), files: uploadedFiles };
  await c.env.SITES_BUCKET.put(`sites/${slug}/_manifest.json`, JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json' },
  });

  // Update site status to published
  await c.env.DB.prepare(
    'UPDATE sites SET status = \'published\', current_build_version = ?, updated_at = datetime(\'now\') WHERE id = ?',
  )
    .bind(version, siteId)
    .run();

  // Invalidate KV cache
  await c.env.CACHE_KV.delete(`host:${slug}-sites.megabyte.space`).catch(() => {});

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.deployed',
    target_type: 'site',
    target_id: siteId,
    metadata_json: { site_id: siteId, slug, version, file_count: uploadedFiles.length },
    request_id: c.get('requestId'),
  });

  return c.json({
    data: {
      site_id: siteId,
      slug,
      version,
      files_uploaded: uploadedFiles.length,
      status: 'published',
    },
  });
});

// ─── Domain Search (Cloudflare Registrar) ────────────────────

api.get('/api/domains/search', async (c) => {
  const query = c.req.query('q');
  if (!query || query.trim().length < 3) {
    return c.json({ data: [] });
  }

  const domain = query.trim().toLowerCase().replace(/[^a-z0-9.-]/g, '');

  // Generate TLD variants to check
  const baseName = domain.replace(/\.[^.]+$/, '').replace(/\./g, '');
  const tlds = ['.com', '.net', '.org', '.io', '.co', '.dev', '.app', '.site', '.online'];
  const candidates = domain.includes('.')
    ? [domain, ...tlds.filter((t) => !domain.endsWith(t)).map((t) => baseName + t)]
    : tlds.map((t) => baseName + t);

  // Check availability via Cloudflare Registrar API
  const results: Array<{ domain: string; available: boolean; price: number }> = [];

  try {
    const checkUrl = `https://api.cloudflare.com/client/v4/accounts/${
      c.env.CF_API_TOKEN ? '84fa0d1b16ff8086dd958c468ce7fd59' : ''
    }/registrar/domains?query=${encodeURIComponent(baseName)}`;

    const cfRes = await fetch(checkUrl, {
      headers: {
        Authorization: `Bearer ${c.env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
    });

    if (cfRes.ok) {
      const cfData = (await cfRes.json()) as {
        result?: Array<{
          name: string;
          available: boolean;
          price?: number;
        }>;
      };
      if (cfData.result) {
        for (const r of cfData.result) {
          results.push({
            domain: r.name,
            available: r.available,
            price: r.price ? Math.round(r.price * 100) : 0, // Convert to cents
          });
        }
      }
    }
  } catch {
    // Cloudflare Registrar API may not be available
  }

  // If API returned no results, return candidates as unavailable/unknown
  if (results.length === 0) {
    for (const c of candidates.slice(0, 9)) {
      results.push({ domain: c, available: false, price: 0 });
    }
  }

  return c.json({ data: results });
});

// ─── Domain Purchase (Stripe subscription) ───────────────────

api.post('/api/domains/purchase', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const body = (await c.req.json()) as {
    domain: string;
    site_id: string;
    success_url: string;
    cancel_url: string;
  };

  if (!body.domain || !body.site_id) {
    throw badRequest('domain and site_id are required');
  }

  // Verify site ownership
  const site = await dbQueryOne<{ id: string; org_id: string }>(
    c.env.DB,
    'SELECT id, org_id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [body.site_id, orgId],
  );
  if (!site) throw notFound('Site not found');

  // Create a Stripe checkout for domain subscription
  const userId = c.get('userId') || '';
  const user = await dbQueryOne<{ email: string }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ?',
    [userId],
  );

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(c.env.STRIPE_SECRET_KEY + ':')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      'mode': 'subscription',
      'success_url': body.success_url,
      'cancel_url': body.cancel_url,
      'customer_email': user?.email || '',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][recurring][interval]': 'year',
      'line_items[0][price_data][unit_amount]': '1500', // $15/yr default
      'line_items[0][price_data][product_data][name]': `Domain: ${body.domain}`,
      'line_items[0][price_data][product_data][description]': `Annual domain registration for ${body.domain}`,
      'line_items[0][quantity]': '1',
      'metadata[org_id]': orgId,
      'metadata[site_id]': body.site_id,
      'metadata[domain]': body.domain,
      'metadata[type]': 'domain_purchase',
    }),
  });

  if (!stripeRes.ok) {
    const errData = await stripeRes.text();
    throw badRequest('Failed to create checkout: ' + errData);
  }

  const session = (await stripeRes.json()) as { url: string; id: string };

  return c.json({
    data: {
      checkout_url: session.url,
      session_id: session.id,
    },
  });
});

// ─── Admin Domain Management Routes ─────────────────────────

/**
 * List all domains for an organization with filtering and pagination.
 * Supports ?status=active|pending|verification_failed and ?type=free_subdomain|custom_cname.
 */
api.get('/api/admin/domains', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const offset = Math.max(Number(c.req.query('offset') ?? '0'), 0);
  const statusFilter = c.req.query('status');
  const typeFilter = c.req.query('type');

  let sql = 'SELECT * FROM hostnames WHERE org_id = ? AND deleted_at IS NULL';
  const params: unknown[] = [orgId];

  if (statusFilter) {
    sql += ' AND status = ?';
    params.push(statusFilter);
  }

  if (typeFilter) {
    sql += ' AND type = ?';
    params.push(typeFilter);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const { data } = await dbQuery<Record<string, unknown>>(c.env.DB, sql, params);

  return c.json({ data });
});

/**
 * Get a summary of domain counts by status and type for the org.
 */
api.get('/api/admin/domains/summary', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const { data } = await dbQuery<Record<string, unknown>>(
    c.env.DB,
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'verification_failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN type = 'free_subdomain' THEN 1 ELSE 0 END) as free_subdomain,
      SUM(CASE WHEN type = 'custom_cname' THEN 1 ELSE 0 END) as custom_cname
    FROM hostnames
    WHERE org_id = ? AND deleted_at IS NULL`,
    [orgId],
  );

  const stats = data[0] ?? { total: 0, active: 0, pending: 0, failed: 0, free_subdomain: 0, custom_cname: 0 };

  return c.json({
    data: {
      total: stats.total ?? 0,
      by_status: {
        active: stats.active ?? 0,
        pending: stats.pending ?? 0,
        verification_failed: stats.failed ?? 0,
      },
      by_type: {
        free_subdomain: stats.free_subdomain ?? 0,
        custom_cname: stats.custom_cname ?? 0,
      },
    },
  });
});

/**
 * Re-verify a domain hostname against Cloudflare.
 * Triggers a fresh verification check and updates the DB status.
 */
api.post('/api/admin/domains/:hostnameId/verify', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const hostnameId = c.req.param('hostnameId');

  // Find the hostname belonging to this org
  const hostname = await dbQueryOne<{
    id: string;
    hostname: string;
    cf_custom_hostname_id: string;
    org_id: string;
    site_id: string;
    status: string;
  }>(
    c.env.DB,
    'SELECT id, hostname, cf_custom_hostname_id, org_id, site_id, status FROM hostnames WHERE id = ? AND deleted_at IS NULL',
    [hostnameId],
  );

  if (!hostname || hostname.org_id !== orgId) {
    throw notFound('Hostname not found');
  }

  if (!hostname.cf_custom_hostname_id) {
    return c.json({
      data: {
        hostname: hostname.hostname,
        status: hostname.status,
        ssl_status: 'unknown',
        verification_errors: [],
        message: 'No Cloudflare hostname ID — cannot verify',
      },
    });
  }

  // Check status with Cloudflare
  const cfStatus = await domainService.checkHostnameStatus(c.env, hostname.cf_custom_hostname_id);

  const newStatus =
    cfStatus.status === 'active'
      ? 'active'
      : cfStatus.verification_errors.length > 0
        ? 'verification_failed'
        : 'pending';

  // Update DB
  const { dbUpdate: dbUpdateFn } = await import('../services/db.js');
  await dbUpdateFn(
    c.env.DB,
    'hostnames',
    {
      status: newStatus,
      ssl_status: cfStatus.ssl_status,
      verification_errors:
        cfStatus.verification_errors.length > 0
          ? JSON.stringify(cfStatus.verification_errors)
          : null,
      last_verified_at: new Date().toISOString(),
    },
    'id = ?',
    [hostnameId],
  );

  // Audit log
  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'hostname.verified',
    target_type: 'hostname',
    target_id: hostnameId,
    metadata_json: {
      hostname: hostname.hostname,
      previous_status: hostname.status,
      new_status: newStatus,
      ssl_status: cfStatus.ssl_status,
    },
    request_id: c.get('requestId'),
  });

  return c.json({
    data: {
      hostname: hostname.hostname,
      status: newStatus,
      ssl_status: cfStatus.ssl_status,
      verification_errors: cfStatus.verification_errors,
    },
  });
});

/**
 * Get comprehensive health check for a specific domain.
 * Checks Cloudflare status, DNS CNAME target, and SSL status.
 */
api.get('/api/admin/domains/:hostnameId/health', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const hostnameId = c.req.param('hostnameId');

  const hostname = await dbQueryOne<{
    id: string;
    hostname: string;
    cf_custom_hostname_id: string;
    org_id: string;
    site_id: string;
    type: string;
    status: string;
    ssl_status: string;
    last_verified_at: string;
  }>(
    c.env.DB,
    'SELECT id, hostname, cf_custom_hostname_id, org_id, site_id, type, status, ssl_status, last_verified_at FROM hostnames WHERE id = ? AND deleted_at IS NULL',
    [hostnameId],
  );

  if (!hostname || hostname.org_id !== orgId) {
    throw notFound('Hostname not found');
  }

  // Fetch Cloudflare status and DNS CNAME in parallel
  let cfStatus = 'unknown';
  let cfSslStatus = 'unknown';
  let verificationErrors: string[] = [];
  let cnameTarget: string | null = null;

  const cfPromise = hostname.cf_custom_hostname_id
    ? domainService
        .checkHostnameStatus(c.env, hostname.cf_custom_hostname_id)
        .then((result) => {
          cfStatus = result.status;
          cfSslStatus = result.ssl_status;
          verificationErrors = result.verification_errors;
        })
        .catch(() => {
          cfStatus = 'unknown';
        })
    : Promise.resolve();

  const dnsPromise = domainService
    .checkCnameTarget(hostname.hostname)
    .then((target) => {
      cnameTarget = target;
    })
    .catch(() => {
      cnameTarget = null;
    });

  await Promise.all([cfPromise, dnsPromise]);

  return c.json({
    data: {
      hostname: hostname.hostname,
      type: hostname.type,
      db_status: hostname.status,
      cf_status: cfStatus,
      ssl_status: cfSslStatus,
      dns_configured: cnameTarget != null,
      cname_target: cnameTarget,
      verification_errors: verificationErrors,
      last_verified_at: hostname.last_verified_at,
    },
  });
});

/**
 * Admin deprovision: Soft-delete a hostname AND remove from Cloudflare.
 * Unlike the per-site DELETE, this also cleans up the CF custom hostname.
 */
api.delete('/api/admin/domains/:hostnameId', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const hostnameId = c.req.param('hostnameId');

  const hostname = await dbQueryOne<{
    id: string;
    hostname: string;
    cf_custom_hostname_id: string;
    org_id: string;
    site_id: string;
    type: string;
    status: string;
  }>(
    c.env.DB,
    'SELECT id, hostname, cf_custom_hostname_id, org_id, site_id, type, status FROM hostnames WHERE id = ? AND deleted_at IS NULL',
    [hostnameId],
  );

  if (!hostname || hostname.org_id !== orgId) {
    throw notFound('Hostname not found');
  }

  // Delete from Cloudflare if we have a CF ID
  if (hostname.cf_custom_hostname_id) {
    try {
      await domainService.deleteCustomHostname(c.env, hostname.cf_custom_hostname_id);
    } catch {
      // Log but don't block — the CF resource may already be gone
      console.warn(JSON.stringify({
        level: 'warn',
        service: 'domains',
        message: 'Failed to delete CF custom hostname during deprovision',
        hostname: hostname.hostname,
        cf_id: hostname.cf_custom_hostname_id,
      }));
    }
  }

  // Soft-delete in DB
  const { dbUpdate: dbUpdateFn } = await import('../services/db.js');
  await dbUpdateFn(
    c.env.DB,
    'hostnames',
    { deleted_at: new Date().toISOString(), status: 'deleted' },
    'id = ?',
    [hostnameId],
  );

  // Invalidate KV cache
  await c.env.CACHE_KV.delete(`host:${hostname.hostname}`).catch(() => {});

  // Audit log
  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'hostname.deprovisioned',
    target_type: 'hostname',
    target_id: hostnameId,
    metadata_json: {
      hostname: hostname.hostname,
      type: hostname.type,
      had_cf_id: !!hostname.cf_custom_hostname_id,
    },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { deprovisioned: true, hostname: hostname.hostname } });
});

// ─── Contact Form Route ─────────────────────────────────────

api.post('/api/contact', async (c) => {
  const body = await c.req.json();
  await contactService.handleContactForm(c.env, body);
  return c.json({ data: { success: true } });
});

// ─── AI Business Validation ─────────────────────────────────

api.post('/api/validate-business', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const body = await c.req.json();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const context = typeof body.context === 'string' ? body.context.trim() : '';

  if (!name) throw badRequest('Business name is required');

  // Quick client-side checks first
  if (name.length < 2) {
    return c.json({ data: { valid: false, reason: 'Business name is too short.' } });
  }
  if (name.length > 200) {
    return c.json({ data: { valid: false, reason: 'Business name is too long.' } });
  }

  // AI validation using Workers AI
  const prompt = `You are a business data validator. Analyze the following business submission and determine if it appears to be legitimate data for a real (or plausible) business. Check for:
1. Profanity, slurs, or offensive language
2. Obviously fake or nonsensical names (random characters, test data like "asdf", "hey", "test123")
3. Invalid or clearly fake addresses
4. Spam or injection attempts

Business Name: ${name}
${address ? `Business Address: ${address}` : ''}
${context ? `Additional Context: ${context}` : ''}

Respond with EXACTLY one JSON object (no markdown, no extra text):
{"valid": true} if the data appears legitimate
{"valid": false, "reason": "Brief explanation"} if the data appears invalid

Response:`;

  try {
    const aiResult = await c.env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 100,
      temperature: 0.1,
    });

    const text = typeof aiResult === 'string' ? aiResult : (aiResult as { response?: string }).response || '';
    // Extract JSON from AI response
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return c.json({ data: { valid: !!parsed.valid, reason: parsed.reason || null } });
    }
    // If AI didn't respond properly, allow it through
    return c.json({ data: { valid: true } });
  } catch {
    // If AI fails, allow submission through (don't block on AI errors)
    return c.json({ data: { valid: true } });
  }
});

export { api };
