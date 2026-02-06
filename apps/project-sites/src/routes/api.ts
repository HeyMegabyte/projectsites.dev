import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { createServiceClient } from '../services/db.js';
import {
  createSiteSchema,
  createCheckoutSessionSchema,
  createMagicLinkSchema,
  createPhoneOtpSchema,
  verifyPhoneOtpSchema,
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
import { supabaseQuery } from '../services/db.js';

const api = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Auth Routes ─────────────────────────────────────────────

api.post('/api/auth/magic-link', async (c) => {
  const db = createServiceClient(c.env);
  const body = await c.req.json();
  const validated = createMagicLinkSchema.parse(body);
  const result = await authService.createMagicLink(db, c.env, validated);
  return c.json({ data: { expires_at: result.expires_at } });
});

api.post('/api/auth/magic-link/verify', async (c) => {
  const db = createServiceClient(c.env);
  const body = await c.req.json();
  const validated = verifyMagicLinkSchema.parse(body);
  const result = await authService.verifyMagicLink(db, validated);
  return c.json({ data: result });
});

api.post('/api/auth/phone/otp', async (c) => {
  const db = createServiceClient(c.env);
  const body = await c.req.json();
  const validated = createPhoneOtpSchema.parse(body);
  const result = await authService.createPhoneOtp(db, c.env, validated);
  return c.json({ data: result });
});

api.post('/api/auth/phone/verify', async (c) => {
  const db = createServiceClient(c.env);
  const body = await c.req.json();
  const validated = verifyPhoneOtpSchema.parse(body);
  const result = await authService.verifyPhoneOtp(db, validated);
  return c.json({ data: result });
});

api.get('/api/auth/google', async (c) => {
  const db = createServiceClient(c.env);
  const redirectUrl = c.req.query('redirect_url');
  const result = await authService.createGoogleOAuthState(db, c.env, redirectUrl);
  return c.redirect(result.authUrl);
});

api.get('/api/auth/google/callback', async (c) => {
  const db = createServiceClient(c.env);
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    throw badRequest('Missing code or state parameter');
  }

  const result = await authService.handleGoogleOAuthCallback(db, c.env, code, state);
  return c.json({ data: result });
});

// ─── Sites Routes ────────────────────────────────────────────

api.post('/api/sites', async (c) => {
  const db = createServiceClient(c.env);
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
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  const result = await supabaseQuery(db, 'sites', {
    method: 'POST',
    body: site,
  });

  if (result.error) {
    throw badRequest(`Failed to create site: ${result.error}`);
  }

  // Log audit
  await auditService.writeAuditLog(db, {
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
  const db = createServiceClient(c.env);
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const result = await supabaseQuery<unknown[]>(db, 'sites', {
    query: `org_id=eq.${orgId}&deleted_at=is.null&select=*&order=created_at.desc`,
  });

  return c.json({ data: result.data ?? [] });
});

api.get('/api/sites/:id', async (c) => {
  const db = createServiceClient(c.env);
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  const result = await supabaseQuery<unknown[]>(db, 'sites', {
    query: `id=eq.${siteId}&org_id=eq.${orgId}&deleted_at=is.null&select=*`,
  });

  if (!result.data || result.data.length === 0) {
    throw notFound('Site not found');
  }

  return c.json({ data: result.data[0] });
});

// ─── Billing Routes ──────────────────────────────────────────

api.post('/api/billing/checkout', async (c) => {
  const db = createServiceClient(c.env);
  const body = await c.req.json();
  const validated = createCheckoutSessionSchema.parse(body);

  const orgId = c.get('orgId');
  if (!orgId || orgId !== validated.org_id) {
    throw forbidden('Cannot create checkout for another org');
  }

  const result = await billingService.createCheckoutSession(db, c.env, {
    orgId: validated.org_id,
    siteId: validated.site_id,
    customerEmail: '', // Retrieved from user context
    successUrl: validated.success_url,
    cancelUrl: validated.cancel_url,
  });

  return c.json({ data: result });
});

api.get('/api/billing/subscription', async (c) => {
  const db = createServiceClient(c.env);
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const sub = await billingService.getOrgSubscription(db, orgId);
  return c.json({ data: sub });
});

api.get('/api/billing/entitlements', async (c) => {
  const db = createServiceClient(c.env);
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const entitlements = await billingService.getOrgEntitlements(db, orgId);
  return c.json({ data: entitlements });
});

// ─── Hostname Routes ─────────────────────────────────────────

api.get('/api/sites/:siteId/hostnames', async (c) => {
  const db = createServiceClient(c.env);
  const siteId = c.req.param('siteId');

  const hostnames = await domainService.getSiteHostnames(db, siteId);
  return c.json({ data: hostnames });
});

api.post('/api/sites/:siteId/hostnames', async (c) => {
  const db = createServiceClient(c.env);
  const body = await c.req.json();
  const siteId = c.req.param('siteId');
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const validated = createHostnameSchema.parse({ ...body, site_id: siteId });

  let result;
  if (validated.type === 'free_subdomain') {
    // Extract slug from hostname
    const slug = validated.hostname.split('.')[0]!;
    result = await domainService.provisionFreeDomain(db, c.env, {
      org_id: orgId,
      site_id: siteId,
      slug,
    });
  } else {
    // Check entitlements for custom domains
    const entitlements = await billingService.getOrgEntitlements(db, orgId);
    if (!entitlements.topBarHidden) {
      throw forbidden('Custom domains require a paid plan');
    }

    result = await domainService.provisionCustomDomain(db, c.env, {
      org_id: orgId,
      site_id: siteId,
      hostname: validated.hostname,
    });
  }

  // Log audit
  await auditService.writeAuditLog(db, {
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
  const db = createServiceClient(c.env);
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const limit = Number(c.req.query('limit') ?? '50');
  const offset = Number(c.req.query('offset') ?? '0');

  const result = await auditService.getAuditLogs(db, orgId, { limit, offset });
  return c.json({ data: result.data });
});

export { api };
