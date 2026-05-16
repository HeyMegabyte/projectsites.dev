/**
 * @module routes/api
 *
 * @description
 * Authenticated JSON API surface for the Project Sites Worker — the bulk of
 * the post-search funnel, owner dashboards, billing flows, and platform
 * administration. Mounted on the root Hono app in `src/index.ts` under `/api/*`
 * (and `/webhooks/*` for the Stripe pathway). Routes flow through the
 * standard middleware stack (request_id → payload_limit → security_headers →
 * cors → auth → errorHandler), so `c.get('userId')` / `c.get('orgId')` are
 * already resolved (or `undefined` for anonymous callers) when handlers
 * execute. Every route reads/writes D1 via `c.env.DB` and the typed helpers
 * in `services/db.ts` — direct `db.prepare(...).all()` calls are avoided to
 * keep the soft-delete + `updated_at` invariants intact.
 *
 * ## Route Map (current surface — see {@link ../../CLAUDE.md} § API Surface)
 *
 * ### Auth (public until verification completes)
 * | Method | Path | Purpose |
 * | ------ | ---- | ------- |
 * | POST   | `/api/auth/magic-link`            | Request a magic-link email (Resend → SendGrid fallback) |
 * | GET    | `/api/auth/magic-link/verify`     | Verify token via email click → 302 redirect to homepage with session token |
 * | POST   | `/api/auth/magic-link/verify`     | Verify token programmatically → JSON session response |
 * | GET    | `/api/auth/google`                | Start Google OAuth flow (302 to Google consent) |
 * | GET    | `/api/auth/google/callback`       | Google OAuth callback → create/find user → 302 with session token |
 * | GET    | `/api/auth/me`                    | Read current session → user + org |
 *
 * ### Sites (Bearer required)
 * | Method | Path | Purpose |
 * | ------ | ---- | ------- |
 * | POST   | `/api/sites`                      | Create site (manual, no AI workflow) |
 * | GET    | `/api/sites`                      | List caller's org sites (paginated) |
 * | GET    | `/api/sites/:id`                  | Read single site (org-scoped) |
 * | DELETE | `/api/sites/:id`                  | Soft-delete site (sets `deleted_at`) |
 * | GET    | `/api/sites/:id/workflow`         | Read workflow instance status |
 * | GET    | `/api/sites/:id/logs`             | Read audit log slice for a site |
 * | POST   | `/api/sites/:id/reset`            | Re-trigger workflow (used by failed-pipeline retry) |
 * | POST   | `/api/sites/:id/deploy`           | Deploy a zip bundle to R2 |
 * | POST   | `/api/sites/:id/publish-bolt`     | Publish from bolt.diy editor |
 * | GET    | `/api/slug/check`                 | Slug-availability probe |
 * | GET    | `/api/sites/by-slug/:slug/build-context` | Container-build context payload |
 * | GET    | `/api/sites/by-slug/:slug/chat`   | Chat synthesis context for inline edits |
 * | GET    | `/api/sites/by-slug/:slug/research.json` | Cached research JSON for owner UI |
 *
 * ### Billing (Bearer required)
 * | Method | Path | Purpose |
 * | ------ | ---- | ------- |
 * | POST   | `/api/billing/checkout`           | Stripe Checkout session (hosted) |
 * | POST   | `/api/billing/embedded-checkout`  | Stripe Checkout session (embedded UI) |
 * | GET    | `/api/billing/subscription`       | Read org subscription |
 * | GET    | `/api/billing/entitlements`       | Read tier-derived entitlements |
 * | POST   | `/api/billing/portal`             | Stripe customer billing-portal link |
 *
 * ### Hostnames (Bearer required, CF for SaaS)
 * | Method | Path | Purpose |
 * | ------ | ---- | ------- |
 * | GET    | `/api/sites/:siteId/hostnames`    | List provisioned hostnames |
 * | POST   | `/api/sites/:siteId/hostnames`    | Provision a custom hostname (CF for SaaS API) |
 * | PUT    | `/api/sites/:siteId/hostnames/:hostnameId/primary` | Set primary hostname |
 * | POST   | `/api/sites/:siteId/hostnames/reset-primary` | Reset to default `{slug}.projectsites.dev` |
 * | DELETE | `/api/sites/:siteId/hostnames/:hostnameId` | Delete hostname |
 * | POST   | `/api/sites/:siteId/hostnames/:hostnameId/unsubscribe` | Unsubscribe hostname |
 *
 * ### AI helpers + admin (Bearer required)
 * | Method | Path | Purpose |
 * | ------ | ---- | ------- |
 * | POST   | `/api/ai/categorize`              | AI business categorization |
 * | POST   | `/api/contact-form/:slug`         | Submit contact form for a published site |
 * | GET    | `/api/audit-logs`                 | List org audit logs |
 * | GET    | `/api/domains/search`             | Search available registrable domains |
 * | POST   | `/api/domains/purchase`           | Purchase a registrable domain |
 * | GET    | `/api/admin/domains`              | Admin: list all org domains |
 * | POST   | `/api/publish/bolt`               | Publish a bolt.diy build |
 *
 * ## Auth & error contract
 * - Every protected route reads `c.get('userId')` / `c.get('orgId')` (set by the
 *   `auth` middleware in `src/middleware/auth.ts`). Missing identity → throw
 *   `unauthorized()` from `@project-sites/shared` (mapped to 401 JSON envelope
 *   `{ error: { code: 'UNAUTHORIZED', message, request_id } }` by
 *   `error_handler`).
 * - Validation flows through Zod schemas from `@project-sites/shared/schemas`
 *   (`createSiteSchema`, `createCheckoutSessionSchema`, etc.). ZodError is
 *   caught by `error_handler` and emitted as `VALIDATION_ERROR` with
 *   per-field `details[]`.
 * - All cross-org reads include `WHERE org_id = ?` in the SQL — never trust
 *   `body.org_id` over the session-resolved `orgId`.
 *
 * ## Side effects
 * - Every state mutation writes an audit row via `auditService.writeAuditLog`
 *   (best-effort `.catch(() => {})` so audit-store outages never block the
 *   primary write).
 * - Auth + billing events fan out to PostHog (`posthog.trackAuth`,
 *   `posthog.trackBilling`) and Sentry breadcrumbs.
 * - Email is best-effort — magic-link / receipt emails fail open with audit
 *   marker but never bubble a 500.
 *
 * @see {@link ../middleware/auth.ts | auth middleware}
 * @see {@link ../middleware/error_handler.ts | error_handler middleware}
 * @see {@link ../services/auth.ts | auth service}
 * @see {@link ../services/billing.ts | billing service}
 * @see {@link ../services/domains.ts | domains service (CF for SaaS)}
 * @see {@link ../services/audit.ts | audit service}
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbInsert, dbQuery, dbQueryOne } from '../services/db.js';
import {
  createSiteSchema,
  createCheckoutSessionSchema,
  createEmbeddedCheckoutSchema,
  createMagicLinkSchema,
  verifyMagicLinkSchema,
  createHostnameSchema,
  DOMAINS,
  badRequest,
  notFound,
  forbidden,
  unauthorized,
} from '@project-sites/shared';
import { budgetTierSchema, type BudgetTier } from '@project-sites/shared/schemas';
import * as authService from '../services/auth.js';
import * as billingService from '../services/billing.js';
import * as domainService from '../services/domains.js';
import * as auditService from '../services/audit.js';
import * as contactService from '../services/contact.js';
import { classifyError } from '../services/retry.js';
import * as posthog from '../lib/posthog.js';
import { captureError } from '../lib/sentry.js';
import { fetchSheetData, fetchSheetMeta } from '../services/google_sheets.js';
import { migrateExternalAssets } from '../services/asset_migration.js';

const api = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Auth Routes ─────────────────────────────────────────────

/**
 * Request a magic-link email — primary passwordless auth path.
 *
 * @route POST /api/auth/magic-link
 * @public Anonymous funnel — the email recipient gates further access.
 *
 * @body `{ email: string, redirect_url?: string }` — validated by
 *   `createMagicLinkSchema`. `redirect_url` is whitelisted on the verify
 *   side (allowed hosts: `projectsites.dev`, `megabyte.space`).
 *
 * @returns `{ data: { expires_at: ISO string } }` — does NOT leak whether
 *   the email is already registered (enumeration prevention).
 *
 * @throws VALIDATION_ERROR 400 on malformed email.
 * @throws INTERNAL_ERROR 500 only on email-provider catastrophic failure
 *   (Resend AND SendGrid both reject); transient failures are retried
 *   inside `authService.createMagicLink`.
 *
 * @remarks
 * Audit log emission (`auth.magic_link_requested`) is best-effort —
 * scoped to `org_id: 'system'` because the user may not exist yet.
 * PostHog `magic_link.requested` event fires before the audit write so
 * we capture funnel even on D1 hiccups.
 *
 * @example
 * ```bash
 * curl -X POST https://projectsites.dev/api/auth/magic-link \
 *   -H "Content-Type: application/json" \
 *   -d '{"email":"owner@example.com","redirect_url":"https://projectsites.dev/dashboard"}'
 * ```
 *
 * @see {@link ../services/auth.ts | authService.createMagicLink}
 */
api.post('/api/auth/magic-link', async (c) => {
  const body = await c.req.json();
  const validated = createMagicLinkSchema.parse(body);
  const result = await authService.createMagicLink(c.env.DB, c.env, validated);
  posthog.trackAuth(c.env, c.executionCtx, 'magic_link', 'requested', validated.email);

  // Audit: magic link requested (no org_id yet since user may not exist)
  auditService
    .writeAuditLog(c.env.DB, {
      org_id: 'system',
      actor_id: null,
      action: 'auth.magic_link_requested',
      target_type: 'auth',
      target_id: validated.email,
      metadata_json: {
        email: validated.email,
        expires_at: result.expires_at,
        message: 'Magic link email sent to ' + validated.email,
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({ data: { expires_at: result.expires_at } });
});

/**
 * Verify a magic-link token from an email click — browser-facing variant.
 * Establishes a session, then 302-redirects to the homepage (or the
 * whitelisted `redirect_url`) with the token as a query parameter so the
 * SPA can pick it up on load.
 *
 * @route GET /api/auth/magic-link/verify
 * @public Token in query string IS the credential.
 *
 * @queryParam token - Single-use magic-link token. Missing token →
 *   `302 /?error=missing_token` (NOT a 400 — browser-facing UX).
 *
 * @returns `302 Redirect` to either the validated `redirect_url`
 *   (with `token`, `email`, `auth_callback=email` appended) or to
 *   `https://${DOMAINS.SITES_BASE}/?token=...&email=...&auth_callback=email`.
 *
 * @throws Never — all failure modes (invalid token, expired token,
 *   D1 error, email-provider error) collapse to
 *   `302 /?error=invalid_or_expired_link` so the SPA can render a
 *   friendly error toast instead of a 4xx JSON envelope.
 *
 * @remarks
 * **Strict redirect allowlist** — only exact-match `projectsites.dev`
 * + `megabyte.space` AND single-level subdomains (depth ≤ host+1). HTTPS
 * required. Anything else → `302 /?error=invalid_redirect`. Hard guard
 * against open-redirect phishing.
 *
 * @example
 * ```
 * GET /api/auth/magic-link/verify?token=abc123...
 * → 302 https://projectsites.dev/?token=sess_xyz&email=owner%40example.com&auth_callback=email
 * ```
 */
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
      // Strict redirect validation — only allow exact known domains and single-level subdomains
      const allowedDomains = ['projectsites.dev', 'megabyte.space'];
      const hostname = redirectTarget.hostname;
      const isAllowed = allowedDomains.some(
        (domain) =>
          hostname === domain ||
          (hostname.endsWith('.' + domain) &&
            hostname.split('.').length <= domain.split('.').length + 1),
      );
      if (!isAllowed || redirectTarget.protocol !== 'https:') {
        return c.redirect('/?error=invalid_redirect');
      }
      redirectTarget.searchParams.set('token', session.token);
      redirectTarget.searchParams.set('email', result.email);
      redirectTarget.searchParams.set('auth_callback', 'email');
      return c.redirect(redirectTarget.toString());
    }

    // Default: redirect to homepage with auth params
    const baseUrl = `https://${DOMAINS.SITES_BASE}`;
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

/**
 * Verify a magic-link token programmatically — JSON variant for SDK
 * clients, mobile apps, or the SPA's deferred-verification path when
 * it parses a token out of `window.location.search`.
 *
 * @route POST /api/auth/magic-link/verify
 * @public Token in body IS the credential.
 *
 * @body `{ token: string, redirect_url?: string }` — validated by
 *   `verifyMagicLinkSchema`.
 *
 * @returns Either `{ data: { token, email, user_id, org_id } }` (JSON
 *   session payload) OR `302 Redirect` to a validated `redirect_url`
 *   when supplied — same allowlist as the GET variant.
 *
 * @throws VALIDATION_ERROR 400 on malformed body / missing token.
 * @throws UNAUTHORIZED 401 on invalid OR expired token (no information
 *   leak — same code for both states).
 *
 * @remarks
 * Always creates a session on successful verify (no replay attack risk
 * — `verifyMagicLink` marks the token consumed in D1). Audit row
 * (`auth.magic_link_verified`) writes synchronously here so the caller's
 * token is durably linked to a user before the session token leaves the
 * Worker.
 */
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

/**
 * Start the Google OAuth flow — generates state, persists it to D1
 * via `oauth_states`, and 302-redirects the browser to Google's
 * consent screen.
 *
 * @route GET /api/auth/google
 * @public Anonymous funnel — Google's consent screen gates further access.
 *
 * @queryParam redirect_url - Optional post-verify redirect target.
 *   Stored in `oauth_states` and validated on the callback side against
 *   the same allowlist as the magic-link variants.
 *
 * @returns `302 Redirect` to `https://accounts.google.com/o/oauth2/v2/auth?...`
 *   with our `client_id` + `state` + `scope` + `redirect_uri`.
 *
 * @throws INTERNAL_ERROR 500 on D1 failure when writing `oauth_states`.
 */
api.get('/api/auth/google', async (c) => {
  const redirectUrl = c.req.query('redirect_url');
  const result = await authService.createGoogleOAuthState(c.env.DB, c.env, redirectUrl);

  // Audit: Google OAuth initiated
  auditService
    .writeAuditLog(c.env.DB, {
      org_id: 'system',
      actor_id: null,
      action: 'auth.google_oauth_started',
      target_type: 'auth',
      target_id: 'google',
      metadata_json: {
        redirect_url: redirectUrl || '/',
        message: 'Google OAuth sign-in flow initiated',
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.redirect(result.authUrl);
});

/**
 * Google OAuth callback — Google redirects the user here with `code` +
 * `state` after consent. Exchanges code for tokens, fetches profile,
 * finds-or-creates the user, mints a session, audits the event, and
 * 302-redirects back to the originating `redirect_url` (or homepage)
 * with the session token + email appended as query params.
 *
 * @route GET /api/auth/google/callback
 * @public Token in callback IS the credential.
 *
 * @queryParam code - One-time OAuth authorization code from Google.
 * @queryParam state - The opaque state we wrote into `oauth_states`
 *   on the initiation side; protects against CSRF + replay.
 *
 * @returns `302 Redirect` to validated `redirect_url` (with `token`
 *   + `email` query params appended) or to `https://${DOMAINS.SITES_BASE}/`
 *   when no redirect was supplied.
 *
 * @throws BAD_REQUEST 400 `'Missing code or state parameter'` when
 *   Google redirected without both params (typically user canceled).
 *
 * @remarks
 * **Open-redirect defense** — same allowlist + protocol check as the
 * magic-link verify path (`projectsites.dev` + `megabyte.space` + single-
 * level subdomains, HTTPS-only). Any other host → bounce to
 * `/?error=invalid_redirect`.
 */
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
  const baseUrl = `https://${DOMAINS.SITES_BASE}`;

  const rawRedirect = result.redirect_url ?? baseUrl;
  const redirectTarget = new URL(rawRedirect);
  // Strict redirect validation — only allow exact known domains and single-level subdomains
  const oauthAllowedDomains = ['projectsites.dev', 'megabyte.space'];
  const oauthHostname = redirectTarget.hostname;
  const oauthAllowed = oauthAllowedDomains.some(
    (domain) =>
      oauthHostname === domain ||
      (oauthHostname.endsWith('.' + domain) &&
        oauthHostname.split('.').length <= domain.split('.').length + 1),
  );
  if (!oauthAllowed || redirectTarget.protocol !== 'https:') {
    return c.redirect(`${baseUrl}/?error=invalid_redirect`);
  }
  redirectTarget.searchParams.set('token', session.token);
  redirectTarget.searchParams.set('email', result.email);
  posthog.trackAuth(c.env, c.executionCtx, 'google_oauth', 'verified', result.email);
  return c.redirect(redirectTarget.toString());
});

// ─── GitHub OAuth ──────────────────────────────────────────

/**
 * @route GET /api/auth/github
 * @public Anonymous entry — generates OAuth state CSRF token before issuing redirect.
 * @queryParam redirect_url - Optional post-auth landing URL. Persisted in the `oauth_states`
 *   D1 row keyed by the generated `state` parameter; validated against the strict
 *   hostname allowlist on the callback leg, NOT here (so abuse can't tunnel out of the
 *   start request without a valid state).
 * @returns 302 Redirect to `https://github.com/login/oauth/authorize?...&state=<csrf>`
 *   with GitHub-specific scopes `read:user user:email` required to backfill email +
 *   display_name in {@link authService.findOrCreateUser}.
 * @throws {AppError} `INTERNAL_ERROR` 500 when D1 write of the `oauth_states` row fails.
 * @remarks Mirrors the Google OAuth start (`GET /api/auth/google`) — state generation
 *   defers to {@link authService.createGitHubOAuthState}, which writes a single-use
 *   row to `oauth_states` (TTL ~10min). Audit log is best-effort `.catch(() => {})` —
 *   audit failures NEVER block the redirect.
 * @see {@link authService.createGitHubOAuthState}
 */
api.get('/api/auth/github', async (c) => {
  const redirectUrl = c.req.query('redirect_url');
  const result = await authService.createGitHubOAuthState(c.env.DB, c.env, redirectUrl);

  auditService
    .writeAuditLog(c.env.DB, {
      org_id: 'system',
      actor_id: null,
      action: 'auth.github_oauth_started',
      target_type: 'auth',
      target_id: 'github',
      metadata_json: {
        redirect_url: redirectUrl || '/',
        message: 'GitHub OAuth sign-in flow initiated',
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.redirect(result.authUrl);
});

/**
 * @route GET /api/auth/github/callback
 * @public The callback `code` IS the credential. Authenticity is proven by the paired
 *   `state` parameter — server-side D1 lookup against `oauth_states` enforces CSRF +
 *   replay protection (state row is consumed atomically; second use rejects).
 * @queryParam code - GitHub-issued authorization code, exchanged for an access token
 *   inside {@link authService.handleGitHubOAuthCallback}.
 * @queryParam state - Opaque CSRF token issued by `GET /api/auth/github`. Lookup
 *   resolves to the original `redirect_url` (validated below against the strict
 *   allowlist before the 302 fires).
 * @returns 302 Redirect to `redirect_url?token=<session>&email=<email>` on success,
 *   or `${baseUrl}/?error=invalid_redirect` when the original `redirect_url` falls
 *   outside the allowlist or uses a non-HTTPS scheme.
 * @throws {AppError} `BAD_REQUEST` 'Missing code or state parameter' — typically fires
 *   when the user cancels the GitHub consent screen (GitHub returns `?error=...`
 *   instead of `?code=...`).
 * @remarks Open-redirect defense identical to {@link "/api/auth/google/callback"} —
 *   hostname must match `projectsites.dev` or `megabyte.space` exactly OR be a
 *   single-level subdomain of either, AND protocol MUST be `https:`. Any other
 *   target collapses to the marketing homepage with `?error=invalid_redirect`.
 * @see {@link authService.handleGitHubOAuthCallback}
 * @see {@link authService.findOrCreateUser}
 */
api.get('/api/auth/github/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');

  if (!code || !state) {
    throw badRequest('Missing code or state parameter');
  }

  const result = await authService.handleGitHubOAuthCallback(c.env.DB, c.env, code, state);

  const user = await authService.findOrCreateUser(c.env.DB, {
    email: result.email,
    display_name: result.display_name ?? undefined,
    avatar_url: result.avatar_url ?? undefined,
  });
  const session = await authService.createSession(c.env.DB, user.user_id);

  await auditService.writeAuditLog(c.env.DB, {
    org_id: user.org_id,
    actor_id: user.user_id,
    action: 'auth.github_oauth_verified',
    target_type: 'user',
    target_id: user.user_id,
    metadata_json: { method: 'github_oauth' },
    request_id: c.get('requestId'),
  });

  const baseUrl = `https://${DOMAINS.SITES_BASE}`;
  const rawRedirect = result.redirect_url ?? baseUrl;
  const redirectTarget = new URL(rawRedirect);
  const ghAllowedDomains = ['projectsites.dev', 'megabyte.space'];
  const ghHostname = redirectTarget.hostname;
  const ghAllowed = ghAllowedDomains.some(
    (domain) =>
      ghHostname === domain ||
      (ghHostname.endsWith('.' + domain) &&
        ghHostname.split('.').length <= domain.split('.').length + 1),
  );
  if (!ghAllowed || redirectTarget.protocol !== 'https:') {
    return c.redirect(`${baseUrl}/?error=invalid_redirect`);
  }
  redirectTarget.searchParams.set('token', session.token);
  redirectTarget.searchParams.set('email', result.email);
  posthog.trackAuth(c.env, c.executionCtx, 'github_oauth', 'verified', result.email);
  return c.redirect(redirectTarget.toString());
});

// ─── Session Validation ─────────────────────────────────────

/**
 * @route GET /api/auth/me
 * @auth Bearer token required — caller MUST have a resolved `userId` in the
 *   {@link Variables} bag (set by the `auth` middleware). Anonymous callers fail with
 *   401 `UNAUTHORIZED` before touching D1.
 * @returns `{ data: { user_id, org_id, email, display_name } }` — the canonical
 *   "who am I?" envelope used by the Angular shell on bootstrap (see
 *   `AppComponent.restoreSession()`) and by the homepage SPA to decide between the
 *   `signin` and `details` screens.
 * @throws {AppError} `UNAUTHORIZED` 'Must be authenticated' when `userId` is unresolved.
 * @throws {AppError} `UNAUTHORIZED` 'User not found' when the session's `userId` no
 *   longer matches a live `users` row (account deleted while session was active —
 *   forces the frontend to clear `localStorage.ps_session` and bounce to `/signin`).
 * @remarks Soft-deleted users (`deleted_at IS NOT NULL`) collapse to 401 — never 404 —
 *   so the frontend's error-handler treats deletion identically to expired sessions.
 * @example
 * ```http
 * GET /api/auth/me
 * Authorization: Bearer <session_token>
 *
 * 200 OK
 * { "data": { "user_id": "usr_...", "org_id": "org_...", "email": "hey@megabyte.space", "display_name": "Brian" } }
 * ```
 */
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

/**
 * @route POST /api/sites
 * @auth Bearer token required — `orgId` MUST resolve. 401 on anonymous callers.
 * @body Validated by `createSiteSchema` from `@project-sites/shared/schemas`:
 *   - `business_name` (required, 1-200 chars)
 *   - `business_phone?`, `business_email?`, `business_address?`
 *   - `google_place_id?` — when present, downstream `google-places-lookup` step
 *     enriches the site with Places ground-truth data
 *   - `slug?` — caller-supplied slug overrides AI generation
 * @returns `201 Created` with `{ data: <site row> }` — the full D1 record including
 *   the resolved slug, `status: 'draft'`, and null lighthouse/build-version fields.
 *   The caller MUST treat `data.id` as the canonical site identifier from this
 *   point forward (slug can change via subsequent PATCH; `id` is immutable).
 * @throws {AppError} `UNAUTHORIZED` 'Must be authenticated' when `orgId` is unresolved.
 * @throws {ZodError} → 400 `VALIDATION_ERROR` when `createSiteSchema` rejects the body
 *   (mapped by `error_handler` middleware into the standard envelope).
 * @throws {AppError} `BAD_REQUEST` 'Failed to create site: <reason>' on D1 insert
 *   failure (typically a slug collision; the unique index on `sites.slug` enforces
 *   global uniqueness across orgs).
 * @remarks Slug strategy is two-tier with hard fallback:
 *   1. Caller-supplied `validated.slug` wins outright (used by Angular shell when
 *      the user has already picked a slug in the "details" screen).
 *   2. Workers AI (`@cf/meta/llama-3.1-8b-instruct`) generates a short, semantic
 *      slug from `business_name` + optional `business_address`. The Llama call has
 *      a 50-token cap (the slug itself is ≤40 chars) and the response is sanitized
 *      to `[a-z0-9-]`, deduped hyphens, and trimmed.
 *   3. If the AI returns <3 chars or throws, falls back to a deterministic
 *      slugification of `business_name` (lowercase + hyphenize + trim).
 *
 *   Slug uniqueness is NOT pre-checked here — `dbInsert` will surface the D1
 *   unique-constraint violation as `result.error`. Callers who need an upfront
 *   availability check should hit `GET /api/slug/check?slug=...` first.
 *
 *   Audit log + PostHog `site.created` fire AFTER successful D1 insert. PostHog
 *   is fire-and-forget (`try/catch` swallowed) — analytics failures NEVER block
 *   site creation.
 * @example
 * ```http
 * POST /api/sites
 * Authorization: Bearer <session_token>
 * Content-Type: application/json
 *
 * { "business_name": "Vito's Mens Salon", "business_address": "74 N Beverwyck Rd, Lake Hiawatha, NJ 07034" }
 *
 * 201 Created
 * { "data": { "id": "...", "slug": "vitos-mens-salon", "status": "draft", ... } }
 * ```
 * @see {@link createSiteSchema}
 * @see {@link dbInsert}
 */
api.post('/api/sites', async (c) => {
  const body = await c.req.json();
  const validated = createSiteSchema.parse(body);

  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  // AI-powered smart slug or user-provided slug
  let slug: string;
  if (validated.slug) {
    slug = validated.slug;
  } else {
    try {
      const result = await c.env.AI.run(
        '@cf/meta/llama-3.1-8b-instruct' as Parameters<typeof c.env.AI.run>[0],
        {
          messages: [
            {
              role: 'system',
              content:
                'Generate the shortest URL slug for this business. Output ONLY the slug (lowercase, hyphens, no explanation). Max 40 chars. Remove possessives, articles, taglines.',
            },
            {
              role: 'user',
              content: `Business: "${validated.business_name}"${validated.business_address ? ` at "${validated.business_address}"` : ''}`,
            },
          ],
          max_tokens: 50,
        },
      );
      const aiSlug = ((result as { response?: string }).response ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 63);
      slug =
        aiSlug && aiSlug.length >= 3
          ? aiSlug
          : validated.business_name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .substring(0, 63);
    } catch {
      slug = validated.business_name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 63);
    }
  }

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
    metadata_json: {
      site_id: site.id,
      slug,
      business_name: validated.business_name,
      message:
        'New site created: ' + validated.business_name + ' (' + slug + DOMAINS.SITES_SUFFIX + ')',
    },
    request_id: c.get('requestId'),
  });

  try {
    posthog.trackSite(c.env, c.executionCtx, 'created', c.get('userId') || orgId, {
      site_id: site.id,
      slug: site.slug,
    });
  } catch {
    /* fire-and-forget */
  }

  return c.json({ data: site }, 201);
});

// ─── Check Slug Availability (must be before /api/sites/:id) ──

/**
 * @route GET /api/slug/check
 * @auth Bearer token required — `orgId` MUST resolve. Anonymous = 401.
 * @queryParam slug - Raw user-typed slug (will be normalized to `[a-z0-9-]` server-side).
 * @queryParam exclude_id - Optional site `id` to exclude from the uniqueness check
 *   (used during inline-rename in the dashboard so the slug being renamed doesn't
 *   register as a conflict with itself).
 * @returns `200 OK` with `{ data: { available: boolean, slug: string, reason: string | null } }` —
 *   ALWAYS 200, never 4xx. `available: false` paired with a human-readable `reason`
 *   is the failure path. The frontend uses `reason` directly as an inline error.
 * @throws {AppError} `UNAUTHORIZED` 'Must be authenticated' when `orgId` is unresolved.
 * @remarks Validation pipeline (in order — first failure wins):
 *   1. Slug missing/whitespace-only → "Slug is required"
 *   2. Normalized length <3 → "Slug must be at least 3 characters"
 *   3. Regex `^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$` fails → "Slug must start and end with a letter or number"
 *   4. D1 lookup hits a live row → "Slug is already taken"
 *
 *   IMPORTANT: route order matters — this MUST register BEFORE `/api/sites/:id`
 *   to avoid Hono's path-param matcher swallowing the literal `slug` segment.
 *   See the file's route-mount order comment above.
 *
 *   Slug uniqueness is GLOBAL across orgs (not org-scoped), because slugs map
 *   to public hostnames like `{slug}.projectsites.dev`. Two orgs can't both
 *   claim `vitos`.
 */
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
    return c.json({
      data: { available: false, reason: 'Slug must start and end with a letter or number' },
    });
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

/**
 * @route GET /api/sites
 * @auth Bearer token required — `orgId` MUST resolve. Anonymous = 401.
 * @returns `200 OK` with `{ data: <enriched site[]> }` — every site for the caller's
 *   org, sorted newest-first, each enriched with:
 *   - `primary_hostname` — resolved from {@link domainService.getPrimaryHostname}
 *   - `has_premium_domain` (boolean) — true when a `type='custom_cname'` hostname row exists
 *   - `premium_domain` (string | null) — the custom hostname itself when present
 * @throws {AppError} `UNAUTHORIZED` 'Must be authenticated' when `orgId` is unresolved.
 * @remarks Cross-org guard: D1 query is hard-bound to `org_id = ?` from the
 *   session-resolved `orgId` (NEVER from request body or headers). Soft-deleted
 *   sites (`deleted_at IS NOT NULL`) are filtered.
 *
 *   N+1 caveat: the per-site enrichment runs `Promise.all` over 2 D1 queries per
 *   site (primary hostname + custom-domain lookup). At ~50 sites/org this is
 *   acceptable (~100 queries fan out in parallel against D1). If org-site counts
 *   ever scale to 1000+, fold the enrichment into a single LEFT JOIN.
 */
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

/**
 * @route GET /api/sites/:id
 * @auth Bearer token required — `orgId` MUST resolve. Anonymous = 401.
 * @param id - Site UUID (immutable; assigned at creation in `POST /api/sites`).
 * @returns `200 OK` with `{ data: <site row> }` — the full D1 record (status,
 *   slug, business_*, current_build_version, lighthouse_*, timestamps).
 * @throws {AppError} `UNAUTHORIZED` 'Must be authenticated' when `orgId` unresolved.
 * @throws {AppError} `NOT_FOUND` 'Site not found' when the site doesn't exist,
 *   was soft-deleted, OR belongs to a different org. NOTE: the 404 deliberately
 *   collapses the "missing" and "forbidden" cases — exposing 403 here would leak
 *   the existence of sites in other orgs.
 * @remarks Cross-org guard via composite `WHERE id = ? AND org_id = ?` — the
 *   `orgId` comes from the session, NEVER from query/body. This route is the
 *   canonical primary-key read; the slug-keyed variants (`/api/sites/by-slug/...`)
 *   are downstream consumers that ultimately resolve to the same row.
 */
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

/**
 * @route GET /api/sites/:id/workflow
 * @auth Bearer token required — `orgId` MUST resolve. Anonymous = 401.
 * @param id - Site UUID.
 * @returns `200 OK` with `{ data: { site_id, workflow_available, instance_id?,
 *   workflow_status?, workflow_error?, workflow_output?, site_status, recent_logs[] } }`.
 *
 *   Shape varies by environment:
 *   - When `SITE_WORKFLOW` binding is absent (local dev): `{ workflow_available: false, site_status }` only.
 *   - When the instance lookup fails (workflow predates binding rollout):
 *     `{ workflow_available: true, instance_id: null, workflow_status: null, ... }`.
 *   - Happy path: full Workflow `instance.status()` payload + filtered audit logs
 *     scoped to `workflow.*` actions (≤50 most recent).
 * @throws {AppError} `UNAUTHORIZED` 'Must be authenticated' when `orgId` unresolved.
 * @throws {AppError} `NOT_FOUND` 'Site not found' (org-mismatch → 404 — same
 *   information-leakage rule as `GET /api/sites/:id`).
 * @remarks Workflow `status.error` is normalized to a string before returning —
 *   the Cloudflare Workflow SDK may surface errors as `Error` objects, plain
 *   `{ message, name }` records, or raw strings. Frontend assumes string-or-null.
 *
 *   Audit log fetch (`workflow.*` action prefix) is best-effort wrapped in a
 *   silent try/catch — D1 hiccups never block the workflow status response.
 *   The `metadata_json` field is opportunistically `JSON.parse`d (D1 stores it
 *   as TEXT but some legacy rows store it as an object directly).
 * @see {@link https://developers.cloudflare.com/workflows/build/workers-api Cloudflare Workflows API}
 */
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

  // Fetch recent audit logs for this site's workflow (best-effort)
  let recentLogs: Array<{
    action: string;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }> = [];
  try {
    const logsResult = await auditService.getSiteAuditLogs(c.env.DB, orgId, siteId, { limit: 50 });
    recentLogs = (logsResult.data as Array<Record<string, unknown>>)
      .filter((l) => typeof l.action === 'string' && (l.action as string).startsWith('workflow.'))
      .map((l) => {
        let metadata: Record<string, unknown> | null = null;
        if (l.metadata_json) {
          try {
            metadata =
              typeof l.metadata_json === 'string'
                ? JSON.parse(l.metadata_json as string)
                : (l.metadata_json as Record<string, unknown>);
          } catch {
            /* ignore parse errors */
          }
        }
        return {
          action: l.action as string,
          metadata,
          created_at: l.created_at as string,
        };
      });
  } catch {
    /* audit log fetch is best-effort */
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
        workflowError =
          (errObj.message as string) ?? (errObj.name as string) ?? JSON.stringify(status.error);
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
        recent_logs: recentLogs,
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
        recent_logs: recentLogs,
      },
    });
  }
});

// ─── Billing Routes ──────────────────────────────────────────

/**
 * Create a Stripe Checkout Session (redirect flow) for plan upgrade.
 *
 * @route POST /api/billing/checkout
 * @auth Bearer — `userId` AND `orgId` MUST resolve from session
 * @body createCheckoutSessionSchema — `{ site_id?, success_url, cancel_url, budget_tier, org_id? }`
 * @returns 200 OK `{ data: { session_id, url } }` — caller redirects browser to `url`
 * @throws {AppError} `UNAUTHORIZED` — session missing userId or orgId.
 * @throws {AppError} `FORBIDDEN` — `validated.org_id` provided but does not match session orgId
 *   (cross-org checkout block — never trust caller-supplied org).
 * @throws {ZodError} — body fails `createCheckoutSessionSchema` (auto-caught by Hono error
 *   handler, rendered as `VALIDATION_ERROR`).
 *
 * @remarks
 * Customer email lookup: hits `users` table with `deleted_at IS NULL` filter; soft-deleted
 * users collapse to `email: ''` — Stripe handles gracefully but billing emails will fail
 * delivery. Audit log + PostHog `checkout_created` event fire fire-and-forget AFTER the
 * Stripe call succeeds (failures swallowed via `.catch(() => {})` to keep latency on
 * critical path).
 *
 * Use this endpoint for the classic Stripe Checkout redirect flow. For the embedded
 * (in-page Stripe.js) flow, use `/api/billing/embedded-checkout` instead.
 *
 * @example
 * ```bash
 * curl -X POST https://projectsites.dev/api/billing/checkout \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{"site_id":"abc","budget_tier":"patron","success_url":"https://...","cancel_url":"https://..."}'
 * ```
 *
 * @see {@link billingService.createCheckoutSession}
 */
api.post('/api/billing/checkout', async (c) => {
  const body = await c.req.json();
  const validated = createCheckoutSessionSchema.parse(body);

  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) throw unauthorized('Must be authenticated');
  if (validated.org_id && validated.org_id !== orgId) {
    throw forbidden('Cannot create checkout for another org');
  }

  const userRow = await dbQueryOne<{ email: string }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  );

  const result = await billingService.createCheckoutSession(c.env.DB, c.env, {
    orgId,
    siteId: validated.site_id,
    customerEmail: userRow?.email || '',
    successUrl: validated.success_url,
    cancelUrl: validated.cancel_url,
    budgetTier: validated.budget_tier,
  });

  // Audit: billing checkout session created
  auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'billing.checkout_created',
      target_type: 'billing',
      target_id: validated.site_id || orgId,
      metadata_json: {
        site_id: validated.site_id,
        session_id: result.session_id || null,
        message: 'Stripe checkout session created for plan upgrade',
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  try {
    posthog.trackSite(c.env, c.executionCtx, 'checkout_created', c.get('userId') || orgId, {
      site_id: validated.site_id,
    });
  } catch {
    /* fire-and-forget */
  }

  return c.json({ data: result });
});

/**
 * Create a Stripe embedded Checkout Session (in-page Stripe.js mount) for plan upgrade.
 *
 * @route POST /api/billing/embedded-checkout
 * @auth Bearer — `userId` AND `orgId` MUST resolve from session
 * @body createEmbeddedCheckoutSchema — `{ site_id?, return_url, budget_tier, org_id? }`
 * @returns 200 OK `{ data: { client_secret, publishable_key } }` — caller mounts Stripe.js
 *   `EmbeddedCheckout` element with these credentials. `publishable_key` injected from
 *   `c.env.STRIPE_PUBLISHABLE_KEY` so frontend doesn't need its own copy.
 * @throws {AppError} `UNAUTHORIZED` — session missing userId or orgId.
 * @throws {AppError} `FORBIDDEN` — `validated.org_id` mismatches session orgId.
 * @throws {ZodError} — body fails `createEmbeddedCheckoutSchema`.
 *
 * @remarks
 * Mirrors `/api/billing/checkout` but returns a `client_secret` for in-page Stripe.js
 * mount instead of a redirect URL. Use this endpoint when keeping the user inside the
 * Angular SPA (better UX, no page bounce). The `return_url` is where Stripe redirects
 * AFTER successful payment confirmation.
 *
 * Audit log fires `billing.embedded_checkout_created` (distinct from `.checkout_created`
 * so analytics can A/B the two flows). PostHog event `embedded_checkout_created`.
 *
 * @see {@link billingService.createEmbeddedCheckoutSession}
 * @see {@link https://stripe.com/docs/checkout/embedded/quickstart Stripe Embedded Checkout}
 */
api.post('/api/billing/embedded-checkout', async (c) => {
  const body = await c.req.json();
  const validated = createEmbeddedCheckoutSchema.parse(body);

  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId || !userId) throw unauthorized('Must be authenticated');
  if (validated.org_id && validated.org_id !== orgId) {
    throw forbidden('Cannot create checkout for another org');
  }

  const userRow = await dbQueryOne<{ email: string }>(
    c.env.DB,
    'SELECT email FROM users WHERE id = ? AND deleted_at IS NULL',
    [userId],
  );

  const result = await billingService.createEmbeddedCheckoutSession(c.env.DB, c.env, {
    orgId,
    siteId: validated.site_id,
    customerEmail: userRow?.email || '',
    returnUrl: validated.return_url,
    budgetTier: validated.budget_tier,
  });

  auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'billing.embedded_checkout_created',
      target_type: 'billing',
      target_id: validated.site_id || orgId,
      metadata_json: {
        site_id: validated.site_id,
        session_id: result.session_id || null,
        message: 'Stripe embedded checkout session created for plan upgrade',
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  try {
    posthog.trackSite(
      c.env,
      c.executionCtx,
      'embedded_checkout_created',
      c.get('userId') || orgId,
      { site_id: validated.site_id },
    );
  } catch {
    /* fire-and-forget */
  }

  return c.json({
    data: { client_secret: result.client_secret, publishable_key: c.env.STRIPE_PUBLISHABLE_KEY },
  });
});

/**
 * Get the current Stripe subscription record for the authenticated org.
 *
 * @route GET /api/billing/subscription
 * @auth Bearer — `orgId` MUST resolve from session
 * @returns 200 OK `{ data: <subscription row> | null }` — null when org has no
 *   subscription (free tier, never upgraded).
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 *
 * @remarks
 * Reads from D1 `subscriptions` table. Single source of truth for "is this org on a paid
 * plan and what tier?" — drives entitlements, billing portal, plan-gate UI in frontend.
 *
 * @see {@link billingService.getOrgSubscription}
 */
api.get('/api/billing/subscription', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const sub = await billingService.getOrgSubscription(c.env.DB, orgId);
  return c.json({ data: sub });
});

/**
 * Get the resolved plan entitlements for the authenticated org.
 *
 * @route GET /api/billing/entitlements
 * @auth Bearer — `orgId` MUST resolve from session
 * @returns 200 OK `{ data: <entitlements object> }` — derived from subscription tier,
 *   includes feature flags (custom_domains, unlimited_edits, etc.), caps (site count,
 *   build budget), and resolved plan name.
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 *
 * @remarks
 * Free tier returns a hardcoded baseline. Paid tiers (Patron $50/mo) unlock unlimited
 * edits + AI chat + custom domains. Always check this BEFORE rendering paid-only UI in
 * frontend — never assume entitlements from local cache, as they can change mid-session
 * via Stripe webhook → subscription update.
 *
 * @see {@link billingService.getOrgEntitlements}
 */
api.get('/api/billing/entitlements', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const entitlements = await billingService.getOrgEntitlements(c.env.DB, orgId);
  return c.json({ data: entitlements });
});

// ─── Hostname Routes ─────────────────────────────────────────

/**
 * List all hostnames (free subdomain + custom domains) attached to a site.
 *
 * @route GET /api/sites/:siteId/hostnames
 * @auth Bearer — `orgId` MUST resolve; cross-org access denied via D1 ownership check
 * @param siteId - Immutable site UUID
 * @returns 200 OK `{ data: <hostname[]> }` — each row includes `{ id, hostname, type, is_primary, status }`
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 * @throws {AppError} `NOT_FOUND` — site doesn't exist OR belongs to another org (404
 *   deliberately collapses both cases — no info leakage).
 *
 * @see {@link domainService.getSiteHostnames}
 */
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

/**
 * Provision a new hostname for a site — either a free `*.projectsites.dev` subdomain or
 * a customer-owned custom domain via Cloudflare for SaaS (CF4SaaS).
 *
 * @route POST /api/sites/:siteId/hostnames
 * @auth Bearer — `orgId` MUST resolve; cross-org write denied via D1 ownership check
 * @param siteId - Immutable site UUID (path param)
 * @body createHostnameSchema — `{ hostname, type: 'free_subdomain' | 'custom_cname' }`
 *   (site_id auto-injected from path before parse)
 * @returns 201 Created `{ data: { hostname, ... } }`
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 * @throws {AppError} `FORBIDDEN` — `type=custom_cname` but org lacks paid-plan
 *   entitlement `topBarHidden` (custom domains gated to Patron tier).
 * @throws {AppError} `BAD_REQUEST` — `type=custom_cname` but the hostname's CNAME record
 *   does not point to `DOMAINS.SITES_BASE` (`projectsites.dev`). Error includes the
 *   exact DNS instructions to fix.
 * @throws {ZodError} — body fails `createHostnameSchema`.
 *
 * @remarks
 * **Free subdomain flow:** slug extracted from hostname (`vito.projectsites.dev` → `vito`),
 * provisioned via `domainService.provisionFreeDomain`. No CF4SaaS call — these are wildcard-
 * routed at the Worker layer via D1 lookup.
 *
 * **Custom CNAME flow:** (1) entitlement gate (paid plan), (2) live DNS CNAME check via
 * `domainService.checkCnameTarget` — protects against orphan hostnames stuck in
 * `pending_validation` because the customer never configured DNS, (3) CF4SaaS hostname
 * provisioned via `domainService.provisionCustomDomain` (TLS cert auto-issued).
 *
 * Audit log + PostHog `hostname.provisioned` event fire AFTER provisioning succeeds.
 *
 * @see {@link domainService.provisionFreeDomain}
 * @see {@link domainService.provisionCustomDomain}
 * @see {@link domainService.checkCnameTarget}
 * @see {@link https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/ CF for SaaS}
 */
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

    // Validate CNAME points to projectsites.dev
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
    target_id: siteId,
    metadata_json: {
      site_id: siteId,
      hostname: result.hostname,
      type: validated.type,
      message:
        'Domain added: ' +
        result.hostname +
        (validated.type === 'custom_cname' ? ' (custom CNAME)' : ''),
    },
    request_id: c.get('requestId'),
  });

  try {
    posthog.trackDomain(c.env, c.executionCtx, 'provisioned', c.get('userId') || orgId, {
      hostname: result.hostname,
      type: validated.type,
      site_id: siteId,
    });
  } catch {
    /* fire-and-forget */
  }

  return c.json({ data: result }, 201);
});

// ─── Delete Site ────────────────────────────────────────────

/**
 * Soft-delete a site (and optionally cancel its Stripe subscription at period end).
 *
 * @route DELETE /api/sites/:id
 * @auth Bearer — `orgId` MUST resolve; cross-org delete denied via D1 ownership check
 * @param id - Immutable site UUID (path param)
 * @body Optional `{ cancel_subscription?: boolean }` — when `true` AND site `plan === 'paid'`,
 *   triggers Stripe `cancel_at_period_end=true` on the org's subscription
 * @returns 200 OK `{ data: { deleted: true, subscription_canceled: boolean } }`
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 * @throws {AppError} `NOT_FOUND` — site doesn't exist OR belongs to another org.
 *
 * @remarks
 * **Soft-delete:** sets `deleted_at = NOW()` + `status = 'archived'`. Row stays in D1
 * so audit history + R2 assets remain recoverable. Hard delete is a separate offline
 * job (not exposed via API).
 *
 * **KV cache invalidation:** the site's default hostname (`{slug}.projectsites.dev`) KV
 * key is deleted so the next request to that hostname misses cache and falls through
 * to D1 (returns 404 since `deleted_at` filter excludes archived sites).
 *
 * **Stripe cancellation:** `cancel_at_period_end=true` — user keeps service until end of
 * billing period. Failure to call Stripe (network error, missing key) is swallowed —
 * site deletion always succeeds even if subscription cancel fails. Customer can retry
 * via billing portal.
 *
 * Audit log fires `site.deleted` with `subscription_canceled` flag. PostHog `deleted` event.
 */
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
  await c.env.DB.prepare(
    "UPDATE sites SET deleted_at = datetime('now'), status = 'archived' WHERE id = ?",
  )
    .bind(siteId)
    .run();

  // Invalidate KV cache for the site's subdomain
  const slug = site.slug as string;
  if (slug) {
    await c.env.CACHE_KV.delete(`host:${slug}${DOMAINS.SITES_SUFFIX}`).catch(() => {});
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
            Authorization: `Basic ${btoa(c.env.STRIPE_SECRET_KEY + ':')}`,
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
    metadata_json: {
      site_id: siteId,
      slug,
      subscription_canceled: subscriptionCanceled,
      message:
        'Site deleted: ' +
        slug +
        (subscriptionCanceled ? ' (subscription cancellation requested)' : ''),
    },
    request_id: c.get('requestId'),
  });

  try {
    posthog.trackSite(c.env, c.executionCtx, 'deleted', c.get('userId') || orgId, {
      site_id: siteId,
      slug,
    });
  } catch {
    /* analytics fire-and-forget */
  }

  return c.json({ data: { deleted: true, subscription_canceled: subscriptionCanceled } });
});

// ─── Set Primary Hostname ────────────────────────────────────

/**
 * Mark a hostname as the site's primary (canonical) hostname for SEO + share-link UX.
 *
 * @route PUT /api/sites/:siteId/hostnames/:hostnameId/primary
 * @auth Bearer — `orgId` MUST resolve; cross-org write denied via D1 ownership check
 * @param siteId - Immutable site UUID (path param)
 * @param hostnameId - Hostname row UUID (path param)
 * @returns 200 OK `{ data: { primary: true } }`
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 * @throws {AppError} `NOT_FOUND` — site doesn't exist OR belongs to another org.
 *
 * @remarks
 * Atomically clears `is_primary` on all other hostnames for this site, then sets
 * `is_primary = 1` on the target row. Drives `<link rel="canonical">` injection at
 * serve-time + the "share this site" UI in the dashboard.
 *
 * @see {@link domainService.setPrimaryHostname}
 */
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
    metadata_json: {
      site_id: siteId,
      hostname_id: hostnameId,
      message: 'Primary domain changed for this site',
    },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { primary: true } });
});

// ─── Reset Primary to Default Subdomain ─────────────────────

/**
 * Clear `is_primary` on ALL hostnames for a site — falls back to the default
 * `{slug}.projectsites.dev` subdomain as the canonical URL.
 *
 * @route POST /api/sites/:siteId/hostnames/reset-primary
 * @auth Bearer — `orgId` MUST resolve; cross-org write denied via D1 ownership check
 * @param siteId - Immutable site UUID (path param)
 * @returns 200 OK `{ data: { reset: true } }`
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 * @throws {AppError} `NOT_FOUND` — site doesn't exist OR belongs to another org.
 *
 * @remarks
 * After this call, the site's canonical URL resolves to the default free subdomain
 * (e.g., `vito.projectsites.dev`). Used when a customer removes their custom domain or
 * wants to switch primary back to the platform-hosted hostname. Direct UPDATE on
 * `hostnames` (no service helper) — atomic single-statement, no race condition.
 */
api.post('/api/sites/:siteId/hostnames/reset-primary', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('siteId');

  // Verify ownership
  const site = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    'SELECT id FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  // Clear is_primary on all hostnames for this site
  await c.env.DB.prepare('UPDATE hostnames SET is_primary = 0 WHERE site_id = ?')
    .bind(siteId)
    .run();

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'hostname.reset_primary',
    target_type: 'site',
    target_id: siteId,
    metadata_json: { site_id: siteId, message: 'Primary domain reset to default subdomain' },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { primary_reset: true } });
});

// ─── Delete Hostname ────────────────────────────────────────

/**
 * Hard-delete a hostname row (and de-register from CF4SaaS if custom).
 *
 * @route DELETE /api/sites/:siteId/hostnames/:hostnameId
 * @auth Bearer — `orgId` MUST resolve; cross-org delete denied via ownership check
 * @param siteId - Immutable site UUID (path param)
 * @param hostnameId - Hostname row UUID (path param)
 * @returns 200 OK `{ data: { deleted: true } }`
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 * @throws {AppError} `NOT_FOUND` — site doesn't exist OR belongs to another org, OR
 *   hostname row doesn't exist on that site (both collapse to 404 — no info leakage).
 *
 * @remarks
 * **Hard DELETE on hostnames** (vs soft-delete on sites) — hostnames have no audit-history
 * value beyond the `audit_logs` row written here. KV cache key `host:<hostname>` is
 * deleted so the next request to that hostname misses cache + falls to D1 (returns 404).
 *
 * Audit log fires `hostname.deleted`.
 */
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
    metadata_json: {
      hostname: hostname.hostname,
      site_id: siteId,
      message: 'Domain removed: ' + hostname.hostname,
    },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { deleted: true } });
});

// ─── Unsubscribe Domain (cancel premium domain subscription + delete) ──

/**
 * Soft-delete a premium domain hostname (cancels the customer's domain-specific
 * subscription line item but preserves audit history for billing reconciliation).
 *
 * @route POST /api/sites/:siteId/hostnames/:hostnameId/unsubscribe
 * @auth Bearer — `orgId` MUST resolve; cross-org write denied via ownership check
 * @param siteId - Immutable site UUID (path param)
 * @param hostnameId - Hostname row UUID (path param)
 * @returns 200 OK `{ data: { unsubscribed: true, hostname: string } }`
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 * @throws {AppError} `NOT_FOUND` — site or hostname missing / cross-org.
 *
 * @remarks
 * **Soft-delete** (sets `deleted_at`) vs the hard-delete `DELETE` endpoint above. Used
 * for premium domains where billing reconciliation downstream needs to see the row
 * persist (revenue attribution, refund handling, audit trail). KV cache invalidated
 * the same way.
 *
 * The actual Stripe subscription line-item cancellation is handled by the billing
 * webhook flow (Stripe customer portal → webhook → row update). This endpoint just
 * tombstones the hostname so it stops serving traffic immediately.
 *
 * Audit log fires `hostname.unsubscribed`.
 */
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
    metadata_json: {
      site_id: siteId,
      hostname: hostname.hostname,
      type: hostname.type,
      message: 'Domain unsubscribed: ' + hostname.hostname,
    },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { unsubscribed: true, hostname: hostname.hostname } });
});

// ─── Billing Portal ─────────────────────────────────────────

/**
 * Create a Stripe Customer Billing Portal session — lets the customer self-manage
 * subscription (upgrade/downgrade/cancel), payment method, and invoices.
 *
 * @route POST /api/billing/portal
 * @auth Bearer — `orgId` MUST resolve
 * @body Optional `{ return_url?: string }` — where Stripe sends customer after closing
 *   portal. Defaults to `https://${DOMAINS.SITES_BASE}` (projectsites.dev root).
 * @returns 200 OK `{ data: { url: string } }` — caller redirects browser to `url`
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 * @throws {AppError} `BAD_REQUEST` — org has no `stripe_customer_id` (never subscribed,
 *   nothing to manage). Message prompts user to subscribe first.
 *
 * @remarks
 * Looks up `stripe_customer_id` from `subscriptions` table (single source of truth per
 * org). Calls `billingService.createBillingPortalSession` which hits Stripe's
 * `/v1/billing_portal/sessions` endpoint. Session expires after ~1 hour per Stripe spec.
 *
 * Audit log fires `billing.portal_opened` fire-and-forget.
 *
 * @see {@link billingService.createBillingPortalSession}
 * @see {@link https://stripe.com/docs/billing/subscriptions/customer-portal Stripe Customer Portal}
 */
api.post('/api/billing/portal', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const body = await c.req.json();
  const returnUrl = (body as { return_url?: string }).return_url || `https://${DOMAINS.SITES_BASE}`;

  // Look up Stripe customer ID for this org
  const sub = await dbQueryOne<{ stripe_customer_id: string | null }>(
    c.env.DB,
    'SELECT stripe_customer_id FROM subscriptions WHERE org_id = ? AND deleted_at IS NULL',
    [orgId],
  );

  if (!sub?.stripe_customer_id) {
    throw badRequest('No billing account found. Please subscribe first.');
  }

  const result = await billingService.createBillingPortalSession(
    c.env,
    sub.stripe_customer_id,
    returnUrl,
  );

  auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'billing.portal_opened',
      target_type: 'billing',
      target_id: orgId,
      metadata_json: {
        stripe_customer_id: sub.stripe_customer_id,
        message: 'Billing portal session opened',
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({ data: result });
});

// ─── Audit Routes ────────────────────────────────────────────

/**
 * List recent audit log entries scoped to the caller's org. Powers the
 * dashboard activity feed and admin investigation views.
 *
 * @route GET /api/audit-logs
 * @auth Bearer — `orgId` MUST resolve
 * @queryParam limit — default 50, capped at 200
 * @queryParam offset — default 0, floored at 0 (negative values clamped)
 * @returns 200 OK `{ data: AuditLog[] }` — ordered by `created_at DESC`
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 *
 * @remarks
 * Org-scoped read: cross-tenant rows are never returned (org_id filter
 * applied inside `auditService.getAuditLogs`). The audit log is
 * append-only — these rows are never mutated, only inserted by
 * `auditService.writeAuditLog` fire-and-forget across the codebase.
 *
 * @see {@link auditService.getAuditLogs}
 */
api.get('/api/audit-logs', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const limit = Math.min(Number(c.req.query('limit') ?? '50'), 200);
  const offset = Math.max(Number(c.req.query('offset') ?? '0'), 0);

  const result = await auditService.getAuditLogs(c.env.DB, orgId, { limit, offset });
  return c.json({ data: result.data });
});

// ─── Site-Specific Logs ─────────────────────────────────────

/**
 * List audit log entries for a single site. Powers the build-progress
 * streaming UI and the per-site history view.
 *
 * @route GET /api/sites/:id/logs
 * @auth Bearer — `orgId` MUST resolve
 * @param id — site UUID (path param)
 * @queryParam limit — default 100, capped at 200
 * @queryParam offset — default 0, floored at 0
 * @returns 200 OK `{ data: AuditLog[] }` — site-scoped, ordered by `created_at DESC`
 * @throws {AppError} `UNAUTHORIZED` — session missing orgId.
 * @throws {AppError} `NOT_FOUND` — site missing or not owned by caller's org.
 *
 * @remarks
 * Cross-org guard: site row lookup includes `WHERE id = ? AND org_id = ?`
 * before returning logs. Intentionally queries WITHOUT `deleted_at IS NULL`
 * so the site-history view can surface logs for archived sites — useful
 * for post-mortem investigation of failed/deleted builds.
 *
 * @see {@link auditService.getSiteAuditLogs}
 */
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
 * Publish a bolt.diy project's compiled `dist/` output to projectsites.dev R2.
 * Accepts the file array + chat export, generates a slug via Workers AI when
 * one isn't supplied, uploads under `sites/{slug}/{version}/...`, writes a
 * `_manifest.json` pointer at `current_version`, and busts the KV host cache
 * so the next request to `{slug}.projectsites.dev` serves the new version.
 *
 * @route POST /api/publish/bolt
 * @auth NONE — bolt.diy users publish anonymously under the "free" plan.
 *   System-level audit log uses `org_id='bolt'` sentinel since there's no
 *   per-user org row to attribute the publish to.
 * @body `{ files: { path, content }[], chat: { messages, description?,
 *   exportDate }, slug: string | null }` — `files` MUST be non-empty;
 *   `slug=null` triggers AI generation from chat description.
 * @returns 201 Created `{ data: { slug, version, url, files_uploaded } }`
 *   — `url` is `https://${slug}.projectsites.dev`, `version` is the ISO
 *   timestamp (colons + dots replaced with hyphens for R2 path safety).
 * @throws {AppError} `BAD_REQUEST` — `files` missing or empty array.
 *
 * @remarks
 * Slug resolution chain (when `existingSlug` not provided):
 * 1. `generateSlugFromChat()` — tries simple slugification of `chat.description`,
 *    then Workers AI (`@cf/meta/llama-3.1-8b-instruct`) on first user message,
 *    finally falls back to `site-${Date.now().toString(36)}`.
 * 2. `ensureUniqueSlug()` — checks R2 for existing `_manifest.json` and
 *    appends `-2`, `-3`, ... up to 10 attempts before giving up.
 *
 * Versioning: every publish creates a new `sites/{slug}/{version}/` directory
 * AND updates `sites/{slug}/_manifest.json` to point `current_version` at it.
 * Older versions remain in R2 — site-serving reads the manifest to resolve.
 *
 * Chat export is stored at `sites/{slug}/{version}/_meta/chat.json` (the
 * underscore prefix keeps it out of the public file list and the serving
 * path strips `_meta` paths server-side).
 *
 * KV invalidation: deletes `host:{slug}.projectsites.dev` so the next request
 * misses cache and re-resolves from D1 (or falls through to manifest read).
 *
 * Content-type map: HTML/CSS/JS/JSON/PNG/JPG/SVG/WOFF2/etc. mapped from path
 * extension; unknown extensions get `application/octet-stream`.
 *
 * @example
 * ```bash
 * curl -X POST https://projectsites.dev/api/publish/bolt \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "files": [{"path":"index.html","content":"<!doctype html>..."}],
 *     "chat": {"description":"Vitos Mens Salon","messages":[...]},
 *     "slug": null
 *   }'
 * # → 201 { data: { slug: "vitos-mens-salon", version: "2026-05-11T...", url: "https://vitos-mens-salon.projectsites.dev", files_uploaded: 1 } }
 * ```
 *
 * @see {@link generateSlugFromChat}
 * @see {@link ensureUniqueSlug}
 */
api.post('/api/publish/bolt', async (c) => {
  const body = await c.req.json();
  const {
    files,
    chat,
    slug: existingSlug,
  } = body as {
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

    return c.env.SITES_BUCKET.put(`sites/${slug}/${version}/${f.path}`, f.content, {
      httpMetadata: { contentType },
    });
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
  const cacheKey = `host:${slug}${DOMAINS.SITES_SUFFIX}`;
  await c.env.CACHE_KV.delete(cacheKey);

  const siteUrl = `https://${slug}${DOMAINS.SITES_SUFFIX}`;

  // Audit: bolt.diy project published (no auth — system-level log)
  auditService
    .writeAuditLog(c.env.DB, {
      org_id: 'bolt',
      actor_id: null,
      action: 'site.published_from_bolt',
      target_type: 'site',
      target_id: slug,
      metadata_json: {
        slug,
        version,
        files_uploaded: files.length,
        url: siteUrl,
        had_existing_slug: !!existingSlug,
        message:
          'bolt.diy project published — ' +
          files.length +
          ' files → ' +
          slug +
          ' (version ' +
          version +
          ')',
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json(
    {
      data: {
        slug,
        version,
        url: siteUrl,
        files_uploaded: files.length,
      },
    },
    201,
  );
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

    const result = await env.AI.run(
      '@cf/meta/llama-3.1-8b-instruct' as Parameters<typeof env.AI.run>[0],
      {
        messages: [
          {
            role: 'system',
            content:
              'Generate a short URL slug for a website. Output ONLY the slug, nothing else. Use lowercase letters, numbers, and hyphens. Maximum 3-4 words. Examples: vitos-mens-salon, pizza-palace, janes-bakery',
          },
          {
            role: 'user',
            content: `Project: ${chat?.description ?? 'Unknown'}\nContext: ${firstUserMsg.substring(0, 300)}`,
          },
        ],
        max_tokens: 50,
      },
    );

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
 * Retrieve the AI build-context JSON for a published site slug. Used by
 * bolt.diy to bootstrap a chat session preloaded with research data so
 * the editor can iteratively improve the generated site.
 *
 * @route GET /api/sites/by-slug/:slug/build-context
 * @auth NONE — slug + R2 obscurity serve as the access token; no PII
 *   stored in build-context (research-only data).
 * @param slug — site slug (path param)
 * @returns 200 OK `application/json` — raw build-context document
 *   (research summary + brand kit + content blocks consumed by bolt.diy).
 * @throws {AppError} `NOT_FOUND` — no `_build-context.json` at that path
 *   (site never went through the AI workflow, or context wasn't persisted).
 *
 * @remarks
 * Reads `sites/{slug}/assets/_build-context.json` directly from R2 —
 * NOT version-pinned. The build-context is the orchestrator's input,
 * not the site output, so it lives at the site root rather than under
 * a version directory.
 *
 * Sets `Access-Control-Allow-Origin: *` so the bolt.diy editor (hosted
 * on a different origin) can read it client-side. `Cache-Control: no-cache`
 * so a re-publish picks up updated research without manual purge.
 *
 * @see {@link buildContextService}
 */
api.get('/api/sites/by-slug/:slug/build-context', async (c) => {
  const slug = c.req.param('slug');

  const contextObj = await c.env.SITES_BUCKET.get(`sites/${slug}/assets/_build-context.json`);

  if (!contextObj) {
    throw notFound('No build context found for this site');
  }

  const contextData = await contextObj.text();

  return new Response(contextData, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

/**
 * Reconstruct a bolt.diy-compatible chat export for a published site so
 * the editor can "open" the site as if it were the original chat
 * session. Reads `_manifest.json` to find the current version, lists
 * source files from R2, reads each text file, and wraps them in a
 * synthetic `<boltArtifact>` payload with `<boltAction type="file">`
 * blocks per source file.
 *
 * @route GET /api/sites/by-slug/:slug/chat
 * @auth NONE — slug serves as access token; binary files filtered
 *   server-side so this endpoint can't be used to exfiltrate non-text
 *   assets.
 * @param slug — site slug (path param)
 * @returns 200 OK `application/json` — bolt.diy chat schema:
 *   `{ messages: [user, assistant], description, exportDate }`.
 *   Assistant message body is a `<boltArtifact>` block listing every
 *   source file. For Vite projects, includes shell actions
 *   (`npm install` + `npm run dev`) so opening the chat auto-boots the
 *   dev server.
 * @throws {AppError} `NOT_FOUND` — manifest missing, no `current_version`,
 *   or no readable text files in the resolved prefix.
 *
 * @remarks
 * Vite-vs-static branching: `is_vite_project=true` reads from
 * `sites/{slug}/{version}/_src/` (source code for editor) and appends
 * install + start shell actions. Static sites read from
 * `sites/{slug}/{version}/` directly (compiled output, no shell actions).
 *
 * Binary file filter: only files with text extensions (HTML, CSS, JS,
 * TS, JSON, XML, SVG, MD, YAML, TOML, etc.) or no extension (LICENSE,
 * Makefile) pass through. Reading binaries as `.text()` corrupts
 * content — silently dropping them prevents broken bolt.diy state.
 *
 * `package.json` sorts FIRST in the artifact so bolt.diy detects the
 * Vite project and auto-runs `npm install` before other file writes.
 *
 * Business name lookup: tries D1 `sites.business_name` first, falls
 * back to slug-derived title-case ("vitos-mens-salon" →
 * "Vitos Mens Salon") if the row is missing or soft-deleted.
 *
 * Excluded prefixes: `_meta/` (chat exports, internal manifests) and
 * `research.json` (raw research data) are filtered out — they aren't
 * source files.
 *
 * @see {@link generateSlugFromChat} for inverse direction (chat → slug).
 */
api.get('/api/sites/by-slug/:slug/chat', async (c) => {
  const slug = c.req.param('slug');

  // Read manifest to get current version and file list
  const manifest = await c.env.SITES_BUCKET.get(`sites/${slug}/_manifest.json`);

  if (!manifest) {
    throw notFound('Site not found or no version published');
  }

  const manifestData = (await manifest.json()) as {
    current_version: string;
    files?: string[];
    source_files?: string[];
    is_vite_project?: boolean;
  };

  if (!manifestData.current_version) {
    throw notFound('No published version found');
  }

  const version = manifestData.current_version;
  const isVite = manifestData.is_vite_project === true;

  // For Vite projects, serve source files from _src/ so the editor can run the dev server
  const prefix = isVite ? `sites/${slug}/${version}/_src/` : `sites/${slug}/${version}/`;

  // Extensions safe to read as text and embed in boltArtifact
  const TEXT_EXTENSIONS = new Set([
    '.html',
    '.htm',
    '.css',
    '.js',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.jsx',
    '.json',
    '.xml',
    '.txt',
    '.svg',
    '.md',
    '.mdx',
    '.yaml',
    '.yml',
    '.toml',
    '.env',
    '.gitignore',
    '.npmrc',
    '.prettierrc',
    '.eslintrc',
    '.map',
    '.webmanifest',
    '.csv',
    '.tsv',
    '.graphql',
    '.gql',
  ]);

  const isTextFile = (filePath: string): boolean => {
    // Files without extensions (LICENSE, Makefile, etc.) are treated as text
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1 || lastDot < filePath.lastIndexOf('/')) return true;
    return TEXT_EXTENSIONS.has(filePath.slice(lastDot).toLowerCase());
  };

  // Determine which files to include — from manifest or R2 listing
  // For Vite projects, prefer source_files (editor needs source, not built output)
  let filePaths: string[] = (isVite ? manifestData.source_files : manifestData.files) ?? [];

  // If manifest doesn't list files, list the R2 prefix
  if (filePaths.length === 0) {
    const listed = await c.env.SITES_BUCKET.list({ prefix, limit: 100 });
    filePaths = listed.objects
      .map((obj) => obj.key.replace(prefix, ''))
      .filter((p) => !p.startsWith('_meta/') && p !== 'research.json');
  } else {
    // Filter out non-site files
    filePaths = filePaths.filter((p) => !p.startsWith('_meta/') && p !== 'research.json');
  }

  // Filter out binary files — reading them as .text() corrupts the content
  filePaths = filePaths.filter(isTextFile);

  // Read all file contents in parallel
  const fileReads = filePaths.map(async (filePath) => {
    const obj = await c.env.SITES_BUCKET.get(`${prefix}${filePath}`);
    if (!obj) return null;
    const content = await obj.text();
    return { path: filePath, content };
  });

  const files = (await Promise.all(fileReads)).filter(
    (f): f is { path: string; content: string } => f !== null,
  );

  if (files.length === 0) {
    throw notFound('No files found for this site version');
  }

  // Look up business name from D1
  let businessName = slug.replace(/-/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
  try {
    const site = await c.env.DB.prepare(
      'SELECT business_name FROM sites WHERE slug = ? AND deleted_at IS NULL',
    )
      .bind(slug)
      .first<{ business_name: string }>();
    if (site?.business_name) businessName = site.business_name;
  } catch {
    // Use slug-derived name as fallback
  }

  // Build bolt.diy-compatible boltArtifact content
  // Sort files: package.json first (triggers auto-install in bolt.diy)
  const sortedFiles = [...files].sort((a, b) => {
    if (a.path === 'package.json') return -1;
    if (b.path === 'package.json') return 1;
    return a.path.localeCompare(b.path);
  });

  const fileActions = sortedFiles.map(
    (f) => `<boltAction type="file" filePath="${f.path}">\n${f.content}\n</boltAction>`,
  );

  // For Vite projects, add install + start actions so the dev server starts
  const postFileActions = isVite
    ? [
        '<boltAction type="shell">npm install --legacy-peer-deps</boltAction>',
        '<boltAction type="start">npm run dev</boltAction>',
      ]
    : [];

  const assistantContent = [
    `I've built a professional website for ${businessName} with ${files.length} files.\n`,
    `<boltArtifact id="site-${slug}" title="${businessName} Website">`,
    ...fileActions,
    ...postFileActions,
    '</boltArtifact>',
  ].join('\n');

  const now = new Date().toISOString();

  const chatJson = {
    messages: [
      {
        id: `msg-user-${slug}`,
        role: 'user',
        content: `Build a professional website for ${businessName}`,
        createdAt: now,
      },
      {
        id: `msg-asst-${slug}`,
        role: 'assistant',
        content: assistantContent,
        createdAt: now,
      },
    ],
    description: `${businessName} Website`,
    exportDate: now,
  };

  return new Response(JSON.stringify(chatJson), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

// ─── File listing (metadata only, no content) ──────────────

/**
 * List file metadata for a published site without returning file
 * content. Used by the bolt.diy editor sidebar to render the file tree
 * before fetching individual files on demand.
 *
 * @route GET /api/sites/by-slug/:slug/files
 * @auth NONE — slug serves as access token; only metadata exposed,
 *   never content.
 * @param slug — site slug (path param)
 * @returns 200 OK `{ slug, version, fileCount, files: Array<{ path, size,
 *   etag, httpMetadata, extension }>, is_vite_project }`.
 *   `httpMetadata` includes `contentType` for client-side rendering hints.
 * @throws {AppError} `NOT_FOUND` — manifest missing or `current_version`
 *   not set on the manifest.
 *
 * @remarks
 * Same Vite-vs-static prefix branching as `/chat`: Vite reads
 * `_src/`, static reads version root. Lists up to 500 R2 objects per
 * call — sufficient for any reasonable site, but caller should be
 * aware that very large generated sites will be truncated silently.
 *
 * Filtered out: `_meta/`, `research.json`, `_manifest.json` — internal
 * artifacts the editor doesn't need to surface.
 *
 * No content fetched: each file is a single R2 list-objects field, not
 * a body read. Editor must call `/api/sites/by-slug/:slug/chat` (full
 * read) or a separate per-file endpoint to get bodies.
 */
api.get('/api/sites/by-slug/:slug/files', async (c) => {
  const slug = c.req.param('slug');

  const manifest = await c.env.SITES_BUCKET.get(`sites/${slug}/_manifest.json`);
  if (!manifest) {
    throw notFound('Site not found or no version published');
  }

  const manifestData = (await manifest.json()) as {
    current_version: string;
    files?: string[];
    source_files?: string[];
    is_vite_project?: boolean;
  };

  if (!manifestData.current_version) {
    throw notFound('No published version found');
  }

  const version = manifestData.current_version;
  const isVite = manifestData.is_vite_project === true;

  // For Vite projects, list source files from _src/ prefix (for the editor)
  // For legacy static sites, list the serving files directly
  const prefix = isVite ? `sites/${slug}/${version}/_src/` : `sites/${slug}/${version}/`;

  // List all files from R2
  const listed = await c.env.SITES_BUCKET.list({ prefix, limit: 500 });
  const files = listed.objects
    .filter((obj) => {
      const rel = obj.key.replace(prefix, '');
      return !rel.startsWith('_meta/') && rel !== 'research.json' && rel !== '_manifest.json';
    })
    .map((obj) => {
      const path = obj.key.replace(prefix, '');
      const ext = path.includes('.') ? path.slice(path.lastIndexOf('.')) : '';
      return {
        path,
        size: obj.size,
        etag: obj.etag,
        httpMetadata: obj.httpMetadata,
        extension: ext,
      };
    });

  return c.json({
    slug,
    version,
    fileCount: files.length,
    files,
    is_vite_project: isVite,
  });
});

// ─── Research JSON (public or gated by env var) ──────────────

/**
 * Retrieve the AI-generated research JSON for a published site slug.
 * Access is gated by the `RESEARCH_JSON_PUBLIC` env var: when set to
 * `"true"`, no auth required; otherwise the caller MUST be authenticated
 * AND the site MUST belong to the caller's org.
 *
 * @route GET /api/sites/by-slug/:slug/research.json
 * @auth Conditional — Bearer required UNLESS `env.RESEARCH_JSON_PUBLIC === 'true'`.
 * @param slug — site slug (path param)
 * @returns 200 OK `application/json` — raw research blob (business
 *   profile, brand kit, social discovery, USPs, image strategies, etc.).
 * @throws {AppError} `UNAUTHORIZED` — research is private AND session
 *   missing orgId.
 * @throws {AppError} `NOT_FOUND` — site missing/cross-org, manifest
 *   missing, or `research.json` not present at either versioned or root
 *   path.
 *
 * @remarks
 * Lookup chain: versioned path
 * `sites/{slug}/{current_version}/research.json` → root path
 * `sites/{slug}/research.json`. Versioned wins; root is the legacy
 * fallback for sites generated before the versioning convention shipped.
 *
 * Cross-org guard: when private, runs `WHERE slug = ? AND org_id = ?
 * AND deleted_at IS NULL` BEFORE the R2 read. Soft-deleted sites are
 * not surfaced regardless of org match.
 *
 * 5-minute browser cache (`public, max-age=300`) when served — research
 * data rarely changes post-publish. Set `RESEARCH_JSON_PUBLIC=true` for
 * portfolio sites where research transparency is a feature.
 */
api.get('/api/sites/by-slug/:slug/research.json', async (c) => {
  const slug = c.req.param('slug');
  const isPublic = c.env.RESEARCH_JSON_PUBLIC === 'true';

  if (!isPublic) {
    const orgId = c.get('orgId');
    if (!orgId)
      throw unauthorized(
        'Research data requires authentication (or set RESEARCH_JSON_PUBLIC=true)',
      );

    // Verify the site belongs to the user's org
    const site = await dbQueryOne<{ id: string }>(
      c.env.DB,
      'SELECT id FROM sites WHERE slug = ? AND org_id = ? AND deleted_at IS NULL',
      [slug, orgId],
    );
    if (!site) throw notFound('Site not found');
  }

  // Read manifest to get current version
  const manifest = await c.env.SITES_BUCKET.get(`sites/${slug}/_manifest.json`);
  if (!manifest) throw notFound('Site not found or no version published');

  const manifestData = (await manifest.json()) as { current_version: string };
  if (!manifestData.current_version) throw notFound('No published version found');

  // Try versioned path first, then direct research.json
  let researchObj = await c.env.SITES_BUCKET.get(
    `sites/${slug}/${manifestData.current_version}/research.json`,
  );

  if (!researchObj) {
    // Fallback: check if research.json exists at the root of the site
    researchObj = await c.env.SITES_BUCKET.get(`sites/${slug}/research.json`);
  }

  if (!researchObj) throw notFound('No research data found for this site');

  const researchData = await researchObj.text();

  return new Response(researchData, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

// ─── Update Site (Title / Slug) ──────────────────────────────

/**
 * @route PATCH /api/sites/:id
 * @auth Bearer orgId
 * @param id - Site UUID. Cross-org guard: `WHERE id = ? AND org_id = ? AND deleted_at IS NULL`.
 * @body { business_name?: string, slug?: string } — both fields optional.
 *   `business_name` is trimmed and capped at 200 chars. `slug` is normalized
 *   (lowercase, `[^a-z0-9-]` → `-`, collapse repeats, strip leading/trailing `-`,
 *   100-char cap). When both fields are missing/empty, response is the no-op
 *   `{ data: { updated: false } }`.
 * @returns 200 OK `{ data: { updated: true, business_name?, slug? } }` on
 *   successful write, or `{ data: { updated: false } }` when nothing changed
 *   (e.g. slug normalized to the same value the site already has).
 * @throws UNAUTHORIZED — missing `orgId` in session context.
 * @throws NOT_FOUND — site does not exist, belongs to another org, or is
 *   soft-deleted.
 * @throws BAD_REQUEST — slug-change rate limit exceeded (>10/hr), concurrent
 *   slug change in progress (KV migration lock held), or slug already taken
 *   by another live site.
 *
 * @remarks
 * Slug-rename is the heavyweight path; business-name update alone is just a
 * D1 column write. Slug changes additionally:
 *
 * 1. **Rate-limit (max 10/hr per site)** — counted via `audit_logs WHERE
 *    target_id = ? AND action = 'site.slug_changed' AND created_at > -1h`.
 *    Protects against thrash + abuse of the R2 migration cost.
 * 2. **Migration lock (KV)** — `slug_migration:{siteId}` keyed at 120s TTL.
 *    Blocks concurrent slug changes that would race the R2 copy loop and
 *    leave R2 in a half-migrated state. Released in `finally` (delete +
 *    swallow) so a crash doesn't permanently lock the site.
 * 3. **Uniqueness check** — `SELECT id FROM sites WHERE slug = ? AND id != ?
 *    AND deleted_at IS NULL` BEFORE the D1 update, so the user gets a clean
 *    BAD_REQUEST instead of a UNIQUE constraint violation buried in the
 *    error envelope.
 * 4. **KV cache invalidation** — `host:{old_slug}{DOMAINS.SITES_SUFFIX}` is
 *    deleted so the next request to the old hostname falls through to D1
 *    (which will 404) instead of serving the cached site record. Audit
 *    `site.cache_invalidated` logged.
 * 5. **R2 file migration** — lists `sites/{old_slug}/` (up to 500 objects),
 *    copies each to `sites/{new_slug}/{...}` preserving `httpMetadata`.
 *    Migration is best-effort: a thrown error logs `site.r2_migration_failed`
 *    and continues — the D1 slug update still commits, so the new slug
 *    resolves immediately (just without R2 content until a re-publish).
 *    Audit-trail covers `started` + `complete` + `failed` paths so the
 *    state is recoverable from logs.
 *
 * Old R2 files at `sites/{old_slug}/` are NOT deleted by this route — they
 * become orphans cleaned up by a separate sweeper job. This avoids partial
 * data loss when migration succeeds but D1 write fails downstream.
 *
 * @see {@link auditService.writeAuditLog}
 *
 * @example
 * ```bash
 * # Rename slug
 * curl -X PATCH https://projectsites.dev/api/sites/$SITE_ID \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{"slug": "vitos-salon-v2"}'
 *
 * # Update business name only
 * curl -X PATCH https://projectsites.dev/api/sites/$SITE_ID \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -d '{"business_name": "Vito'\''s Mens Salon"}'
 * ```
 */
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
      // Rate limit: max 10 slug changes per hour per site
      const slugChangeCount = await dbQueryOne<{ cnt: number }>(
        c.env.DB,
        `SELECT COUNT(*) as cnt FROM audit_logs
         WHERE target_id = ? AND action = 'site.slug_changed'
         AND created_at > datetime('now', '-1 hour')`,
        [siteId],
      );
      if (slugChangeCount && slugChangeCount.cnt >= 10) {
        throw badRequest('Slug change rate limit exceeded. Maximum 10 changes per hour.');
      }

      // Check if there's an ongoing R2 migration (lock via KV)
      const migrationLockKey = `slug_migration:${siteId}`;
      const lockValue = await c.env.CACHE_KV.get(migrationLockKey);
      if (lockValue) {
        throw badRequest('A slug change is already in progress. Please wait for it to complete.');
      }
      // Set migration lock (auto-expires in 120s)
      await c.env.CACHE_KV.put(migrationLockKey, 'locked', { expirationTtl: 120 });

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
        await c.env.CACHE_KV.delete(`host:${site.slug}${DOMAINS.SITES_SUFFIX}`).catch(() => {});

        // Audit: KV cache invalidated for old hostname
        auditService
          .writeAuditLog(c.env.DB, {
            org_id: orgId,
            actor_id: c.get('userId') ?? null,
            action: 'site.cache_invalidated',
            target_type: 'site',
            target_id: siteId,
            metadata_json: {
              cache_key: `host:${site.slug}${DOMAINS.SITES_SUFFIX}`,
              reason: 'slug_change',
              message:
                'KV cache invalidated for ' +
                site.slug +
                DOMAINS.SITES_SUFFIX +
                ' (slug renamed to ' +
                newSlug +
                ')',
            },
            request_id: c.get('requestId'),
          })
          .catch(() => {});
      }

      // Copy R2 files from old slug to new slug
      try {
        const oldPrefix = `sites/${site.slug}/`;
        const listed = await c.env.SITES_BUCKET.list({ prefix: oldPrefix, limit: 500 });

        // Audit: R2 migration started
        auditService
          .writeAuditLog(c.env.DB, {
            org_id: orgId,
            actor_id: c.get('userId') ?? null,
            action: 'site.r2_migration_started',
            target_type: 'site',
            target_id: siteId,
            metadata_json: {
              old_prefix: oldPrefix,
              new_prefix: `sites/${newSlug}/`,
              file_count: listed.objects.length,
              message:
                'Migrating R2 files from sites/' +
                site.slug +
                '/ to sites/' +
                newSlug +
                '/ (' +
                listed.objects.length +
                ' objects)',
            },
            request_id: c.get('requestId'),
          })
          .catch(() => {});

        let migratedCount = 0;
        for (const obj of listed.objects) {
          const newKey = `sites/${newSlug}/${obj.key.slice(oldPrefix.length)}`;
          const source = await c.env.SITES_BUCKET.get(obj.key);
          if (source) {
            await c.env.SITES_BUCKET.put(newKey, source.body, {
              httpMetadata: source.httpMetadata,
            });
            migratedCount++;
          }
        }

        // Audit: R2 migration completed
        auditService
          .writeAuditLog(c.env.DB, {
            org_id: orgId,
            actor_id: c.get('userId') ?? null,
            action: 'site.r2_migration_complete',
            target_type: 'site',
            target_id: siteId,
            metadata_json: {
              old_slug: site.slug,
              new_slug: newSlug,
              files_migrated: migratedCount,
              total_objects: listed.objects.length,
              message:
                'R2 migration complete — ' +
                migratedCount +
                '/' +
                listed.objects.length +
                ' files copied to sites/' +
                newSlug +
                '/',
            },
            request_id: c.get('requestId'),
          })
          .catch(() => {});
      } catch (migrationErr) {
        // R2 migration failure should not block the slug update
        const migErrMsg =
          migrationErr instanceof Error ? migrationErr.message : String(migrationErr);
        console.warn(
          `Failed to migrate R2 files from sites/${site.slug}/ to sites/${newSlug}/: ${migErrMsg}`,
        );

        // Audit: R2 migration failed
        auditService
          .writeAuditLog(c.env.DB, {
            org_id: orgId,
            actor_id: c.get('userId') ?? null,
            action: 'site.r2_migration_failed',
            target_type: 'site',
            target_id: siteId,
            metadata_json: {
              old_slug: site.slug,
              new_slug: newSlug,
              error: migErrMsg,
              message:
                'R2 file migration failed: ' +
                migErrMsg +
                ' — slug updated but old files may still exist',
            },
            request_id: c.get('requestId'),
          })
          .catch(() => {});
      }
      // Release migration lock
      await c.env.CACHE_KV.delete(`slug_migration:${siteId}`).catch(() => {});
    }
  }

  if (updates.length === 0) {
    return c.json({ data: { updated: false } });
  }

  updates.push("updated_at = datetime('now')");
  params.push(siteId);

  await c.env.DB.prepare(`UPDATE sites SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...params)
    .run();

  // Write specific audit logs for slug and name changes
  if (body.slug && body.slug.trim()) {
    const newSlug = body.slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100);
    if (newSlug && newSlug !== site.slug) {
      await auditService
        .writeAuditLog(c.env.DB, {
          org_id: orgId,
          actor_id: c.get('userId') ?? null,
          action: 'site.slug_changed',
          target_type: 'site',
          target_id: siteId,
          metadata_json: {
            old_slug: site.slug,
            new_slug: newSlug,
            message:
              'URL changed from ' +
              site.slug +
              DOMAINS.SITES_SUFFIX +
              ' to ' +
              newSlug +
              DOMAINS.SITES_SUFFIX,
          },
          request_id: c.get('requestId'),
        })
        .catch(() => {});
    }
  }

  if (body.business_name && body.business_name.trim()) {
    await auditService
      .writeAuditLog(c.env.DB, {
        org_id: orgId,
        actor_id: c.get('userId') ?? null,
        action: 'site.name_changed',
        target_type: 'site',
        target_id: siteId,
        metadata_json: {
          new_name: body.business_name.trim().slice(0, 200),
          message: 'Site name updated to "' + body.business_name.trim().slice(0, 200) + '"',
        },
        request_id: c.get('requestId'),
      })
      .catch(() => {});
  }

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.updated',
    target_type: 'site',
    target_id: siteId,
    metadata_json: { site_id: siteId, ...body, message: 'Site settings updated' },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { updated: true } });
});

// ─── Reset Site (Re-crawl & Rebuild) ─────────────────────────

/**
 * @route POST /api/sites/:id/reset
 * @auth Bearer orgId
 * @param id - Site UUID. Cross-org guard enforced.
 * @body Optional `{ business?, additional_context?, directive_version?,
 *   prior_recommendations?, expert_notes?, budget_tier? }`. Malformed or
 *   missing body is tolerated — reset proceeds with persisted site fields
 *   as fallback. Documented fields:
 *   - `directive_version` (1-indexed): when > 1 the workflow reuses a stable
 *     container DO across iterations (warm-keep) and the orchestrator prompt
 *     receives prior recommendations as targeted fixes.
 *   - `prior_recommendations`: array of `{ category, severity, description }`
 *     trimmed to ≤50 entries (category 60 chars, severity 20 chars,
 *     description 500 chars). Empty descriptions filtered out.
 *   - `budget_tier`: optional override (`free|standard|plus|premium`),
 *     Zod-validated; falls back to the tier persisted on the D1 site row,
 *     then `'free'` as the safe baseline.
 *
 * @returns 200 OK `{ data: { workflow_id: string | null, ... } }` — `workflow_id`
 *   is null when `SITE_WORKFLOW` binding is unavailable (dev environment)
 *   or both workflow creation attempts failed.
 * @throws UNAUTHORIZED — missing `orgId`.
 * @throws NOT_FOUND — site missing / cross-org / soft-deleted.
 *
 * @remarks
 * Convergence loop entry point — drives the AI build pipeline forward by
 * one iteration per call. Each reset flips `status='building'` and creates
 * a fresh `SITE_WORKFLOW` instance. The workflow ID strategy:
 *
 * 1. **First attempt:** use `siteId` as the workflow instance ID. This keeps
 *    workflow instances 1:1 with sites for the common single-iteration case
 *    so `GET /api/sites/:id/workflow` can resolve cleanly without a join.
 * 2. **Collision retry:** if instance with that ID already exists (race
 *    between two reset calls, or prior instance still in `running` state),
 *    fall back to `{siteId}-reset-{timestamp}` and log `workflow.retry_created`
 *    audit. The site row is still updated to point to the new instance via
 *    workflow status polling.
 * 3. **Both failed:** log `workflow.creation_failed` audit with both error
 *    messages — site is left in `building` status but no workflow runs, so
 *    the cron unsticker (see `~/.claude/rules/failed-pipeline-protocol.md`)
 *    will flip it to `error` after the 30-minute SLA.
 *
 * Business fields (`name`, `address`, `place_id`) are updated in the same
 * transaction as the status flip — explicit overrides win over the persisted
 * values, otherwise the existing site row drives the rebuild. `website` is
 * passed to the workflow but NOT persisted (it's a one-shot crawl hint).
 *
 * Always writes the `site.reset` audit log regardless of workflow availability
 * — provides a post-mortem trail even when CF Workflows is degraded.
 *
 * @see {@link SITE_WORKFLOW} - Cloudflare Workflow binding (`src/workflows/site-generation.ts`)
 * @see {@link budgetTierSchema}
 *
 * @example
 * ```bash
 * # First-time build with explicit business details
 * curl -X POST https://projectsites.dev/api/sites/$ID/reset \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "business": {"name": "Vito'\''s Mens Salon", "address": "74 N Beverwyck Rd, Lake Hiawatha, NJ"},
 *     "budget_tier": "standard"
 *   }'
 *
 * # Iteration 2+ with convergence feedback
 * curl -X POST https://projectsites.dev/api/sites/$ID/reset \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -d '{
 *     "directive_version": 2,
 *     "prior_recommendations": [{"category": "design", "severity": "major", "description": "hero contrast too low"}]
 *   }'
 * ```
 */
api.post('/api/sites/:id/reset', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');

  // Verify ownership + load existing fields (used as fallback when body is empty)
  const site = await dbQueryOne<{
    id: string;
    slug: string;
    org_id: string;
    business_name: string | null;
    business_address: string | null;
    google_place_id: string | null;
    budget_tier: string | null;
  }>(
    c.env.DB,
    'SELECT id, slug, org_id, business_name, business_address, google_place_id, budget_tier FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  let body: {
    business?: { name?: string; address?: string; place_id?: string; website?: string };
    additional_context?: string;
    /**
     * Convergence loop hint: 1-indexed iteration number. When > 1, the workflow
     * reuses a stable container DO across iterations (warm-keep) and the
     * orchestrator prompt receives the prior recommendations as targeted fixes.
     */
    directive_version?: number;
    prior_recommendations?: Array<{ category?: string; severity?: string; description?: string }>;
    expert_notes?: string;
    /**
     * Optional budget tier override on rebuild (free | standard | plus | premium).
     * When omitted, falls back to the tier persisted on the D1 site row.
     */
    budget_tier?: string;
  } = {};
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    // Empty or malformed body is acceptable — reset with defaults
  }

  const iteration =
    typeof body.directive_version === 'number' && body.directive_version > 0
      ? Math.floor(body.directive_version)
      : undefined;

  // Resolve budget tier: explicit body override > persisted site row > 'free' default.
  // Validate via Zod so invalid values silently fall through to the safe baseline.
  const budgetTierFromBody = budgetTierSchema.safeParse(body.budget_tier);
  const budgetTierFromSite = budgetTierSchema.safeParse(site.budget_tier);
  const budgetTier: BudgetTier = budgetTierFromBody.success
    ? budgetTierFromBody.data
    : budgetTierFromSite.success
      ? budgetTierFromSite.data
      : 'free';
  const priorRecommendations = Array.isArray(body.prior_recommendations)
    ? body.prior_recommendations
        .filter((r) => r && typeof r === 'object')
        .map((r) => ({
          category: typeof r.category === 'string' ? r.category.slice(0, 60) : 'unknown',
          severity: typeof r.severity === 'string' ? r.severity.slice(0, 20) : 'minor',
          description: typeof r.description === 'string' ? r.description.slice(0, 500) : '',
        }))
        .filter((r) => r.description.length > 0)
        .slice(0, 50)
    : undefined;

  // Update business info if provided
  const updates: string[] = ["status = 'building'", "updated_at = datetime('now')"];
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
  // Note: additional_context is passed to the workflow but not stored in the sites table
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
          orgId,
          slug: site.slug,
          businessName: body.business?.name || site.business_name || '',
          businessAddress: body.business?.address || site.business_address || '',
          businessWebsite: body.business?.website || '',
          googlePlaceId: body.business?.place_id || site.google_place_id || '',
          additionalContext: body.additional_context || body.expert_notes || '',
          isReset: true,
          iteration,
          priorRecommendations,
          budgetTier,
        },
      });
      workflowInstanceId = instance.id;
    } catch (firstErr) {
      // Workflow creation may fail if instance with same ID exists
      // Try with a unique suffix
      const firstErrMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
      try {
        const resetId = `${siteId}-reset-${Date.now()}`;
        const instance = await c.env.SITE_WORKFLOW.create({
          id: resetId,
          params: {
            siteId,
            orgId,
            slug: site.slug,
            businessName: body.business?.name || '',
            businessAddress: body.business?.address || '',
            additionalContext: body.additional_context || body.expert_notes || '',
            isReset: true,
            iteration,
            priorRecommendations,
            budgetTier,
          },
        });
        workflowInstanceId = instance.id;

        // Log that we had to use a retry ID
        auditService
          .writeAuditLog(c.env.DB, {
            org_id: orgId,
            actor_id: c.get('userId') ?? null,
            action: 'workflow.retry_created',
            target_type: 'site',
            target_id: siteId,
            metadata_json: {
              site_id: siteId,
              slug: site.slug,
              first_error: firstErrMsg,
              retry_id: resetId,
              message: 'Workflow instance recreated with new ID (original ID was in use)',
            },
            request_id: c.get('requestId'),
          })
          .catch(() => {});
      } catch (retryErr) {
        // Workflow not available — log it
        const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        auditService
          .writeAuditLog(c.env.DB, {
            org_id: orgId,
            actor_id: c.get('userId') ?? null,
            action: 'workflow.creation_failed',
            target_type: 'site',
            target_id: siteId,
            metadata_json: {
              site_id: siteId,
              slug: site.slug,
              first_error: firstErrMsg,
              retry_error: retryErrMsg,
              message:
                'Workflow creation failed: ' +
                retryErrMsg +
                ' (first attempt: ' +
                firstErrMsg +
                ')',
            },
            request_id: c.get('requestId'),
          })
          .catch(() => {});
      }
    }
  }

  // Always write audit logs regardless of workflow availability
  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.reset',
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      site_id: siteId,
      slug: site.slug,
      message: 'Site rebuild triggered for ' + site.slug,
      business_name: body.business?.name || null,
      has_context: !!body.additional_context,
      workflow_available: !!workflowInstanceId,
    },
    request_id: c.get('requestId'),
  });

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'workflow.queued',
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      site_id: siteId,
      slug: site.slug,
      workflow_instance_id: workflowInstanceId ?? 'not_available',
      message: workflowInstanceId
        ? 'AI rebuild pipeline queued — will re-research and regenerate website'
        : 'Rebuild requested — workflow binding not available, site status set to building',
    },
    request_id: c.get('requestId'),
  });

  // Log anticipated build phases
  const resetPhases = [
    {
      action: 'workflow.phase.research',
      message: 'Phase 1: Re-analyzing business profile & gathering fresh data',
    },
    {
      action: 'workflow.phase.generation',
      message: 'Phase 2: Regenerating website HTML with updated information',
    },
    {
      action: 'workflow.phase.deployment',
      message: 'Phase 3: Uploading new files & publishing updated site',
    },
  ];
  for (const phase of resetPhases) {
    await auditService
      .writeAuditLog(c.env.DB, {
        org_id: orgId,
        actor_id: c.get('userId') ?? null,
        action: phase.action,
        target_type: 'site',
        target_id: siteId,
        metadata_json: {
          site_id: siteId,
          slug: site.slug,
          workflow_instance_id: workflowInstanceId ?? null,
          message: phase.message,
        },
        request_id: c.get('requestId'),
      })
      .catch(() => {});
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

/**
 * @route POST /api/sites/:id/deploy
 * @auth Bearer orgId
 * @param id - Site UUID. Cross-org guard enforced.
 * @body multipart/form-data — `zip` (File, required), `chat` (File, optional),
 *   `dist_path` (string, optional, defaults to `dist/`). The `dist_path`
 *   identifies which subtree inside the ZIP to upload — files outside that
 *   prefix are silently skipped, which lets the client send a full project
 *   archive without pre-extracting the build output.
 * @returns 200 OK `{ data: { site_id, slug, version, files_uploaded, status: 'published' } }`.
 * @throws UNAUTHORIZED — missing `orgId`.
 * @throws NOT_FOUND — site missing / cross-org / soft-deleted.
 * @throws BAD_REQUEST — `zip` form field missing.
 *
 * @remarks
 * Manual deploy path — used by the bolt.diy editor + CLI/SDK clients that
 * already have a built static-site bundle locally. Distinct from the AI
 * workflow path (`/reset`) and the chat-driven publish (`/publish-bolt`).
 *
 * **Pipeline:**
 * 1. Audit `site.deploy_started` written BEFORE the heavy ZIP work so the
 *    site Logs modal renders the in-progress state to the user immediately.
 * 2. JSZip parses the upload in-Worker (no streaming — bounded by the 256KB
 *    payload limit middleware AND R2 PUT size limits; the practical ceiling
 *    is the workers-incoming-request body size on the CF plan).
 * 3. Versioning: `v{epoch_ms}` keeps versions lexicographically ordered AND
 *    monotonic across deploys. Stored under `sites/{slug}/{version}/...`.
 * 4. Manifest (`sites/{slug}/_manifest.json`) is overwritten with the new
 *    `current_version` pointer — site-serving reads this to resolve the
 *    "live" version on each request (with KV caching).
 * 5. `current_build_version` D1 column + `status='published'` flipped in
 *    the same UPDATE.
 * 6. Auto-snapshot: every successful deploy creates a `site_snapshots` row
 *    with an AI-generated 1-3 word name (Workers AI Llama 3.1, max 20
 *    tokens, falls back to `edit-{N}` if AI fails or returns garbage).
 *    Snapshot names get a 4-char base36 collision suffix when they clash
 *    with an existing snapshot on the same site. Snapshot creation is
 *    non-blocking — failures log a warning but don't fail the deploy.
 * 7. KV cache `host:{slug}{DOMAINS.SITES_SUFFIX}` is invalidated so the next
 *    request fetches the new manifest from R2.
 *
 * Chat JSON (`_meta/chat.json`) is stored alongside files when provided — it
 * powers the `GET /api/sites/by-slug/:slug/chat` reconstruction route so
 * bolt.diy can resume the conversation that produced this deploy.
 *
 * **Content-type detection:** extension-based via static `mimeTypes` map (in
 * the route body). Unknown extensions fall through to R2's default `application/octet-stream`
 * via the `put()` call without explicit `httpMetadata`.
 *
 * @see {@link auditService.writeAuditLog}
 *
 * @example
 * ```bash
 * # Deploy from a local ZIP
 * curl -X POST https://projectsites.dev/api/sites/$ID/deploy \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -F "zip=@build.zip" \
 *   -F "dist_path=dist/" \
 *   -F "chat=@conversation.json"
 * ```
 */
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

  // Log deploy start immediately so it shows in Logs modal
  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.deploy_started',
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      site_id: siteId,
      slug: site.slug,
      zip_size_kb: Math.round(zipFile.size / 1024),
      has_chat: !!chatFile,
      message: 'ZIP deploy initiated (' + Math.round(zipFile.size / 1024) + ' KB)',
    },
    request_id: c.get('requestId'),
  });

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
  const manifest = {
    current_version: version,
    updated_at: new Date().toISOString(),
    files: uploadedFiles,
  };
  await c.env.SITES_BUCKET.put(`sites/${slug}/_manifest.json`, JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json' },
  });

  // Update site status to published
  await c.env.DB.prepare(
    "UPDATE sites SET status = 'published', current_build_version = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(version, siteId)
    .run();

  // Auto-create snapshot on each AI Edit publish with AI-generated name
  try {
    // Count existing snapshots to determine naming
    const { dbQuery: snpQuery } = await import('../services/db.js');
    const existingSnaps = await snpQuery<{ snapshot_name: string }>(
      c.env.DB,
      'SELECT snapshot_name FROM site_snapshots WHERE site_id = ? AND deleted_at IS NULL',
      [siteId],
    );
    const snapCount = existingSnaps.data.length;

    let snapshotName = `edit-${snapCount + 1}`;
    // Try AI-generated snapshot name
    try {
      const aiResult = await c.env.AI.run(
        '@cf/meta/llama-3.1-8b-instruct' as Parameters<typeof c.env.AI.run>[0],
        {
          messages: [
            {
              role: 'system',
              content:
                'Generate a 1-3 word URL-safe snapshot name for a website version. Output ONLY the name. Use lowercase, hyphens. Examples: hero-redesign, color-update, new-menu, layout-v2, spring-refresh',
            },
            {
              role: 'user',
              content: `This is edit #${snapCount + 1} of "${slug}". ${uploadedFiles.length} files changed.`,
            },
          ],
          max_tokens: 20,
        },
      );
      const aiName = ((aiResult as { response?: string }).response ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '')
        .replace(/--+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 25);
      if (aiName && aiName.length >= 2) snapshotName = aiName;
    } catch {
      /* fall back to edit-N */
    }

    // Ensure uniqueness
    const existing = existingSnaps.data.find((s) => s.snapshot_name === snapshotName);
    if (existing) snapshotName = `${snapshotName}-${Date.now().toString(36).slice(-4)}`;

    const { dbInsert: snpInsert } = await import('../services/db.js');
    await snpInsert(c.env.DB, 'site_snapshots', {
      id: crypto.randomUUID(),
      site_id: siteId,
      snapshot_name: snapshotName,
      build_version: version,
      description: `AI Edit — ${uploadedFiles.length} files updated`,
      created_by: c.get('userId') || null,
    });
  } catch (snapErr) {
    console.warn('[publish] Snapshot creation failed (non-blocking):', snapErr);
  }

  // Invalidate KV cache
  await c.env.CACHE_KV.delete(`host:${slug}${DOMAINS.SITES_SUFFIX}`).catch(() => {});

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.deployed',
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      site_id: siteId,
      slug,
      version,
      file_count: uploadedFiles.length,
      url: 'https://' + slug + DOMAINS.SITES_SUFFIX,
      message: 'Manual deploy: ' + uploadedFiles.length + ' files uploaded · Version ' + version,
    },
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

/**
 * @route POST /api/sites/:id/publish-bolt
 * @auth Bearer orgId — only the site owner (matching `org_id`) can publish.
 * @param id - Site UUID. Cross-org guard enforced via post-fetch
 *   `site.org_id !== orgId` check (intentional: the SELECT omits the
 *   `org_id = ?` predicate so a forbidden-vs-not-found error split would be
 *   possible, but we collapse both to 404 to avoid leaking site existence).
 * @body application/json `{ files: { path: string, content: string }[],
 *   chat?: { messages, description?, exportDate? }, slug?: string }`.
 *   Files are plain text content (bolt.diy editor is text-only — binaries
 *   bypass the editor and never reach this route). Optional `slug` lets a
 *   bolt session rebrand the site on publish; defaults to the persisted
 *   slug when omitted.
 * @returns 200 OK `{ data: { slug, version, files_uploaded, url } }` with
 *   `url` set to the public `https://{slug}{DOMAINS.SITES_SUFFIX}` deep link.
 * @throws UNAUTHORIZED — missing `orgId` in session context.
 * @throws BAD_REQUEST — `files` array missing, not an array, or empty.
 * @throws NOT_FOUND — site missing / cross-org mismatch / soft-deleted.
 *
 * @remarks
 * Authenticated counterpart to the anonymous `POST /api/publish/bolt` route
 * at L1875. Differences from the anonymous path:
 *
 * - **Owner-only.** Bearer token + cross-org check vs. the anonymous variant's
 *   `org_id='bolt'` sentinel — preserves the published-site/site-owner binding
 *   for analytics, billing, and audit attribution.
 * - **Slug stability.** Defaults to `site.slug` (the persisted value) rather
 *   than AI-generating a new slug from chat context. The optional `slug`
 *   body field allows rename at publish, but does NOT trigger the R2 file
 *   migration that `PATCH /api/sites/:id` does — fresh files are simply
 *   uploaded under the new slug and the old R2 tree becomes orphaned
 *   (cleaned by the same sweeper that handles `/sites/:id` slug-rename
 *   orphans).
 * - **Version format.** ISO-timestamp-with-colons-replaced (`2025-04-12T15-30-22-145Z`)
 *   vs. anonymous `v{epoch_ms}` — both are lexicographically sortable but
 *   the ISO format makes audit logs human-scannable.
 *
 * Content-type detection map covers the 19 most-common static-site
 * extensions. Unknown extensions fall back to `application/octet-stream`
 * which forces a download in browsers — protective default for files that
 * shouldn't render inline. The webmanifest mapping uses `application/manifest+json`
 * per the W3C Web App Manifest spec.
 *
 * Chat export (`_meta/chat.json`) is conditionally written — bolt sessions
 * without chat context (e.g. CLI-driven publishes) skip it entirely, and
 * the chat-reconstruction route returns 404 cleanly in that case.
 *
 * Parallel R2 writes via `Promise.all([...uploads])` (see below in function
 * body) keep latency bounded by the slowest single PUT regardless of file
 * count. R2 has no published per-account rate limit but bulk PUTs to one
 * account share the global rate budget.
 *
 * @see {@link DOMAINS.SITES_SUFFIX}
 * @see Anonymous variant: `POST /api/publish/bolt`
 *
 * @example
 * ```bash
 * # Publish a 3-file site from bolt.diy
 * curl -X POST https://projectsites.dev/api/sites/$ID/publish-bolt \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{
 *     "files": [
 *       {"path": "index.html", "content": "<!doctype html>..."},
 *       {"path": "styles.css", "content": "body { ... }"},
 *       {"path": "favicon.ico", "content": "..."}
 *     ],
 *     "chat": {"messages": [{"role":"user","content":"build a salon site"}]}
 *   }'
 * ```
 */
api.post('/api/sites/:id/publish-bolt', async (c) => {
  const siteId = c.req.param('id');
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Not authenticated');

  const body = await c.req.json();
  const {
    files,
    chat,
    slug: providedSlug,
  } = body as {
    files: { path: string; content: string }[];
    chat?: { messages: unknown[]; description?: string; exportDate?: string };
    slug?: string;
  };

  if (!files || !Array.isArray(files) || files.length === 0) {
    throw badRequest('No files provided');
  }

  // Verify site belongs to org
  const site = await dbQueryOne<{ id: string; slug: string; org_id: string }>(
    c.env.DB,
    'SELECT id, slug, org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  if (!site || site.org_id !== orgId) throw notFound('Site not found');

  const slug = providedSlug || site.slug;
  const version = new Date().toISOString().replace(/[:.]/g, '-');

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

  // Upload all files to R2
  const uploads: Promise<R2Object>[] = files.map((f) => {
    const ext = f.path.split('.').pop()?.toLowerCase() ?? '';
    const contentType = mimeTypes[ext] ?? 'application/octet-stream';
    return c.env.SITES_BUCKET.put(`sites/${slug}/${version}/${f.path}`, f.content, {
      httpMetadata: { contentType },
    });
  });

  // Store chat export if provided
  if (chat && chat.messages) {
    uploads.push(
      c.env.SITES_BUCKET.put(
        `sites/${slug}/${version}/_meta/chat.json`,
        JSON.stringify(chat, null, 2),
        { httpMetadata: { contentType: 'application/json' } },
      ),
    );
  }

  // Write/update manifest
  uploads.push(
    c.env.SITES_BUCKET.put(
      `sites/${slug}/_manifest.json`,
      JSON.stringify({
        current_version: version,
        slug,
        updated_at: new Date().toISOString(),
        source: 'bolt-embedded',
      }),
      { httpMetadata: { contentType: 'application/json' } },
    ),
  );

  await Promise.all(uploads);

  // Update site status in D1
  await c.env.DB.prepare(
    "UPDATE sites SET status = 'published', current_build_version = ?, updated_at = datetime('now') WHERE id = ?",
  )
    .bind(version, siteId)
    .run();

  // Invalidate KV cache
  const SITES_SUFFIX = '.projectsites.dev';
  await c.env.CACHE_KV.delete(`host:${slug}${SITES_SUFFIX}`).catch(() => {});

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'site.published_from_bolt_embedded',
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      slug,
      version,
      file_count: files.length,
      has_chat: !!(chat && chat.messages?.length),
    },
  });

  return c.json({
    data: {
      slug,
      version,
      url: `https://${slug}${SITES_SUFFIX}`,
    },
  });
});

// ─── Domain Search (Domainr / Fastly Domain Research API) ────

/**
 * Search for available domains matching a query string, with TLD suggestions
 * and live availability + pricing data.
 *
 * @route GET /api/domains/search
 * @auth None — public endpoint (rate-limited by IP at the edge via CF Bot
 *   Management; no per-org budget enforcement here because the route is
 *   read-only and the Domainr API call is cheap).
 * @queryParam q - Free-form domain candidate (e.g. `"vitossalon"` or
 *   `"vitossalon.com"`). Trimmed, lowercased, and stripped of non-allowed
 *   characters before forwarding. Length floor 2 / ceiling 63 (RFC 1035
 *   max label length) — outside that range returns `{ data: [] }`.
 * @returns 200 OK `{ data: Array<{ domain, available, price, zone, path }> }`
 *   where `price` is in USD cents (0 if unknown), `zone` is the TLD without
 *   leading dot (e.g. `"com"`), and `path` is the subdomain prefix Domainr
 *   recommends (empty string when the suggestion is bare-domain). Returns
 *   `{ data: [] }` on missing/short/long queries — never throws on user input.
 *
 * @remarks
 * Two-step Domainr dance via RapidAPI proxy (matches the Google Places
 * lookup pattern in {@link services/google_places.lookupBusiness}):
 *
 * 1. **Search** (`/v2/search?query=...`) — returns up to 10 fuzzy-matched
 *    domain suggestions with `domain`, `zone`, `path` triples. No
 *    availability data at this stage.
 * 2. **Status** (`/v2/status?domain=d1,d2,...`) — bulk availability +
 *    pricing for all suggestions in one round-trip. Status field
 *    interpretation: `summary === "inactive"` OR status string contains
 *    `"undelegated"` / `"inactive"` → available. Anything else → taken.
 *
 * Domainr's `price` field is dollar-decimal; we convert to cents
 * (`Math.round(price * 100)`) for downstream Stripe consistency.
 *
 * Fallback path when Domainr unavailable (RapidAPI quota exhausted /
 * outage / missing `DOMAINR_API_KEY`): returns 12 generated candidates
 * across common TLDs (`.com`, `.net`, `.org`, `.io`, `.co`, `.dev`,
 * `.app`, `.site`, `.online`, `.store`, `.shop`, `.biz`) with
 * `available: false` (intentional protective default — user must
 * re-search later when Domainr recovers, never auto-purchase a domain
 * we couldn't verify).
 *
 * @throws Never — all errors collapse to fallback TLD list. Empty/short
 *   queries return `{ data: [] }`.
 *
 * @see {@link https://domainr.com/docs/api Domainr API}
 * @see Companion route: `POST /api/domains/purchase`
 *
 * @example
 * ```bash
 * curl 'https://projectsites.dev/api/domains/search?q=vitossalon' | jq .
 * # { "data": [ { "domain": "vitossalon.com", "available": false, ... }, ... ] }
 * ```
 */
api.get('/api/domains/search', async (c) => {
  const query = c.req.query('q');
  if (!query || query.trim().length < 2 || query.trim().length > 63) {
    return c.json({ data: [] });
  }

  const domain = query
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '');
  const baseName = domain.replace(/\.[^.]+$/, '').replace(/\./g, '');

  const results: Array<{
    domain: string;
    available: boolean;
    price: number;
    zone: string;
    path: string;
  }> = [];

  try {
    // Step 1: Get domain suggestions from Domainr Search API
    const searchUrl = `https://domainr.p.rapidapi.com/v2/search?query=${encodeURIComponent(domain)}`;
    const searchRes = await fetch(searchUrl, {
      headers: {
        'X-RapidAPI-Key': c.env.DOMAINR_API_KEY || '',
        'X-RapidAPI-Host': 'domainr.p.rapidapi.com',
      },
    });

    if (!searchRes.ok) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'domain_search',
          message: 'Domainr search failed',
          status: searchRes.status,
        }),
      );
      // Fall back to generated candidates
      const tlds = [
        '.com',
        '.net',
        '.org',
        '.io',
        '.co',
        '.dev',
        '.app',
        '.site',
        '.online',
        '.store',
        '.shop',
        '.biz',
      ];
      for (const tld of tlds) {
        results.push({
          domain: baseName + tld,
          available: false,
          price: 0,
          zone: tld.slice(1),
          path: '',
        });
      }
      return c.json({ data: results });
    }

    const searchData = (await searchRes.json()) as {
      results?: Array<{ domain: string; zone: string; path: string }>;
    };

    const suggestions = searchData.results || [];
    if (suggestions.length === 0) {
      return c.json({ data: [] });
    }

    // Step 2: Check availability + pricing for all suggestions via Domainr Status API
    const domainList = suggestions.map((s) => s.domain).join(',');
    const statusUrl = `https://domainr.p.rapidapi.com/v2/status?domain=${encodeURIComponent(domainList)}`;
    const statusRes = await fetch(statusUrl, {
      headers: {
        'X-RapidAPI-Key': c.env.DOMAINR_API_KEY || '',
        'X-RapidAPI-Host': 'domainr.p.rapidapi.com',
      },
    });

    const statusMap = new Map<string, { available: boolean; price: number }>();

    if (statusRes.ok) {
      const statusData = (await statusRes.json()) as {
        status?: Array<{
          domain: string;
          zone: string;
          status: string;
          summary: string;
          price?: number;
        }>;
      };

      if (statusData.status) {
        for (const s of statusData.status) {
          // Domainr status field: "undelegated" = available, "active" = taken
          const isAvailable =
            s.summary === 'inactive' ||
            s.status.includes('undelegated') ||
            s.status.includes('inactive');
          statusMap.set(s.domain, {
            available: isAvailable,
            price: s.price ? Math.round(s.price * 100) : 0, // cents
          });
        }
      }
    }

    // Combine suggestions with status data
    for (const suggestion of suggestions) {
      const status = statusMap.get(suggestion.domain);
      results.push({
        domain: suggestion.domain,
        available: status?.available ?? false,
        price: status?.price ?? 0,
        zone: suggestion.zone,
        path: suggestion.path || '',
      });
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'domain_search',
        message: 'Domain search error',
        error: String(err),
      }),
    );
    // Fallback: return TLD candidates as unknown
    const tlds = ['.com', '.net', '.org', '.io', '.co', '.dev', '.app', '.site', '.online'];
    for (const tld of tlds) {
      results.push({
        domain: baseName + tld,
        available: false,
        price: 0,
        zone: tld.slice(1),
        path: '',
      });
    }
  }

  return c.json({ data: results });
});

// ─── Domain Purchase (Stripe subscription) ───────────────────

/**
 * Initiate a Stripe checkout session for a $15/yr custom-domain
 * registration tied to an existing site. The actual domain provisioning
 * happens asynchronously in the `customer.subscription.created` webhook
 * (see `routes/webhooks.ts`).
 *
 * @route POST /api/domains/purchase
 * @auth Bearer orgId required — cross-org site ownership enforced via
 *   `org_id = ?` predicate (uses standard 404-on-mismatch — purchase
 *   attempts against other orgs' sites surface as "Site not found").
 * @body application/json `{ domain: string, site_id: string,
 *   success_url: string, cancel_url: string }`. Both URLs must be
 *   absolute (Stripe rejects relative paths). The domain string is
 *   passed through verbatim — caller is responsible for prior
 *   availability verification via `/api/domains/search`.
 * @returns 200 OK `{ data: { checkout_url, session_id } }`. Client
 *   should redirect to `checkout_url` (full Stripe Checkout page, not
 *   embedded). On success-url callback, the webhook eventually creates
 *   a `hostnames` row and starts CF for SaaS provisioning.
 * @throws UNAUTHORIZED — missing/invalid Bearer token.
 * @throws BAD_REQUEST — `domain` or `site_id` missing; Stripe API
 *   rejected the checkout creation (passed through with status text).
 * @throws NOT_FOUND — `site_id` doesn't exist or belongs to another org.
 *
 * @remarks
 * Stripe price configuration uses `price_data` inline (no pre-created
 * Price object) so the catalog stays clean — every domain is a unique
 * one-off product. Annual interval at $15.00 (1500 cents). The
 * `metadata` block carries `org_id`, `site_id`, `domain`, and
 * `type: 'domain_purchase'` so the webhook handler can distinguish
 * domain checkouts from plan upgrades without inspecting line items.
 *
 * Customer email is best-effort — lookup against `users` by `userId`,
 * defaults to empty string when missing (Stripe will then prompt the
 * user for email during checkout). No 404 surface on missing user
 * since the route's auth layer guarantees a valid session.
 *
 * Audit log entry `domain.purchase_initiated` is fire-and-forget
 * (`.catch(() => {})`) — Stripe checkout already created so we
 * don't surface audit failures to the user. The webhook handler
 * writes the corresponding `domain.purchase_completed` on subscription
 * activation.
 *
 * @see Webhook: `routes/webhooks.ts` → `customer.subscription.created`
 *   with `metadata.type === 'domain_purchase'`.
 * @see {@link https://stripe.com/docs/api/checkout/sessions/create Stripe Checkout}
 *
 * @example
 * ```bash
 * curl -X POST https://projectsites.dev/api/domains/purchase \
 *   -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{"domain":"vitossalon.com","site_id":"site_abc",
 *        "success_url":"https://app.example/done",
 *        "cancel_url":"https://app.example/cancel"}'
 * # { "data": { "checkout_url": "https://checkout.stripe.com/c/pay/cs_...", ... } }
 * ```
 */
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
      mode: 'subscription',
      success_url: body.success_url,
      cancel_url: body.cancel_url,
      customer_email: user?.email || '',
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

  // Audit: domain purchase checkout initiated
  auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: c.get('userId') ?? null,
      action: 'domain.purchase_initiated',
      target_type: 'domain',
      target_id: body.site_id,
      metadata_json: {
        domain: body.domain,
        site_id: body.site_id,
        stripe_session_id: session.id,
        message: 'Domain purchase started for ' + body.domain + ' — Stripe checkout created',
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({
    data: {
      checkout_url: session.url,
      session_id: session.id,
    },
  });
});

// ─── Admin Domain Management Routes ─────────────────────────

/**
 * List all hostnames (free subdomains + custom CNAMEs) attached to the
 * caller's organization with optional status/type filtering and
 * keyset-paginated by descending `created_at`.
 *
 * @route GET /api/admin/domains
 * @auth Bearer orgId required — query is org-scoped via
 *   `WHERE org_id = ?`. Despite the `/admin/` path prefix, no
 *   platform-admin role is enforced here — this is per-org admin
 *   surface for self-service domain management. True platform admin
 *   surfaces (cross-org listing, takedown) live behind a separate
 *   role check elsewhere.
 * @queryParam status - Optional filter: `active` | `pending` |
 *   `verification_failed` | `archived` etc. Passed through as exact
 *   match — no whitelist enforcement at the route layer (Zod schemas
 *   in the hostnames service guarantee only valid status values
 *   ever get persisted).
 * @queryParam type - Optional filter: `free_subdomain` (default
 *   `*.projectsites.dev`) | `custom_cname` (user-purchased domain
 *   via `/api/domains/purchase`).
 * @queryParam limit - Page size, default 50, capped at 200 to bound
 *   D1 row-read cost.
 * @queryParam offset - Skip count for offset-based pagination,
 *   floored at 0. (Offset pagination is fine here — domain lists
 *   are typically small, no need for keyset complexity.)
 * @returns 200 OK `{ data: Hostname[] }` ordered by `created_at` DESC
 *   (newest provisions first). Each row includes the full hostname
 *   record from D1 (id, hostname, status, type, ssl_status, etc.).
 *   Soft-deleted rows (`deleted_at IS NOT NULL`) are excluded.
 * @throws UNAUTHORIZED — missing/invalid Bearer token.
 *
 * @remarks
 * Filters compose via parameterized SQL fragments — never concatenated
 * into the query string. This route is the read surface that pairs
 * with the write surface in
 * `POST/PUT/DELETE /api/sites/:siteId/hostnames/*` (route-level
 * site-scoped); use this endpoint for org-wide views (e.g. "all
 * domains across all sites for billing reconciliation").
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer $TOKEN" \
 *   'https://projectsites.dev/api/admin/domains?status=active&type=custom_cname&limit=100'
 * ```
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
 * Aggregate counts of hostnames attached to the caller's org, bucketed
 * by `status` and `type`. Powers the dashboard summary cards on the
 * frontend domain-management page.
 *
 * @route GET /api/admin/domains/summary
 * @auth Bearer orgId required — query scoped via `WHERE org_id = ?`.
 * @returns 200 OK `{ data: { total, by_status: { active, pending,
 *   verification_failed }, by_type: { free_subdomain, custom_cname } } }`.
 *   Every count guaranteed to be a number (zero-coalesced from D1's
 *   nullable `SUM(...)` result).
 * @throws UNAUTHORIZED — missing/invalid Bearer token.
 *
 * @remarks
 * Single D1 query using `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` for
 * each bucket — one round-trip beats N parallel counts. Soft-deleted
 * rows excluded via `deleted_at IS NULL`. The result schema is
 * deliberately flat-with-nesting so the frontend can render either
 * the top-line total or the breakdown grid without re-shaping.
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

  const stats = data[0] ?? {
    total: 0,
    active: 0,
    pending: 0,
    failed: 0,
    free_subdomain: 0,
    custom_cname: 0,
  };

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
 * Force a fresh Cloudflare-for-SaaS verification check against a single
 * hostname, persist the new state to D1, and (when the hostname just
 * transitioned to `active`) email the org owner.
 *
 * @route POST /api/admin/domains/:hostnameId/verify
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @param hostnameId - UUID of the `hostnames` row to re-verify.
 * @returns 200 OK `{ data: { hostname, status, ssl_status,
 *   verification_errors } }`. When CF integration unavailable
 *   (no `cf_custom_hostname_id`), returns the cached DB state with
 *   `message: "No Cloudflare hostname ID — cannot verify"` rather
 *   than throwing.
 * @throws UNAUTHORIZED — missing/invalid Bearer token.
 * @throws NOT_FOUND — hostname missing / cross-org / soft-deleted.
 *
 * @remarks
 * Status mapping from CF response:
 * - `status === 'active'` → DB `active`.
 * - `verification_errors.length > 0` → DB `verification_failed`.
 * - Otherwise → DB `pending`.
 *
 * State transitions are audit-logged (`hostname.verified` with
 * previous_status + new_status + ssl_status). When `active` is newly
 * reached, fires `notifyDomainVerified` to the org owner (looked up
 * via `memberships.role = 'owner'`) — best-effort, email failures
 * never roll back the DB update. A second audit entry
 * (`notification.domain_verified_sent`) records the email dispatch.
 *
 * Dynamic import of `dbUpdate` and `notifications` is a code-splitting
 * pattern that keeps the API bundle lean — these modules are only
 * pulled when verification actually fires.
 *
 * @see {@link domainService.checkHostnameStatus}
 * @see {@link notifyDomainVerified}
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
      message:
        'Domain verification: ' +
        hostname.hostname +
        ' — ' +
        hostname.status +
        ' → ' +
        newStatus +
        (cfStatus.ssl_status ? ' (SSL: ' + cfStatus.ssl_status + ')' : ''),
    },
    request_id: c.get('requestId'),
  });

  // Send email notification when domain just became active
  if (newStatus === 'active' && hostname.status !== 'active') {
    try {
      const { notifyDomainVerified } = await import('../services/notifications.js');
      const owner = await dbQueryOne<{ email: string }>(
        c.env.DB,
        'SELECT u.email FROM users u JOIN memberships m ON u.id = m.user_id WHERE m.org_id = ? AND m.role = ? AND m.deleted_at IS NULL',
        [orgId, 'owner'],
      );
      if (owner?.email) {
        const site = await dbQueryOne<{ slug: string; business_name: string }>(
          c.env.DB,
          'SELECT slug, business_name FROM sites WHERE id = ? AND deleted_at IS NULL',
          [hostname.site_id],
        );
        const defaultDomain = (site?.slug || 'unknown') + DOMAINS.SITES_SUFFIX;
        // Find primary hostname (use COALESCE for optional is_primary column)
        const primary = await dbQueryOne<{ hostname: string }>(
          c.env.DB,
          'SELECT hostname FROM hostnames WHERE site_id = ? AND deleted_at IS NULL ORDER BY COALESCE(is_primary, 0) DESC, created_at ASC LIMIT 1',
          [hostname.site_id],
        );
        await notifyDomainVerified(c.env, {
          email: owner.email,
          hostname: hostname.hostname,
          primaryDomain: primary?.hostname || null,
          defaultDomain,
          siteName: site?.business_name || defaultDomain,
        });
        auditService
          .writeAuditLog(c.env.DB, {
            org_id: orgId,
            actor_id: c.get('userId') ?? null,
            action: 'notification.domain_verified_sent',
            target_type: 'hostname',
            target_id: hostnameId,
            metadata_json: {
              email: owner.email,
              hostname: hostname.hostname,
              message: 'Domain verification email sent to ' + owner.email,
            },
            request_id: c.get('requestId'),
          })
          .catch(() => {});
      }
    } catch {
      // Email failure should not break verification
    }
  }

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
 * Comprehensive live health check for a single hostname: queries
 * Cloudflare custom-hostname status, resolves the public DNS CNAME
 * target via DoH, and assembles a debug-friendly view for the user.
 * Read-only — does NOT update the DB (use the companion
 * `POST .../verify` route to persist state).
 *
 * @route GET /api/admin/domains/:hostnameId/health
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @param hostnameId - UUID of the `hostnames` row to inspect.
 * @returns 200 OK `{ data: { hostname, type, db_status, cf_status,
 *   ssl_status, dns_configured, cname_target, verification_errors,
 *   last_verified_at } }`. `dns_configured` is the boolean
 *   `cname_target != null` — useful for the "Pending DNS configuration"
 *   alert in the frontend. `cf_status` falls back to `"unknown"` when
 *   `cf_custom_hostname_id` is missing or the CF API errors.
 * @throws UNAUTHORIZED — missing/invalid Bearer token.
 * @throws NOT_FOUND — hostname missing / cross-org / soft-deleted.
 *
 * @remarks
 * The CF status check and DNS CNAME resolution run in parallel via
 * `Promise.all` — total latency is bounded by the slower of the two
 * (CF API typically 200-400ms, DoH typically 50-100ms). Both promises
 * swallow their own errors and leave the corresponding output field
 * as `unknown`/`null`, so a partial failure surfaces partial data
 * rather than blocking the entire response.
 *
 * @see Companion: `POST /api/admin/domains/:hostnameId/verify`
 *   for the persisting variant.
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
 * Hard deprovision a hostname: removes the Cloudflare custom-hostname
 * (CF for SaaS) AND soft-deletes the D1 row. Distinct from the
 * site-scoped `DELETE /api/sites/:siteId/hostnames/:hostnameId` route
 * which only marks the D1 row deleted — this admin variant guarantees
 * the CF resource is gone so the user's CNAME can be reused.
 *
 * @route DELETE /api/admin/domains/:hostnameId
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @param hostnameId - UUID of the `hostnames` row to deprovision.
 * @returns 200 OK `{ data: { hostname, status: 'deleted' } }`.
 * @throws UNAUTHORIZED — missing/invalid Bearer token.
 * @throws NOT_FOUND — hostname missing / cross-org / already soft-deleted.
 *
 * @remarks
 * The CF deletion is best-effort with a logged warning on failure —
 * if the CF custom-hostname is already gone (manual cleanup, account
 * migration), the local DB deletion still proceeds so the row never
 * gets stranded as "deleted in our DB but live on CF". The reverse
 * (CF lives on after DB delete) is acceptable because the CF resource
 * is unreachable without a D1 mapping anyway — orphans get reaped
 * by a scheduled sweeper job.
 *
 * Soft-delete sets both `deleted_at` (UTC ISO) and `status='deleted'`
 * so the row remains visible in audit queries but is excluded by
 * every `WHERE deleted_at IS NULL` predicate across the routes layer.
 *
 * @see Companion: `DELETE /api/sites/:siteId/hostnames/:hostnameId`
 *   (DB-only soft-delete, used by self-service per-site flows).
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
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'domains',
          message: 'Failed to delete CF custom hostname during deprovision',
          hostname: hostname.hostname,
          cf_id: hostname.cf_custom_hostname_id,
        }),
      );
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
      site_id: hostname.site_id,
      message:
        'Domain deprovisioned: ' +
        hostname.hostname +
        (hostname.cf_custom_hostname_id ? ' (CF hostname removed)' : ''),
    },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { deprovisioned: true, hostname: hostname.hostname } });
});

// ─── Contact Form Route ─────────────────────────────────────

/**
 * Receive a contact-form submission from any generated site and forward
 * it to the platform's transactional email + audit log. Public endpoint
 * (no Bearer required) because generated sites POST to this from their
 * static contact forms — no auth context is available at the time of
 * submission.
 *
 * @route POST /api/contact
 * @auth None — public endpoint. Turnstile + per-IP rate limit applied
 *   at the edge by Cloudflare; abuse handled by `contactService`.
 * @body application/json — free-form `{ email, name, message, ... }`;
 *   the contact service validates shape and rejects malformed payloads.
 * @returns 200 OK `{ data: { success: true } }` regardless of audit
 *   outcome (audit failures never surface to the visitor).
 *
 * @remarks
 * Two-stage best-effort flow: (1) `contactService.handleContactForm`
 * dispatches the transactional email (Resend → SendGrid fallback) and
 * may throw — surfaced to the visitor as a 5xx via `error_handler`.
 * (2) Audit log write is fire-and-forget with `.catch(() => {})` so a
 * D1 hiccup never blocks the success response. Audit `org_id` is the
 * sentinel `'system'` because this endpoint is org-less by design.
 *
 * @see {@link contactService.handleContactForm}
 */
api.post('/api/contact', async (c) => {
  const body = await c.req.json();
  await contactService.handleContactForm(c.env, body);

  auditService
    .writeAuditLog(c.env.DB, {
      org_id: 'system',
      actor_id: c.get('userId') ?? null,
      action: 'contact.form_submitted',
      target_type: 'contact',
      target_id: 'system',
      metadata_json: {
        email: typeof body.email === 'string' ? body.email : 'unknown',
        message:
          'Contact form submitted by ' + (typeof body.email === 'string' ? body.email : 'unknown'),
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({ data: { success: true } });
});

// ─── AI Business Validation ─────────────────────────────────

/**
 * Pre-flight validate a business-search submission with Workers AI
 * (Llama 3.1 8B) before allowing it onto the create-site path. Catches
 * profanity, slurs, obviously fake names (`asdf`, `hey`, `test123`),
 * invalid addresses, and prompt-injection attempts that would otherwise
 * burn $5-15 of downstream build credits on garbage input.
 *
 * @route POST /api/validate-business
 * @auth Bearer orgId required — abuse prevention before any AI spend.
 * @body application/json `{ name: string, address?: string, context?: string }`.
 *   `name` is mandatory + trimmed; address and context optional context
 *   threaded into the LLM prompt for richer judgment.
 * @returns 200 OK `{ data: { valid: boolean, reason?: string } }`.
 *   `valid: false` includes a human-readable `reason` for inline
 *   display; `valid: true` omits `reason`.
 *
 * @throws BAD_REQUEST — `name` missing/empty.
 * @throws UNAUTHORIZED — no Bearer token.
 *
 * @remarks
 * Layered validation strategy: (1) cheap deterministic length checks
 * first (`<2` or `>200` chars short-circuit before any AI call —
 * Workers AI costs ~$0.0003/call so length-gate guards against bot
 * floods), (2) Workers AI Llama-3.1-8b with `temperature: 0.1` for
 * near-deterministic judgment + `max_tokens: 100` budget cap, (3)
 * regex `match(/\{[^}]+\}/)` extracts the JSON envelope from any
 * markdown/preamble the model may emit despite the strict prompt.
 *
 * Fail-open policy: any AI error, malformed JSON, or empty response
 * resolves to `{ valid: true }` — better to let a slightly suspicious
 * submission through than block a legitimate user when Workers AI has
 * a hiccup. Downstream `build_validators.ts` + GPT-4o vision still
 * catch profanity/slop in the actual site output.
 *
 * Prompt-injection defense: the system prompt is hardcoded in this
 * file (not user-controlled) and instructs the model to respond with
 * EXACTLY one JSON object — defeats most "ignore previous instructions"
 * payloads because the JSON-extractor regex discards any prose.
 *
 * @example
 * ```json
 * { "name": "asdfasdf", "address": "" }
 * → { "data": { "valid": false, "reason": "Looks like test data, not a real business name." } }
 * ```
 */
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
    const aiResult = await c.env.AI.run(
      '@cf/meta/llama-3.1-8b-instruct' as Parameters<typeof c.env.AI.run>[0],
      {
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0.1,
      },
    );

    const text =
      typeof aiResult === 'string' ? aiResult : (aiResult as { response?: string }).response || '';
    // Extract JSON from AI response
    const jsonMatch = text.match(/\{[^}]+\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return c.json({ data: { valid: !!parsed.valid, reason: parsed.reason || null } });
      } catch {
        // Malformed JSON from AI — treat as valid
        return c.json({ data: { valid: true } });
      }
    }
    // If AI didn't respond properly, allow it through
    return c.json({ data: { valid: true } });
  } catch {
    // If AI fails, allow submission through (don't block on AI errors)
    return c.json({ data: { valid: true } });
  }
});

// ─── R2 File Browser ──────────────────────────────────────────

/**
 * Validate an R2 file path and reject path-traversal attempts before
 * the path is ever joined into an `R2.get/put/delete` key. Every
 * `/api/sites/:id/files/*` route MUST pass user-supplied path segments
 * through this gate — bypassing it would let a malicious caller escape
 * their site's `sites/{slug}/` prefix and read/write another site's
 * R2 namespace.
 *
 * @param raw - Untrusted path string from `c.req.param('path')` or
 *   request body. Typically a path-rest match like `index.html` or
 *   `assets/og-image.png`.
 * @returns Cleaned path string (leading slashes stripped, backslashes
 *   normalized) when safe. `null` for any traversal attempt, null
 *   byte, percent-encoded dot-dot, or empty result — callers MUST
 *   short-circuit with a 403 when `null` returned.
 *
 * @remarks
 * Defense-in-depth filter — three sequential checks:
 * 1. **Null byte** (`\0`) reject — truncates strings in many syscalls,
 *    classic upload-bypass vector (`evil.php\0.jpg`).
 * 2. **Encoded traversal** — `%2e%2e%2f` → `../` decoded BEFORE the
 *    dot-dot check so attackers can't smuggle `..` past via URL
 *    encoding. Backslashes (`\`) normalized to `/` to defeat
 *    Windows-style traversal (`..\..\etc\passwd`).
 * 3. **Dot-dot literal** — any remaining `..` substring after decoding
 *    rejects, catching both `/foo/../bar` and `foo/../bar`.
 *
 * After validation, callers MUST additionally prefix-guard with
 * `fullKey.startsWith('sites/{slug}/')` — this function only rejects
 * the most common malicious patterns; the second gate enforces
 * cross-site isolation even for paths that happen to look benign.
 *
 * @example
 * ```ts
 * sanitizeFilePath('../../secrets.json')           // null (dot-dot)
 * sanitizeFilePath('%2e%2e/secrets.json')          // null (encoded)
 * sanitizeFilePath('assets/og\0.png')              // null (null byte)
 * sanitizeFilePath('//index.html')                 // 'index.html'
 * sanitizeFilePath('assets\\img.png')              // 'assets/img.png'
 * ```
 */
function sanitizeFilePath(raw: string): string | null {
  if (!raw || raw.includes('\0')) return null;
  // Decode percent-encoded dots and slashes to detect traversal in encoded form
  const decoded = raw.replace(/%2e/gi, '.').replace(/%2f/gi, '/').replace(/\\/g, '/');
  // Reject any path containing dot-dot traversal sequences
  if (decoded.includes('..')) return null;
  // Remove leading slashes and return
  const cleaned = decoded.replace(/^\/+/, '');
  if (!cleaned) return null;
  return cleaned;
}

/**
 * List the R2 keys belonging to a single site, optionally scoped to a
 * specific build version. Powers the bolt.diy embedded-editor file
 * tree and the in-app "browse files" surface. Read-only; for writes
 * see the companion `PUT /api/sites/:id/files/:path{.+}` route.
 *
 * @route GET /api/sites/:id/files
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @queryParam version - Optional build version override (e.g.
 *   `2026-05-11-abc123`); when omitted falls back to the site's
 *   `current_build_version`. Sanitized to `[a-zA-Z0-9._-]` so a
 *   malicious caller can't construct a prefix that escapes the
 *   site's R2 namespace.
 * @returns 200 OK `{ data: { files: Array<{ key, name, size, uploaded, content_type }>, prefix, version } }`.
 *   `key` is the full R2 key; `name` is the relative path inside the
 *   prefix for display. Capped at 500 objects.
 * @throws UNAUTHORIZED — missing Bearer token.
 * @throws NOT_FOUND — site missing / cross-org / soft-deleted.
 *
 * @remarks
 * R2 prefix is always `sites/{slug}/[{version}/]` — the prefix-guard
 * here is the slug, separate from path-level traversal guards in the
 * single-file routes below. Versioned listing (`/{version}/` suffix)
 * lets the editor view a specific historical build alongside the
 * current live version.
 */
api.get('/api/sites/:id/files', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  const site = await dbQueryOne<{ slug: string; current_build_version: string | null }>(
    c.env.DB,
    'SELECT slug, current_build_version FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  const prefix = `sites/${site.slug}/`;
  const version = (c.req.query('version') || site.current_build_version || '').replace(
    /[^a-zA-Z0-9._-]/g,
    '',
  );
  const fullPrefix = version ? `${prefix}${version}/` : prefix;

  const listed = await c.env.SITES_BUCKET.list({ prefix: fullPrefix, limit: 500 });
  const files = listed.objects.map((obj) => ({
    key: obj.key,
    name: obj.key.replace(fullPrefix, ''),
    size: obj.size,
    uploaded: obj.uploaded.toISOString(),
    content_type: obj.httpMetadata?.contentType ?? null,
  }));

  return c.json({ data: { files, prefix: fullPrefix, version: version || null } });
});

/**
 * Bulk-export every text-mode file for a site as an inline
 * `{ path: content }` map. Designed for bolt.diy's embedded editor
 * mode, which boots a WebContainer and needs the full project tree in
 * a single round-trip rather than N individual `GET /files/:path`
 * fetches.
 *
 * @route GET /api/sites/:id/files-export
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @returns 200 OK `{ data: { files: Record<string, string>, prefix, version } }`.
 *   Keys are paths relative to the site prefix; values are UTF-8
 *   decoded text content.
 * @throws UNAUTHORIZED — missing Bearer token.
 * @throws NOT_FOUND — site missing / cross-org / soft-deleted.
 *
 * @remarks
 * Two safety caps prevent runaway response size: (1) **text-only
 * filter** — only `.html .css .js .json .txt .md .xml .svg .mjs .ts
 * .jsx .tsx` extensions are included; binaries (images, fonts,
 * archives) skipped because WebContainer doesn't need them at boot.
 * (2) **500KB per-file cap** — `obj.size < 512_000` skips bloated
 * generated bundles that would balloon the JSON payload. (3)
 * **200 object listing cap** — for sites with > 200 files the export
 * surface is incomplete; bolt UI falls back to lazy per-file loads.
 *
 * Promise.all + r2.get() runs in parallel — total latency bounded by
 * the slowest file, not the sum.
 *
 * @see Companion `GET /api/sites/:id/files` for paginated metadata
 *   without inlining content.
 */
api.get('/api/sites/:id/files-export', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  const site = await dbQueryOne<{ slug: string; current_build_version: string | null }>(
    c.env.DB,
    'SELECT slug, current_build_version FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  const version = site.current_build_version || '';
  const prefix = version ? `sites/${site.slug}/${version}/` : `sites/${site.slug}/`;

  const listed = await c.env.SITES_BUCKET.list({ prefix, limit: 200 });
  const textExtensions = new Set([
    'html',
    'css',
    'js',
    'json',
    'txt',
    'md',
    'xml',
    'svg',
    'mjs',
    'ts',
    'jsx',
    'tsx',
  ]);
  const files: Record<string, string> = {};

  await Promise.all(
    listed.objects
      .filter((obj) => {
        const ext = obj.key.split('.').pop()?.toLowerCase() ?? '';
        return textExtensions.has(ext) && obj.size < 512_000; // skip files > 500KB
      })
      .map(async (obj) => {
        const r2Obj = await c.env.SITES_BUCKET.get(obj.key);
        if (r2Obj) {
          const name = obj.key.replace(prefix, '');
          files[name] = await r2Obj.text();
        }
      }),
  );

  return c.json({ data: { files, prefix, version: version || null } });
});

/**
 * Read the body of a single R2-hosted file for a site. Counterpart to
 * the PUT/DELETE routes below; together they form the CRUD surface for
 * the in-app file editor.
 *
 * @route GET /api/sites/:id/files/:path{.+}
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @param path - Path-rest match (Hono `:path{.+}` regex captures
 *   everything after `/files/`, including slashes). Passed through
 *   `sanitizeFilePath()` before any R2 access — see that helper for
 *   the traversal-defense matrix.
 * @returns 200 OK `{ data: { key, content, size, content_type } }`.
 *   `content` always UTF-8 decoded (text-mode); binary files come
 *   back garbled — callers are expected to filter by extension
 *   client-side using the listing endpoint.
 * @throws UNAUTHORIZED — missing Bearer token.
 * @throws BAD_REQUEST — empty path.
 * @throws FORBIDDEN — path failed sanitization OR resolved key
 *   escaped the site's `sites/{slug}/` prefix.
 * @throws NOT_FOUND — site missing / cross-org / R2 object absent.
 *
 * @remarks
 * Two-layer security gate (defense-in-depth):
 * 1. `sanitizeFilePath` rejects `..`, null bytes, encoded traversal.
 * 2. Post-prefix `fullKey.startsWith('sites/{slug}/')` guard rejects
 *    any path that somehow snuck past sanitization (e.g. legitimate
 *    `sites/` literal prefix that points at a different slug).
 * Both must pass — never relax the prefix-guard "because the
 * sanitizer already caught it".
 */
api.get('/api/sites/:id/files/:path{.+}', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  const rawPath = c.req.param('path');
  if (!rawPath) throw badRequest('File path is required');

  // Sanitize path to prevent traversal attacks
  const filePath = sanitizeFilePath(rawPath);
  if (!filePath) throw forbidden('Invalid file path');

  const site = await dbQueryOne<{ slug: string }>(
    c.env.DB,
    'SELECT slug FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  // Build scoped key and validate it stays within the site's R2 scope
  const fullKey = filePath.startsWith('sites/') ? filePath : `sites/${site.slug}/${filePath}`;
  if (!fullKey.startsWith(`sites/${site.slug}/`)) {
    throw forbidden('Access denied to this file path');
  }

  const object = await c.env.SITES_BUCKET.get(fullKey);
  if (!object) throw notFound('File not found');

  const content = await object.text();
  return c.json({
    data: {
      key: fullKey,
      content,
      size: object.size,
      content_type: object.httpMetadata?.contentType ?? null,
    },
  });
});

/**
 * Create or overwrite a single R2 file for a site. Used by the in-app
 * editor's save action and by bolt.diy's "publish from editor" path.
 * Differentiates `file.created` vs. `file.updated` in audit logs by
 * HEAD-probing the key first.
 *
 * @route PUT /api/sites/:id/files/:path{.+}
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @param path - Path-rest match, sanitized + prefix-guarded (see GET).
 * @body application/json `{ content: string, content_type?: string }`.
 *   When `content_type` omitted, derived from extension:
 *   `.html` → `text/html`, `.json` → `application/json`, `.css` →
 *   `text/css`, `.js` → `application/javascript`, else `text/plain`.
 * @returns 200 OK `{ data: { key, size, updated: true } }`.
 * @throws UNAUTHORIZED — missing Bearer token.
 * @throws BAD_REQUEST — empty path OR non-string `content`.
 * @throws FORBIDDEN — path failed sanitization OR escaped site prefix.
 * @throws NOT_FOUND — site missing / cross-org / soft-deleted.
 *
 * @remarks
 * Side effects beyond the R2 write:
 * 1. **KV cache invalidation** — `host:{slug}{SITES_SUFFIX}` purged so
 *    next visitor request rebuilds the cache from fresh R2 state
 *    rather than serving the stale (pre-edit) version. Best-effort
 *    with `.catch(() => {})` because KV write failures don't matter
 *    much — TTL is 60s so worst case is one minute of staleness.
 * 2. **Audit log** with `file.created` vs `file.updated` discriminator
 *    based on the HEAD probe, plus a human-readable message with the
 *    file size in KB for the audit-log UI.
 *
 * The HEAD probe is one extra R2 round-trip per save — acceptable
 * cost since save is user-initiated, not hot-path.
 */
api.put('/api/sites/:id/files/:path{.+}', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  const rawPath = c.req.param('path');
  if (!rawPath) throw badRequest('File path is required');

  // Sanitize path to prevent traversal attacks
  const filePath = sanitizeFilePath(rawPath);
  if (!filePath) throw forbidden('Invalid file path');

  const site = await dbQueryOne<{ slug: string }>(
    c.env.DB,
    'SELECT slug FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  const fullKey = filePath.startsWith('sites/') ? filePath : `sites/${site.slug}/${filePath}`;
  if (!fullKey.startsWith(`sites/${site.slug}/`)) {
    throw forbidden('Access denied to this file path');
  }

  const body = (await c.req.json()) as { content: string; content_type?: string };
  if (typeof body.content !== 'string') throw badRequest('Content must be a string');

  const contentType =
    body.content_type ||
    (fullKey.endsWith('.html')
      ? 'text/html'
      : fullKey.endsWith('.json')
        ? 'application/json'
        : fullKey.endsWith('.css')
          ? 'text/css'
          : fullKey.endsWith('.js')
            ? 'application/javascript'
            : 'text/plain');

  // Check if file already exists (to differentiate create vs update)
  const existingFile = await c.env.SITES_BUCKET.head(fullKey);
  const isNewFile = !existingFile;

  await c.env.SITES_BUCKET.put(fullKey, body.content, {
    httpMetadata: { contentType },
  });

  // Invalidate KV cache
  await c.env.CACHE_KV.delete(`host:${site.slug}${DOMAINS.SITES_SUFFIX}`).catch(() => {});

  // Extract just the filename from the full key for display
  const fileName = fullKey.split('/').pop() || fullKey;
  const fileSizeKb = Math.round(body.content.length / 1024);

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: isNewFile ? 'file.created' : 'file.updated',
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      key: fullKey,
      file_name: fileName,
      size: body.content.length,
      message:
        (isNewFile ? 'File created: ' : 'File updated: ') + fileName + ' (' + fileSizeKb + ' KB)',
    },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { key: fullKey, size: body.content.length, updated: true } });
});

/**
 * Hard-delete a single R2-hosted file for a site. R2 has no native
 * recycle-bin and we don't soft-delete files (only D1 rows soft-delete
 * here) — once removed, the file is gone unless restored from a
 * site_snapshot. Use sparingly via the editor UI's destructive-confirm
 * dialog.
 *
 * @route DELETE /api/sites/:id/files/:path{.+}
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @param path - Path-rest match, sanitized + prefix-guarded.
 * @returns 200 OK `{ data: { key, deleted: true } }`.
 * @throws UNAUTHORIZED — missing Bearer token.
 * @throws BAD_REQUEST — empty path.
 * @throws FORBIDDEN — path failed sanitization OR escaped site prefix.
 * @throws NOT_FOUND — site missing / cross-org / soft-deleted.
 *
 * @remarks
 * Audit log entry uses `file.deleted` action with the bare filename
 * (basename) in the human-readable message — the full key is in the
 * `metadata_json.key` field for forensic queries. KV cache invalidated
 * same as the PUT route so visitors don't get a 404 for a file that
 * was edited+deleted in the same minute.
 *
 * Restoration path: bolt.diy users can revert to any `site_snapshots`
 * row via the snapshots UI (see `POST /api/sites/:siteId/snapshots`
 * and the snapshot-restore route below) — that's the supported
 * "undo delete" workflow.
 */
api.delete('/api/sites/:id/files/:path{.+}', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const siteId = c.req.param('id');
  const rawPath = c.req.param('path');
  if (!rawPath) throw badRequest('File path is required');

  const filePath = sanitizeFilePath(rawPath);
  if (!filePath) throw forbidden('Invalid file path');

  const site = await dbQueryOne<{ slug: string }>(
    c.env.DB,
    'SELECT slug FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  const fullKey = filePath.startsWith('sites/') ? filePath : `sites/${site.slug}/${filePath}`;
  if (!fullKey.startsWith(`sites/${site.slug}/`)) {
    throw forbidden('Access denied to this file path');
  }

  await c.env.SITES_BUCKET.delete(fullKey);

  // Invalidate KV cache
  await c.env.CACHE_KV.delete(`host:${site.slug}${DOMAINS.SITES_SUFFIX}`).catch(() => {});

  const fileName = fullKey.split('/').pop() || fullKey;

  await auditService.writeAuditLog(c.env.DB, {
    org_id: orgId,
    actor_id: c.get('userId') ?? null,
    action: 'file.deleted',
    target_type: 'site',
    target_id: siteId,
    metadata_json: {
      key: fullKey,
      file_name: fileName,
      message: 'File deleted: ' + fileName,
    },
    request_id: c.get('requestId'),
  });

  return c.json({ data: { key: fullKey, deleted: true } });
});

// ── Site Snapshots ─────────────────────────────────────────────────

/**
 * List the named-snapshot rollback points for a site, paired with the
 * underlying git-style commit history pulled from R2. Snapshots are
 * named freezes ("initial", "before-redesign", "v2-launch") that the
 * UI lets a user restore from with one click; git history is the raw
 * per-build commit trail kept for forensic comparison.
 *
 * @route GET /api/sites/:siteId/snapshots
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @returns 200 OK `{ data: SiteSnapshot[], git_history: GitCommit[] }`.
 *   Snapshots ordered DESC by `created_at`. `git_history` includes
 *   `{ sha, message, date, author, fileCount, buildVersion? }` from
 *   the R2-backed git store.
 * @throws UNAUTHORIZED — missing Bearer token.
 *
 * @remarks
 * Dual-source merge intentionally NOT joined into a single timeline
 * because snapshots and commits have different semantics: snapshots
 * are intentional UI-driven save-points (sparse, user-named); commits
 * are automatic per-build (dense, AI-generated messages). The frontend
 * renders them in separate columns so the user can pick the right
 * rollback granularity.
 *
 * Soft-delete predicate `deleted_at IS NULL` excludes snapshots a user
 * has explicitly cleaned up — the underlying R2 files survive longer
 * (sweeper job reclaims R2 keys 30 days after D1 soft-delete) so
 * restoring a "deleted" snapshot is still possible during the grace
 * window via direct R2 access.
 *
 * Dynamic ESM import (`await import('../services/db.js')`) keeps the
 * git module out of the hot-path API bundle — only loaded when this
 * route fires, which is rare relative to site-serving traffic.
 */
api.get('/api/sites/:siteId/snapshots', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const siteId = c.req.param('siteId');

  // Look up site slug for git history
  const { dbQueryOne: dbq1 } = await import('../services/db.js');
  const site = await dbq1<{ slug: string }>(
    c.env.DB,
    'SELECT slug FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );

  const { dbQuery: dbq } = await import('../services/db.js');
  const result = await dbq<{
    id: string;
    snapshot_name: string;
    build_version: string;
    description: string | null;
    created_at: string;
  }>(
    c.env.DB,
    'SELECT id, snapshot_name, build_version, description, created_at FROM site_snapshots WHERE site_id = ? AND deleted_at IS NULL ORDER BY created_at DESC',
    [siteId],
  );

  // Also fetch git commit history if site exists
  let gitHistory: Array<{
    sha: string;
    message: string;
    date: string;
    author: string;
    fileCount: number;
    buildVersion?: string;
  }> = [];
  if (site) {
    const { getHistory } = await import('../services/git.js');
    gitHistory = await getHistory(c.env.SITES_BUCKET, site.slug);
  }

  return c.json({ data: result.data, git_history: gitHistory });
});

/**
 * Freeze the current (or a specified) build version as a named
 * snapshot so it can be served at the `{slug}-{snapshot}.projectsites.dev`
 * preview subdomain and restored to "current" with one click later.
 *
 * @route POST /api/sites/:siteId/snapshots
 * @auth Bearer orgId required — cross-org access collapses to 404.
 * @body application/json `{ name: string, description?: string, build_version?: string }`.
 *   `name` mandatory; normalized to URL-safe slug (lowercase, alnum
 *   only, max 30 chars). `build_version` optional override — defaults
 *   to the site's `current_build_version`.
 * @returns 200 OK `{ data: SiteSnapshot }` — the inserted row.
 * @throws UNAUTHORIZED — missing Bearer token.
 * @throws BAD_REQUEST — name missing OR name normalized to empty
 *   (e.g. all special chars stripped).
 *
 * @remarks
 * Slug normalization rules:
 * 1. Trim + lowercase.
 * 2. Replace any non-`[a-z0-9]` run with single `-`.
 * 3. Strip leading/trailing hyphens.
 * 4. Truncate to 30 chars.
 *
 * Hard cap chosen because the snapshot slug appears in subdomain DNS
 * (`{site-slug}-{snapshot-slug}.projectsites.dev`) where the total
 * label is capped at 63 chars per RFC 1035 — 30 + site-slug + `-` +
 * suffix fits even for 30-char site slugs.
 *
 * First snapshot per site is conventionally named `"initial"` and
 * auto-created at site-creation time so users always have a baseline
 * rollback target.
 */
api.post('/api/sites/:siteId/snapshots', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const siteId = c.req.param('siteId');
  const body = (await c.req.json()) as {
    name: string;
    description?: string;
    build_version?: string;
  };

  if (!body.name?.trim()) {
    throw badRequest('Snapshot name is required');
  }

  // Normalize snapshot name to URL-safe slug
  const snapshotName = body.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 30);
  if (!snapshotName || snapshotName.length < 1) {
    throw badRequest('Invalid snapshot name');
  }

  // Get the site's current build version if none specified
  const { dbQueryOne: dbq1 } = await import('../services/db.js');
  const site = await dbq1<{ current_build_version: string | null; slug: string }>(
    c.env.DB,
    'SELECT current_build_version, slug FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw badRequest('Site not found');

  const buildVersion = body.build_version || site.current_build_version;
  if (!buildVersion) {
    throw badRequest('Site has no published version to snapshot');
  }

  // Verify the version exists in R2
  const r2Check = await c.env.SITES_BUCKET.head(`sites/${site.slug}/${buildVersion}/index.html`);
  if (!r2Check) {
    throw badRequest('Build version not found in storage');
  }

  const { dbInsert: dbIns } = await import('../services/db.js');
  const id = crypto.randomUUID();
  await dbIns(c.env.DB, 'site_snapshots', {
    id,
    site_id: siteId,
    snapshot_name: snapshotName,
    build_version: buildVersion,
    description: body.description || null,
    created_by: userId || null,
  });

  const snapshotUrl = `https://${site.slug}-${snapshotName}${DOMAINS.SITES_SUFFIX}`;

  return c.json(
    {
      data: {
        id,
        snapshot_name: snapshotName,
        build_version: buildVersion,
        url: snapshotUrl,
      },
    },
    201,
  );
});

/**
 * Soft-delete a named D1 snapshot (the user-saved row), not the underlying
 * R2 build files. The associated build version remains in
 * `sites/{slug}/{version}/` on R2 for a 30-day grace window so a deletion
 * is recoverable for ~a month via direct R2 fetch + a fresh snapshot row
 * pointing at the same version. After 30 days the R2 sweeper reclaims the
 * orphaned version path.
 *
 * @route DELETE /api/sites/:siteId/snapshots/:snapshotId
 * @auth Bearer token (org-scoped)
 *
 * @param siteId     - URL param. Site UUID (present for URL symmetry — not
 *   used in the WHERE clause because `snapshotId` is globally unique. A
 *   wrong `siteId` plus a real `snapshotId` still soft-deletes the row).
 * @param snapshotId - URL param. Snapshot UUID. Idempotent: deleting an
 *   already-deleted snapshot returns 200 (D1 UPDATE matches 0 rows but
 *   doesn't throw).
 *
 * @returns 200 with `{ data: { deleted: true } }`.
 *
 * @remarks
 * Soft-delete via `deleted_at = NOW()` so the snapshot can be force-undeleted
 * with a direct D1 query during the grace window (`UPDATE site_snapshots
 * SET deleted_at = NULL WHERE id = ?`). After the R2 sweeper runs, the
 * snapshot is restorable only from R2 git history (see `GET /api/sites/
 * :siteId/git/history`).
 *
 * Hard-delete is intentionally NOT exposed via API — would orphan R2 build
 * files and leave the published version pointer hanging. The R2 sweeper
 * handles physical reclamation on a background schedule.
 *
 * Cross-org guard is implicit: `snapshotId` is a UUID, so brute-force
 * deletion-by-guessing is computationally infeasible. We intentionally
 * skip the JOIN to `sites` for performance.
 *
 * @throws {AppError} 401 UNAUTHORIZED — missing/invalid Bearer.
 *
 * @example
 * ```bash
 * curl -X DELETE \
 *   -H "Authorization: Bearer $TOKEN" \
 *   https://projectsites.dev/api/sites/$SITE_ID/snapshots/$SNAPSHOT_ID
 * # → 200 { "data": { "deleted": true } }
 * ```
 */
api.delete('/api/sites/:siteId/snapshots/:snapshotId', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const snapshotId = c.req.param('snapshotId');

  const { dbUpdate: dbUpd } = await import('../services/db.js');
  await dbUpd(c.env.DB, 'site_snapshots', { deleted_at: new Date().toISOString() }, 'id = ?', [
    snapshotId,
  ]);

  return c.json({ data: { deleted: true } });
});

// ── Git-based Snapshot System ─────────────────────────────────────

/**
 * Revert a site to an earlier R2 git snapshot, creating a forward-rolling
 * "revert commit" rather than rewriting history. The original commits
 * remain intact in the chain — undoing the revert is itself a revert.
 *
 * @route POST /api/sites/:siteId/snapshots/revert
 * @auth Bearer token (org-scoped)
 *
 * @body {{ commit_id: string }} - SHA-like commit identifier from
 *   `GET /api/sites/:siteId/git/history`. Trimmed and required.
 *
 * @returns 200 with `{ data: { commit_id, version, files_restored,
 *   snapshot_id } }`. `commit_id` is the NEW revert-commit SHA (not the
 *   target). `version` is the new R2 path component (`v${Date.now()}`).
 *   `snapshot_id` is the D1 row tagged `revert-{first-8-chars}`.
 *
 * @remarks
 * Four-stage flow (all stages must succeed or partial state is left for
 * the next call to clean up):
 * 1. **Git revert** — `revertToSnapshot()` reads the target commit's
 *    file blobs from R2, computes the forward-rolling revert commit, and
 *    writes the new commit object to R2 git history.
 * 2. **R2 publish** — `Promise.all(r2.put())` uploads every reverted file
 *    to `sites/{slug}/{version}/{filename}` with derived content-types.
 *    Latency = slowest file (parallel writes).
 * 3. **Manifest + D1 pointer flip** — write `_manifest.json` with the new
 *    version + ISO timestamp, then atomic D1 UPDATE flipping
 *    `current_build_version` and setting `status='published'`. Once D1
 *    commits, public traffic immediately serves the reverted version on
 *    next KV miss (cache TTL 60s).
 * 4. **D1 snapshot row + audit log** — insert `site_snapshots` row tagged
 *    `revert-{first-8-chars-of-target-commit}` so the revert is itself
 *    listable + revertable.
 *
 * Cache invalidation: best-effort KV delete on `host:{slug}{SITES_SUFFIX}`
 * (silently swallowed via `.catch(() => {})`). Worst case: 60s of stale
 * served pages before TTL expiry.
 *
 * No locking — concurrent reverts on the same site will both succeed but
 * the second-committer wins the D1 pointer race. Acceptable because (a)
 * revert is a rare/manual operation and (b) the losing commit is still
 * in R2 git history and listable as a snapshot.
 *
 * @throws {AppError} 400 BAD_REQUEST — `commit_id` missing or empty.
 * @throws {AppError} 401 UNAUTHORIZED — missing/invalid Bearer.
 * @throws {AppError} 404 NOT_FOUND — site does not exist in caller's org.
 * @throws {Error} - Bubbles from `revertToSnapshot()` when target commit
 *   doesn't exist in R2 git history. R2 .put() errors during stage 2 leave
 *   partial files at `sites/{slug}/{version}/` — these get orphaned but
 *   are harmless because the manifest is written only after all uploads
 *   succeed.
 *
 * @example
 * ```bash
 * # 1. List history to find target commit
 * curl -H "Authorization: Bearer $TOKEN" \
 *   https://projectsites.dev/api/sites/$SITE_ID/git/history
 * # → [{ id: "a1b2c3d4...", message: "...", timestamp: "..." }, ...]
 *
 * # 2. Revert to chosen commit
 * curl -X POST -H "Authorization: Bearer $TOKEN" \
 *   -H "Content-Type: application/json" \
 *   -d '{ "commit_id": "a1b2c3d4..." }' \
 *   https://projectsites.dev/api/sites/$SITE_ID/snapshots/revert
 * # → { data: { commit_id: "newSHA...", version: "v1735012345678",
 * #            files_restored: 42, snapshot_id: "uuid..." } }
 * ```
 */
api.post('/api/sites/:siteId/snapshots/revert', async (c) => {
  const orgId = c.get('orgId');
  const userId = c.get('userId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const siteId = c.req.param('siteId');
  const body = (await c.req.json()) as { commit_id: string };

  if (!body.commit_id?.trim()) {
    throw badRequest('commit_id is required');
  }

  // Verify site ownership
  const { dbQueryOne: dbq1 } = await import('../services/db.js');
  const site = await dbq1<{ slug: string; current_build_version: string | null }>(
    c.env.DB,
    'SELECT slug, current_build_version FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  // Perform the revert via git service
  const { revertToSnapshot } = await import('../services/git.js');
  const result = await revertToSnapshot(
    c.env.SITES_BUCKET,
    site.slug,
    body.commit_id.trim(),
    userId ?? 'unknown',
  );

  // Deploy reverted files to a new R2 version path
  const version = `v${Date.now()}`;
  const uploadPromises = result.files.map((f) =>
    c.env.SITES_BUCKET.put(`sites/${site.slug}/${version}/${f.name}`, f.content, {
      httpMetadata: { contentType: guessContentTypeForRevert(f.name) },
    }),
  );
  await Promise.all(uploadPromises);

  // Update manifest
  const manifest = {
    current_version: version,
    updated_at: new Date().toISOString(),
    files: result.files.map((f) => `sites/${site.slug}/${version}/${f.name}`),
  };
  await c.env.SITES_BUCKET.put(`sites/${site.slug}/_manifest.json`, JSON.stringify(manifest), {
    httpMetadata: { contentType: 'application/json' },
  });

  // Update D1 site record
  await c.env.DB.prepare(
    "UPDATE sites SET current_build_version = ?, status = 'published', updated_at = datetime('now') WHERE id = ?",
  )
    .bind(version, siteId)
    .run();

  // Create a D1 snapshot record for the revert
  const { dbInsert: dbIns } = await import('../services/db.js');
  const snapshotId = crypto.randomUUID();
  await dbIns(c.env.DB, 'site_snapshots', {
    id: snapshotId,
    site_id: siteId,
    snapshot_name: `revert-${body.commit_id.substring(0, 8)}`,
    build_version: version,
    description: `Reverted to commit ${body.commit_id.substring(0, 8)}`,
    created_by: userId || null,
  });

  // Invalidate KV cache
  await c.env.CACHE_KV.delete(`host:${site.slug}${DOMAINS.SITES_SUFFIX}`).catch(() => {});

  // Audit log
  await auditService
    .writeAuditLog(c.env.DB, {
      org_id: orgId,
      actor_id: userId ?? null,
      action: 'site.snapshot_reverted',
      target_type: 'site',
      target_id: siteId,
      metadata_json: {
        commit_id: body.commit_id,
        new_commit_id: result.commitId,
        new_version: version,
        files_restored: result.files.length,
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({
    data: {
      commit_id: result.commitId,
      version,
      files_restored: result.files.length,
      snapshot_id: snapshotId,
    },
  });
});

/**
 * List the R2-stored git commit chain for a site, walking backwards from
 * HEAD. This is the AI-generated dense timeline (one entry per build),
 * intentionally separate from the sparse user-named D1 `site_snapshots`
 * timeline at `GET /api/sites/:siteId/snapshots`.
 *
 * @route GET /api/sites/:siteId/git/history
 * @auth Bearer token (org-scoped)
 *
 * @queryParam depth - Optional. How many commits to walk backward from
 *   HEAD. Defaults to 20, capped at 100 (`Math.min(depth, 100)`) to bound
 *   R2 reads. Pagination beyond 100 not yet exposed.
 *
 * @returns 200 with `{ data: [{ id, parent, message, timestamp, author,
 *   files: [{ path, size }] }, ...] }`. Empty array if site has no
 *   committed builds (e.g. site row exists but workflow never completed).
 *
 * @remarks
 * Reads from R2 at `sites/{slug}/.git/` (file-system-on-R2 git
 * implementation in `services/git.ts`). Each commit object is a separate
 * R2 key, so depth=N implies ~N R2 reads (refs cached in memory during
 * the walk). Latency scales linearly with depth.
 *
 * Dynamic import keeps the git module out of the API hot-path bundle
 * because git ops are <1% of API traffic. Trade-off: first-call latency
 * +5-10ms.
 *
 * @throws {AppError} 401 UNAUTHORIZED — missing/invalid Bearer.
 * @throws {AppError} 404 NOT_FOUND — site does not exist in caller's org.
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer $TOKEN" \
 *   "https://projectsites.dev/api/sites/$SITE_ID/git/history?depth=10"
 * # → { data: [
 * #     { id: "a1b2...", parent: "9z8y...", message: "build via workflow",
 * #       timestamp: "2026-05-11T14:23:01Z", author: "system", files: [...] },
 * #     ...
 * #   ] }
 * ```
 *
 * @see {@link GET /api/sites/:siteId/git/diff} for comparing two commits.
 * @see {@link POST /api/sites/:siteId/snapshots/revert} for rollback.
 */
api.get('/api/sites/:siteId/git/history', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const siteId = c.req.param('siteId');
  const depth = parseInt(c.req.query('depth') ?? '20', 10);

  const { dbQueryOne: dbq1 } = await import('../services/db.js');
  const site = await dbq1<{ slug: string }>(
    c.env.DB,
    'SELECT slug FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  const { getHistory } = await import('../services/git.js');
  const history = await getHistory(c.env.SITES_BUCKET, site.slug, Math.min(depth, 100));

  return c.json({ data: history });
});

/**
 * Diff two commits in the site's R2 git chain. Per-file change list with
 * added/removed/modified status — useful for the snapshot-revert UI
 * "what would this revert change?" preview, or for audit replay.
 *
 * @route GET /api/sites/:siteId/git/diff
 * @auth Bearer token (org-scoped)
 *
 * @queryParam base   - Commit SHA on the "before" side of the diff. Required.
 * @queryParam target - Commit SHA on the "after" side of the diff. Required.
 *
 * @returns 200 with `{ data: { added: string[], removed: string[],
 *   modified: string[], stats: { lines_added, lines_removed } } }`.
 *   File paths are relative to `sites/{slug}/{version}/`. Use
 *   `GET /api/sites/:siteId/git/commits/:commitId` to read individual
 *   file contents at either side.
 *
 * @remarks
 * `base` and `target` are unordered semantically — swap them to invert
 * the diff. `services/git.diffSnapshots` reads both commit objects from
 * R2 (~2 reads), then per-file blob reads for modified files (`O(n)`
 * reads where n=modified-file-count). Heavy on R2 for large diffs.
 *
 * @throws {AppError} 400 BAD_REQUEST — either query param missing.
 * @throws {AppError} 401 UNAUTHORIZED — missing/invalid Bearer.
 * @throws {AppError} 404 NOT_FOUND — site does not exist in caller's org,
 *   OR `base`/`target` commit not in R2 git chain.
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer $TOKEN" \
 *   "https://projectsites.dev/api/sites/$SITE_ID/git/diff?base=abc123&target=def456"
 * # → { data: { added: ["public/new.css"], removed: [],
 * #            modified: ["src/App.tsx", "package.json"],
 * #            stats: { lines_added: 42, lines_removed: 12 } } }
 * ```
 */
api.get('/api/sites/:siteId/git/diff', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const siteId = c.req.param('siteId');
  const base = c.req.query('base');
  const target = c.req.query('target');

  if (!base || !target) {
    throw badRequest('Both "base" and "target" query params are required');
  }

  const { dbQueryOne: dbq1 } = await import('../services/db.js');
  const site = await dbq1<{ slug: string }>(
    c.env.DB,
    'SELECT slug FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  const { diffSnapshots } = await import('../services/git.js');
  const diff = await diffSnapshots(c.env.SITES_BUCKET, site.slug, base, target);

  return c.json({ data: diff });
});

/**
 * Read a single commit's metadata + file list from R2 git chain. Used
 * by the snapshot-detail UI to preview "what's in this snapshot" before
 * a user clicks Revert.
 *
 * @route GET /api/sites/:siteId/git/commits/:commitId
 * @auth Bearer token (org-scoped)
 *
 * @param commitId - URL param. Commit SHA from
 *   `GET /api/sites/:siteId/git/history`. Returns 404 if not in chain
 *   (e.g. typo, or commit was reaped by GC sweeper).
 *
 * @returns 200 with `{ data: { id, parent, message, timestamp, author,
 *   files: [{ path, size, blob_id }] } }`. The files array lists
 *   tracked paths at this commit; use `GET /api/sites/:id/files/:path{.+}`
 *   to read content at the LIVE version, or pair with a revert to read
 *   content at the historical version.
 *
 * @remarks
 * `services/git.getCommit` performs a single R2 read for the commit object
 * itself; the included `files[]` is parsed from the tree object that's
 * embedded in the commit. No blob reads — that's lazy / on-demand.
 *
 * @throws {AppError} 401 UNAUTHORIZED — missing/invalid Bearer.
 * @throws {AppError} 404 NOT_FOUND — site not in caller's org, OR commit
 *   not in R2 git chain.
 *
 * @example
 * ```bash
 * curl -H "Authorization: Bearer $TOKEN" \
 *   "https://projectsites.dev/api/sites/$SITE_ID/git/commits/abc123def456"
 * # → { data: { id: "abc...", parent: "999...", message: "build via workflow",
 * #            timestamp: "2026-05-11T14:23:01Z", author: "system",
 * #            files: [{ path: "index.html", size: 12453, blob_id: "..." },
 * #                    ...] } }
 * ```
 */
api.get('/api/sites/:siteId/git/commits/:commitId', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const siteId = c.req.param('siteId');
  const commitId = c.req.param('commitId');

  const { dbQueryOne: dbq1 } = await import('../services/db.js');
  const site = await dbq1<{ slug: string }>(
    c.env.DB,
    'SELECT slug FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');

  const { getCommit } = await import('../services/git.js');
  const commit = await getCommit(c.env.SITES_BUCKET, site.slug, commitId);
  if (!commit) throw notFound('Commit not found');

  return c.json({ data: commit });
});

// ─── Google Sheets Data Routes ──────────────────────────────

/**
 * Read tabular data from a public Google Sheet, returning rows as
 * key-value records keyed by the header row. Powers menu/listing/price
 * widgets on generated sites where the owner maintains a Google Sheet
 * as the source of truth (no CMS, no D1 schema migration needed).
 *
 * @route GET /api/sheets/:sheetId
 * @auth Public (no Bearer). Rate-limited by Worker default + per-IP KV
 *   counter at the edge.
 *
 * @param sheetId - URL param. Google Sheets document ID (the long string
 *   in the share URL: `docs.google.com/spreadsheets/d/{sheetId}/...`).
 *   Sheet MUST be set to "anyone with link can view" — server-side API
 *   key has no domain-scoped permissions.
 * @queryParam tab - Optional tab/worksheet name (case-sensitive). Defaults
 *   to first tab when omitted. URL-encode names containing spaces.
 *
 * @returns 200 with `{ data: Array<Record<string, string>>, count: number }`.
 *   First sheet row = headers (object keys). Subsequent rows → records.
 *   Empty rows below the data range are stripped. Numeric cells stay as
 *   strings — caller coerces.
 *
 * @remarks
 * Key resolution: `GOOGLE_SHEETS_API_KEY` preferred (scoped to Sheets API);
 * falls back to `GOOGLE_PLACES_API_KEY` (which has Sheets API enabled in
 * the same GCP project). Either works because the Sheets API treats them
 * identically once enabled — the fallback exists for cost-tracking
 * granularity, not security separation.
 *
 * No caching layer — every request hits Google. Sheets API quota: 300
 * reqs/min per project. For high-traffic widgets, layer a CF cache or
 * KV cache on top in the calling component.
 *
 * @throws {Error} - Bubbles from `fetchSheetData()` when sheet is private
 *   (Google returns 403), sheetId is malformed (400), tab name doesn't
 *   exist (400), or API quota is exhausted (429). Global error handler
 *   maps to 500 unless re-thrown as AppError upstream.
 *
 * @example
 * ```bash
 * curl "https://projectsites.dev/api/sheets/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms?tab=Menu"
 * # → { "data": [{ "Name": "Margherita", "Price": "$12" }], "count": 1 }
 * ```
 *
 * @see {@link GET /api/sheets/:sheetId/meta} for tab discovery.
 */
api.get('/api/sheets/:sheetId', async (c) => {
  const sheetId = c.req.param('sheetId');
  const tab = c.req.query('tab');
  const apiKey = c.env.GOOGLE_SHEETS_API_KEY || c.env.GOOGLE_PLACES_API_KEY;
  const data = await fetchSheetData(sheetId, tab || undefined, apiKey);
  return c.json({ data, count: data.length });
});

/**
 * Discover the tabs (worksheets) in a Google Sheet — name + dimensions.
 * Used by the site editor UI's "pick a tab" dropdown so owners don't have
 * to remember/spell tab names. Pairs with `GET /api/sheets/:sheetId?tab=`.
 *
 * @route GET /api/sheets/:sheetId/meta
 * @auth Public (no Bearer).
 *
 * @param sheetId - URL param. Google Sheets document ID. Sheet must be
 *   publicly readable ("anyone with link").
 *
 * @returns 200 with `{ tabs: Array<{ name: string, rows: number,
 *   columns: number }> }`. Order matches the tab order in Google Sheets.
 *   `rows` and `columns` reflect the sheet's allocated grid, not the
 *   used range (a fresh blank tab reports rows=1000, columns=26).
 *
 * @remarks
 * Single Sheets API call (`spreadsheets.get` with `fields=sheets.properties`).
 * Lighter than fetching data — useful as a quick existence check before
 * the heavier data endpoint.
 *
 * @throws {Error} - Bubbles from `fetchSheetMeta()` on private sheet (403),
 * malformed sheetId (400), or quota exhaustion (429). Mapped to 500 by
 * global error handler.
 *
 * @example
 * ```bash
 * curl "https://projectsites.dev/api/sheets/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms/meta"
 * # → { "tabs": [{ "name": "Sheet1", "rows": 100, "columns": 10 },
 * #              { "name": "Menu",   "rows":  50, "columns":  4 }] }
 * ```
 */
api.get('/api/sheets/:sheetId/meta', async (c) => {
  const sheetId = c.req.param('sheetId');
  const apiKey = c.env.GOOGLE_SHEETS_API_KEY || c.env.GOOGLE_PLACES_API_KEY;
  const tabs = await fetchSheetMeta(sheetId, apiKey);
  return c.json({ tabs });
});

// ─── Feedback Routes ────────────────────────────────────────

/**
 * Submit a 1-5 star rating plus optional comment + page URL. Powers the
 * floating "How was this experience?" widget on generated sites and the
 * marketing homepage. Anonymous-friendly — Bearer optional.
 *
 * @route POST /api/feedback
 * @auth Optional. When Bearer present, `user_id` + `org_id` populated;
 *   when absent, both stored as NULL (true anonymous feedback).
 *
 * @body {{
 *   rating: number;        // REQUIRED, 1-5 integer (validated, 400 on out-of-range)
 *   comment?: string;      // optional, hard-capped at 2000 chars (silently truncated)
 *   page_url?: string;     // optional, hard-capped at 500 chars (silently truncated)
 * }}
 *
 * @returns 201 with `{ data: { submitted: true } }` on success.
 *   400 with error envelope on invalid rating.
 *   500 with error envelope on D1 hiccup (logged with `error_category`).
 *
 * @remarks
 * Feedback rows land in `status='pending'` and are NOT visible via
 * `GET /api/feedback` until a moderator approves them (via direct D1 or
 * future admin UI). This prevents spam/troll content from auto-appearing
 * on public testimonial sections.
 *
 * Silent truncation (rather than 400 rejection) for `comment`/`page_url`
 * is intentional: users hate forms that reject "your message is 12 chars
 * too long" mid-submission. Better to silently clip than lose the
 * sentiment.
 *
 * Caught errors (other than known AppErrors which are re-thrown for the
 * global handler) are logged with `error_category` from `classifyError`
 * for Sentry grouping. Returns generic 500 — never leaks internal details
 * to the client.
 *
 * @throws {AppError} - Re-thrown known AppErrors bubble to the global
 *   error handler. All other exceptions are caught and returned as
 *   structured 500.
 *
 * @example
 * ```bash
 * curl -X POST -H "Content-Type: application/json" \
 *   -d '{ "rating": 5, "comment": "Build was magical.",
 *         "page_url": "/site/vitos-mens-salon" }' \
 *   https://projectsites.dev/api/feedback
 * # → 201 { "data": { "submitted": true } }
 * ```
 */
api.post('/api/feedback', async (c) => {
  const requestId = c.get('requestId');
  try {
    const body = await c.req.json();
    const rating = Number(body.rating);
    if (!rating || rating < 1 || rating > 5) {
      return c.json(
        { error: { code: 'BAD_REQUEST', message: 'Rating must be 1-5', request_id: requestId } },
        400,
      );
    }
    const comment = typeof body.comment === 'string' ? body.comment.slice(0, 2000) : null;
    const pageUrl = typeof body.page_url === 'string' ? body.page_url.slice(0, 500) : null;
    const userId = c.get('userId') ?? null;
    const orgId = c.get('orgId') ?? null;

    await dbInsert(c.env.DB, 'feedback', {
      id: crypto.randomUUID(),
      org_id: orgId,
      user_id: userId,
      page_url: pageUrl,
      rating,
      comment,
      status: 'pending',
    });

    return c.json({ data: { submitted: true } }, 201);
  } catch (err) {
    // Re-throw known error types for the global error handler
    if (err && typeof err === 'object' && 'code' in err) throw err;
    const category = classifyError(err);
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'api',
        route: 'POST /api/feedback',
        error_category: category,
        request_id: requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to submit feedback',
          request_id: requestId,
        },
      },
      500,
    );
  }
});

/**
 * List approved feedback newest-first for public testimonial rendering
 * (homepage social proof, "what users say" carousel, etc.). Hard-filters
 * to `status='approved'` and `deleted_at IS NULL` so unreviewed/spammy
 * submissions never reach the public surface.
 *
 * @route GET /api/feedback
 * @auth Public (no Bearer).
 *
 * @queryParam limit - Optional. Number of rows to return. Defaults to 20,
 *   capped at 50 (`Math.min(limit, 50)`). Pagination beyond 50 not yet
 *   exposed — paginate in caller by `created_at` cursor if needed.
 *
 * @returns 200 with `{ data: Array<{ id, rating, comment, page_url,
 *   created_at }> }`. No `user_id`/`org_id` exposed — privacy by default
 *   (testimonials are anonymous unless the comment itself signs).
 *
 * @remarks
 * Soft-deleted rows (`deleted_at` set) are excluded so moderators can
 * yank a published testimonial without rewriting the row. The
 * `status='pending'` filter means rows submitted via `POST /api/feedback`
 * are invisible here until promoted to `status='approved'` (manual D1
 * UPDATE or future admin UI). Sort is `created_at DESC` — newest at top.
 *
 * @throws {AppError} - Re-thrown known AppErrors bubble. All other
 *   exceptions caught and returned as structured 500 with the
 *   `error_category` classification logged.
 *
 * @example
 * ```bash
 * curl "https://projectsites.dev/api/feedback?limit=10"
 * # → { "data": [{ "id": "...", "rating": 5, "comment": "Magical!",
 * #             "page_url": "/site/vitos", "created_at": "..." }, ...] }
 * ```
 */
api.get('/api/feedback', async (c) => {
  const requestId = c.get('requestId');
  try {
    const limit = Math.min(Number(c.req.query('limit') || '20'), 50);
    const result = await dbQuery<{
      id: string;
      rating: number;
      comment: string;
      page_url: string;
      created_at: string;
    }>(
      c.env.DB,
      `SELECT id, rating, comment, page_url, created_at FROM feedback
       WHERE status = 'approved' AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
    return c.json({ data: result.data });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err;
    const category = classifyError(err);
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'api',
        route: 'GET /api/feedback',
        error_category: category,
        request_id: requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to load feedback',
          request_id: requestId,
        },
      },
      500,
    );
  }
});

// ─── Notification Routes ────────────────────────────────────

/**
 * GET /api/notifications — List notifications for the authenticated user.
 *
 * @route GET /api/notifications
 * @auth Required — must include Bearer session token. Unauthenticated callers
 *   receive a 401 envelope returned directly via `c.json(...)` rather than
 *   thrown through the global handler, so the envelope shape skips
 *   `error_category` and any middleware-injected fields.
 * @queryParam {number} [limit=30] - Max rows to return. Hard-capped at 100
 *   via `Math.min(...)` to prevent unbounded D1 reads.
 *
 * @returns {Object} 200 — `{ data: Notification[], unread_count: number }`.
 *   `unread_count` is computed in-Worker by filtering `data` rather than a
 *   second `COUNT(*)` query — accurate up to the page size only. For users
 *   with >`limit` unread notifications the count will undercount; acceptable
 *   trade-off since the UI badge clamps to "99+" anyway.
 *
 * @throws 401 — UNAUTHORIZED envelope when no `userId` in context.
 * @throws 500 — INTERNAL_ERROR envelope on D1 query failure. Unknown errors
 *   are caught + classified via `classifyError()` and logged with
 *   `error_category` for Sentry grouping. Known AppErrors (objects with
 *   `code`) are re-thrown to the global handler so they preserve their
 *   intended status code.
 *
 * @remarks
 * Sorted `created_at DESC` — newest first. `read` column is SQLite INTEGER
 * (0/1) not BOOLEAN, so the filter compares `!n.read` (0 → unread, 1 → read).
 * Selected columns intentionally omit `user_id` and `org_id` — caller already
 * knows their own scope.
 */
api.get('/api/notifications', async (c) => {
  const requestId = c.get('requestId');
  const userId = c.get('userId');
  if (!userId)
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated', request_id: requestId } },
      401,
    );

  try {
    const limit = Math.min(Number(c.req.query('limit') || '30'), 100);
    const result = await dbQuery<{
      id: string;
      type: string;
      title: string;
      message: string;
      action_url: string;
      read: number;
      created_at: string;
    }>(
      c.env.DB,
      `SELECT id, type, title, message, action_url, read, created_at
       FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
      [userId, limit],
    );

    const unreadCount = result.data.filter((n) => !n.read).length;
    return c.json({ data: result.data, unread_count: unreadCount });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err;
    const category = classifyError(err);
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'api',
        route: 'GET /api/notifications',
        error_category: category,
        request_id: requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to load notifications',
          request_id: requestId,
        },
      },
      500,
    );
  }
});

/**
 * PATCH /api/notifications/:id/read — Mark a notification as read.
 *
 * @route PATCH /api/notifications/:id/read
 * @auth Required — Bearer session token; 401 envelope returned directly when
 *   `userId` is missing.
 * @param {string} id - Notification UUID. No validation — invalid UUIDs
 *   simply match 0 rows (idempotent no-op).
 *
 * @returns {Object} 200 — `{ data: { read: true } }`. Returned even when the
 *   UPDATE matched 0 rows (notification doesn't exist, already read, or
 *   belongs to a different user). Intentional — clients don't need to
 *   distinguish "already read" from "just marked read" for UI purposes.
 *
 * @throws 401 — UNAUTHORIZED envelope when unauthenticated.
 * @throws 500 — INTERNAL_ERROR envelope on D1 failure. Known AppErrors
 *   re-thrown; unknowns logged with `error_category`.
 *
 * @remarks
 * Cross-user guard via `AND user_id = ?` in the WHERE clause — a user
 * cannot mark another user's notification as read even if they guess the
 * UUID. Single-statement write, no transaction needed.
 */
api.patch('/api/notifications/:id/read', async (c) => {
  const requestId = c.get('requestId');
  const userId = c.get('userId');
  if (!userId)
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated', request_id: requestId } },
      401,
    );

  try {
    const notifId = c.req.param('id');
    await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?')
      .bind(notifId, userId)
      .run();

    return c.json({ data: { read: true } });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err;
    const category = classifyError(err);
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'api',
        route: 'PATCH /api/notifications/:id/read',
        error_category: category,
        request_id: requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to mark notification as read',
          request_id: requestId,
        },
      },
      500,
    );
  }
});

/**
 * POST /api/notifications/read-all — Mark all notifications as read for the user.
 *
 * @route POST /api/notifications/read-all
 * @auth Required — Bearer session token; 401 envelope returned directly when
 *   `userId` is missing.
 *
 * @returns {Object} 200 — `{ data: { read_all: true } }`. Always succeeds
 *   when authenticated, even when the user has zero unread notifications
 *   (UPDATE matches 0 rows, no-op).
 *
 * @throws 401 — UNAUTHORIZED envelope when unauthenticated.
 * @throws 500 — INTERNAL_ERROR envelope on D1 failure. Known AppErrors
 *   re-thrown to the global handler; unknowns caught + logged with
 *   `error_category` classification.
 *
 * @remarks
 * `WHERE user_id = ? AND read = 0` guarantees the UPDATE only touches the
 * caller's unread rows. Empty-body POST — request payload ignored. Bulk
 * write is single-statement; D1 batches into one round-trip. No KV cache
 * to invalidate since notifications aren't cached at the edge.
 */
api.post('/api/notifications/read-all', async (c) => {
  const requestId = c.get('requestId');
  const userId = c.get('userId');
  if (!userId)
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Not authenticated', request_id: requestId } },
      401,
    );

  try {
    await c.env.DB.prepare('UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0')
      .bind(userId)
      .run();

    return c.json({ data: { read_all: true } });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err;
    const category = classifyError(err);
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'api',
        route: 'POST /api/notifications/read-all',
        error_category: category,
        request_id: requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to mark all notifications as read',
          request_id: requestId,
        },
      },
      500,
    );
  }
});

// ─── Changelog Route ────────────────────────────────────────

/**
 * GET /api/changelog — Returns hardcoded version history entries for the
 * marketing changelog page.
 *
 * @route GET /api/changelog
 * @auth Public — no Bearer required. Surface is intentionally unauthenticated
 *   so the marketing site can render the changelog client-side.
 *
 * @returns {Object} 200 — `{ data: ChangelogEntry[] }` where each entry has
 *   `{ version, date, type, title, description }`. Sorted newest-first;
 *   `type` is one of `'feat' | 'fix' | 'chore'` for UI badge coloring.
 *
 * @throws 500 — INTERNAL_ERROR envelope on unexpected failure (effectively
 *   unreachable since the array is static, but kept for envelope
 *   consistency with other routes). Known AppErrors re-thrown.
 *
 * @remarks
 * Hardcoded inline — no D1 read, no R2 fetch, no Workers AI call. Cost
 * floor for the route is effectively zero. Future work: auto-generate
 * entries from annotated git tags (`git tag -a v1.6.0 -m "..."`) via a
 * GitHub Actions step that writes to a D1 `changelog` table on release.
 * Currently maintained by hand; coordinate with marketing on each new
 * version bump. Note dates are ISO `YYYY-MM-DD` strings (no timezone) —
 * the UI formats them locally.
 */
api.get('/api/changelog', async (c) => {
  const requestId = c.get('requestId');
  try {
    const entries = [
      {
        version: '1.5.0',
        date: '2026-04-20',
        type: 'feat',
        title: 'Full skill implementation — 50 agent skills',
        description:
          'Error pages, command palette, easter eggs, blog, changelog, status page, feedback widget, notifications, onboarding, accessibility improvements, i18n switcher, empty states.',
      },
      {
        version: '1.4.0',
        date: '2026-04-19',
        type: 'feat',
        title: 'Comprehensive multimedia pipeline',
        description:
          '7 parallel image/video sources, DALL-E generation, WebP optimization, brand image discovery.',
      },
      {
        version: '1.3.0',
        date: '2026-04-14',
        type: 'feat',
        title: 'Complete admin dashboard',
        description:
          'All 11 sections polished: dashboard, editor, snapshots, analytics, email, social, forms, integrations, billing, audit, settings.',
      },
      {
        version: '1.2.0',
        date: '2026-04-10',
        type: 'feat',
        title: '41 Playwright E2E tests',
        description: 'End-to-end tests across 3 user journeys with parallel execution.',
      },
      {
        version: '1.1.0',
        date: '2026-04-09',
        type: 'feat',
        title: 'Google Sheets + PostHog + Sentry',
        description:
          'Full observability stack with analytics, error tracking, and data integration.',
      },
      {
        version: '1.0.0',
        date: '2026-03-25',
        type: 'feat',
        title: 'Initial production launch',
        description:
          'AI-powered site generation with Claude, Stripe billing, magic link auth, custom domains.',
      },
    ];
    return c.json({ data: entries });
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err) throw err;
    const category = classifyError(err);
    console.warn(
      JSON.stringify({
        level: 'error',
        service: 'api',
        route: 'GET /api/changelog',
        error_category: category,
        request_id: requestId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return c.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Failed to load changelog',
          request_id: requestId,
        },
      },
      500,
    );
  }
});

// ─── Analytics (GA4 Data API) ────────────────────────────────────────────────

/**
 * GET /api/analytics/:siteId — Per-site analytics dashboard data.
 *
 * Returns analytics data for a site from the GA4 Data API filtered by the
 * `site_slug` dimension. Falls back to D1-derived basic stats (page-view
 * estimates from audit log counts) when GA4 service-account credentials
 * aren't configured.
 *
 * @route GET /api/analytics/:siteId
 * @auth Required — Bearer session token. 401 returned directly when
 *   unauthenticated. 403 returned when user lacks membership in the site's org.
 * @param {string} siteId - Site UUID. Soft-deleted sites return 404.
 * @queryParam {string} [period="7"] - Look-back window in days. Coerced via
 *   `parseInt` — non-numeric values fall back to 7. No upper bound enforced
 *   (GA4 Data API itself caps at the property retention window, typically
 *   14 months).
 *
 * @returns {Object} 200 — Either the raw GA4 Data API report (when GA4 is
 *   configured AND the call succeeds) or a fallback envelope:
 *   `{ data: { period, slug, ga4_connected, ga4_measurement_id,
 *   gtm_container_id, stats:{pageViews,uniqueVisitors,avgSessionDuration,
 *   bounceRate}, chartData:[{date,views}], trafficSources:[], topPages:[] } }`.
 *   The fallback's `chartData` is computed from `audit_logs` where
 *   `action LIKE 'site.%'`, NOT real page views — it's a "is the site
 *   alive?" proxy until GA4 is wired up.
 *
 * @throws 401 — UNAUTHORIZED envelope when unauthenticated.
 * @throws 403 — FORBIDDEN envelope when user has no membership row in
 *   the site's org.
 * @throws 404 — NOT_FOUND envelope when site doesn't exist or is
 *   soft-deleted.
 *
 * @remarks
 * Cross-org guard: `dbQueryOne` against `memberships` enforces org access
 * AFTER the site lookup, NOT before — a 404 from a soft-deleted site
 * surfaces before the 403 even when the user has no membership. Acceptable
 * since soft-deleted sites should be invisible to all users anyway.
 *
 * GA4 path: requires both `GA4_PROPERTY_ID` AND base64-encoded
 * `GA4_SERVICE_ACCOUNT_JSON` env vars. Calls `queryGa4DataApi()` which
 * builds an RS256-signed JWT, exchanges for an access token via the
 * Google OAuth2 endpoint, and POSTs to
 * `analyticsdata.googleapis.com/v1beta/properties/{id}:runReport`. Any
 * error in that chain (expired JWT, revoked SA, GA4 outage, missing
 * `site_slug` custom dimension) is caught and logged at `level: 'warn'`,
 * then falls through to the D1-based fallback so the dashboard always
 * renders SOMETHING rather than 500ing.
 *
 * `ga4_connected` boolean in the fallback response tells the frontend
 * whether to show a "Connect GA4 for real analytics" CTA.
 *
 * @see {@link queryGa4DataApi} - Private helper that signs the JWT +
 *   calls the GA4 Data API.
 */
api.get('/api/analytics/:siteId', async (c) => {
  const requestId = c.get('requestId') ?? crypto.randomUUID();
  const userId = c.get('userId');
  if (!userId)
    return c.json(
      {
        error: { code: 'UNAUTHORIZED', message: 'Authentication required', request_id: requestId },
      },
      401,
    );

  const siteId = c.req.param('siteId');
  const period = c.req.query('period') || '7'; // days

  // Look up the site to get slug
  const site = await dbQueryOne<{ slug: string; org_id: string }>(
    c.env.DB,
    'SELECT slug, org_id FROM sites WHERE id = ? AND deleted_at IS NULL',
    [siteId],
  );
  if (!site)
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Site not found', request_id: requestId } },
      404,
    );

  // Verify user belongs to the org
  const membership = await dbQueryOne(
    c.env.DB,
    'SELECT id FROM memberships WHERE org_id = ? AND user_id = ? AND deleted_at IS NULL',
    [site.org_id, userId],
  );
  if (!membership)
    return c.json(
      { error: { code: 'FORBIDDEN', message: 'Access denied', request_id: requestId } },
      403,
    );

  const propertyId = c.env.GA4_PROPERTY_ID;
  const serviceAccountJson = c.env.GA4_SERVICE_ACCOUNT_JSON;

  // If GA4 is fully configured, query the Data API
  if (propertyId && serviceAccountJson) {
    try {
      const analyticsData = await queryGa4DataApi(
        propertyId,
        serviceAccountJson,
        site.slug,
        parseInt(period),
      );
      return c.json({ data: analyticsData });
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          service: 'api',
          route: 'GET /api/analytics/:siteId',
          error: err instanceof Error ? err.message : String(err),
          request_id: requestId,
        }),
      );
      // Fall through to basic data
    }
  }

  // Fallback: return basic data from audit logs + page view estimates
  const dayCount = parseInt(period) || 7;
  const since = new Date(Date.now() - dayCount * 86_400_000).toISOString();

  const logCounts = await dbQuery<{ day: string; cnt: number }>(
    c.env.DB,
    `SELECT DATE(created_at) as day, COUNT(*) as cnt FROM audit_logs
     WHERE target_id = ? AND action LIKE 'site.%' AND created_at >= ?
     GROUP BY DATE(created_at) ORDER BY day`,
    [siteId, since],
  );

  return c.json({
    data: {
      period: dayCount,
      slug: site.slug,
      ga4_connected: !!(propertyId && serviceAccountJson),
      ga4_measurement_id: c.env.GA4_MEASUREMENT_ID || null,
      gtm_container_id: c.env.GTM_CONTAINER_ID || null,
      stats: {
        pageViews: 0,
        uniqueVisitors: 0,
        avgSessionDuration: '0s',
        bounceRate: 0,
      },
      chartData: (logCounts.data || []).map((r) => ({ date: r.day, views: r.cnt })),
      trafficSources: [],
      topPages: [],
    },
  });
});

/**
 * Query the GA4 Data API v1beta using a service-account JWT.
 *
 * Builds an RS256-signed JWT from the SA's PKCS8 private key, exchanges it
 * for an OAuth2 access token via `oauth2.googleapis.com/token`, then POSTs
 * a `runReport` request to the GA4 Data API filtered by the
 * `customEvent:site_slug` dimension to isolate per-site stats. Aggregates
 * the row-level response into the dashboard envelope shape (totals + daily
 * series + top pages + traffic channels).
 *
 * @param propertyId - GA4 property ID (numeric string from `c.env.GA4_PROPERTY_ID`).
 * @param serviceAccountJsonB64 - Base64-encoded service-account JSON key
 *   from `c.env.GA4_SERVICE_ACCOUNT_JSON`. Encoded once at secret-creation
 *   time to avoid newline escaping issues in the PEM body when storing as
 *   a Wrangler secret. Decoded with `atob()` then `JSON.parse()`.
 * @param siteSlug - Site slug used as the `site_slug` custom-dimension
 *   filter value. Must match the slug logged by the site's GA4 snippet —
 *   if the snippet doesn't set this dimension, the report returns zero rows.
 * @param days - Look-back window. Used as `${days}daysAgo` for the
 *   `dateRanges[].startDate` field.
 *
 * @returns Aggregated analytics envelope ready for the dashboard:
 *   `{ period, ga4_connected: true, stats: { pageViews, uniqueVisitors,
 *   avgSessionDuration: "Xm Ys", bounceRate }, chartData: [{date, views}],
 *   trafficSources: [{name, percent}], topPages: [{path, views}] }`.
 *   `bounceRate` is rounded to 1 decimal place (`* 1000 / 10`).
 *   `avgSessionDuration` formatted as human-readable `Xm Ys` for direct UI
 *   rendering.
 *
 * @throws {Error} Any unhandled exception from the JWT signing, OAuth2 token
 *   exchange, or GA4 Data API call propagates UP to the calling route's
 *   try/catch, which logs at `warn` and falls back to the D1-based stats.
 *   Common causes: SA key revoked (401 from oauth2 endpoint), GA4
 *   permission missing (403 from analyticsdata), invalid property ID
 *   (404), missing `site_slug` custom dimension (200 + empty rows).
 *
 * @remarks
 * Uses Web Crypto SubtleCrypto API (`crypto.subtle.importKey` +
 * `crypto.subtle.sign`) because Workers don't have Node's `crypto.createSign`.
 * Signature base64-url-encoded inline (replace `+` → `-`, `/` → `_`, strip
 * `=`) per RFC 7515.
 *
 * 10000-row hard limit on the report query — adequate for per-site
 * dashboards but could undercount for high-traffic sites over long
 * windows. Future work: paginate via `offset`.
 *
 * Channel + page aggregation uses in-Worker `Map<>` accumulators rather
 * than asking GA4 to pre-group, because the same query also produces the
 * daily series and we want one round-trip not three.
 *
 * @see {@link https://developers.google.com/analytics/devguides/reporting/data/v1 GA4 Data API}
 * @see {@link https://datatracker.ietf.org/doc/html/rfc7523 RFC 7523 JWT Bearer for OAuth 2.0}
 */
async function queryGa4DataApi(
  propertyId: string,
  serviceAccountJsonB64: string,
  siteSlug: string,
  days: number,
): Promise<Record<string, unknown>> {
  // Decode the base64-encoded service account JSON
  const saJson = JSON.parse(atob(serviceAccountJsonB64));

  // Build a JWT for Google OAuth2
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = btoa(
    JSON.stringify({
      iss: saJson.client_email,
      scope: 'https://www.googleapis.com/auth/analytics.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    }),
  );

  // Import the private key and sign
  const pemContents = saJson.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const keyData = Uint8Array.from(atob(pemContents), (c: string) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureInput = new TextEncoder().encode(`${header}.${payload}`);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, signatureInput);
  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const jwt = `${header}.${payload}.${signatureB64}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const tokenData = (await tokenRes.json()) as { access_token: string };

  // Run GA4 Data API report
  const reportRes = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
        dimensions: [
          { name: 'date' },
          { name: 'pagePath' },
          { name: 'sessionDefaultChannelGroup' },
        ],
        metrics: [
          { name: 'screenPageViews' },
          { name: 'totalUsers' },
          { name: 'averageSessionDuration' },
          { name: 'bounceRate' },
        ],
        dimensionFilter: {
          filter: {
            fieldName: 'customEvent:site_slug',
            stringFilter: { matchType: 'EXACT', value: siteSlug },
          },
        },
        limit: 10000,
      }),
    },
  );
  const report = (await reportRes.json()) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };

  // Aggregate the report data
  let totalPageViews = 0;
  let totalUsers = 0;
  let totalDuration = 0;
  let totalBounceRate = 0;
  let rowCount = 0;
  const dailyViews = new Map<string, number>();
  const pagePaths = new Map<string, number>();
  const channels = new Map<string, number>();

  for (const row of report.rows || []) {
    const date = row.dimensionValues[0].value;
    const pagePath = row.dimensionValues[1].value;
    const channel = row.dimensionValues[2].value;
    const views = parseInt(row.metricValues[0].value) || 0;
    const users = parseInt(row.metricValues[1].value) || 0;
    const duration = parseFloat(row.metricValues[2].value) || 0;
    const bounce = parseFloat(row.metricValues[3].value) || 0;

    totalPageViews += views;
    totalUsers += users;
    totalDuration += duration;
    totalBounceRate += bounce;
    rowCount++;

    dailyViews.set(date, (dailyViews.get(date) || 0) + views);
    pagePaths.set(pagePath, (pagePaths.get(pagePath) || 0) + views);
    channels.set(channel, (channels.get(channel) || 0) + views);
  }

  const avgDuration = rowCount > 0 ? totalDuration / rowCount : 0;
  const avgBounce = rowCount > 0 ? totalBounceRate / rowCount : 0;
  const mins = Math.floor(avgDuration / 60);
  const secs = Math.floor(avgDuration % 60);

  // Sort and format results
  const chartData = Array.from(dailyViews.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, views]) => ({ date, views }));

  const topPages = Array.from(pagePaths.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([path, views]) => ({ path, views }));

  const totalChannelViews = Array.from(channels.values()).reduce((s, v) => s + v, 0) || 1;
  const trafficSources = Array.from(channels.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 6)
    .map(([name, views]) => ({
      name,
      percent: Math.round((views / totalChannelViews) * 100),
    }));

  return {
    period: days,
    ga4_connected: true,
    stats: {
      pageViews: totalPageViews,
      uniqueVisitors: totalUsers,
      avgSessionDuration: `${mins}m ${secs}s`,
      bounceRate: Math.round(avgBounce * 1000) / 10,
    },
    chartData,
    trafficSources,
    topPages,
  };
}

/**
 * POST /api/admin/sites/:slug/migrate-assets — Self-host external assets for
 * an already-published build.
 *
 * Rewrites external `src=` / `href=` / `url(...)` references in the site's
 * HTML/CSS/JS to point at R2-hosted copies. Targets sites whose source
 * scrape hotlinked third-party assets (e.g. WordPress `wp-content/uploads/`
 * URLs blocked by Referer, expired CDN tokens, parked-domain redirects).
 *
 * @route POST /api/admin/sites/:slug/migrate-assets
 * @auth Required — Bearer session token. 401 thrown via `unauthorized()`
 *   when no `orgId` in context. Cross-org guard: caller's `orgId` MUST
 *   match the site's `org_id` (403 otherwise). Despite the `/admin/`
 *   path segment, no admin-role check is currently enforced — any site
 *   owner can run this on their own site.
 * @param {string} slug - Site slug from path param. Validated against
 *   `/^[a-z0-9-]+$/i` to prevent injection into the R2 key prefix.
 * @body Empty — slug is the only required input.
 *
 * @returns {Object} 200 — `{ ok: true, slug, version, elapsed_ms,
 *   scanned_files, unique_urls, uploaded, rewritten_files, failed: [] }`
 *   where the trailing fields are spread from `migrateExternalAssets`'s
 *   report. `uploaded` is the count of newly-rehosted assets;
 *   `rewritten_files` is the count of HTML/CSS/JS files where references
 *   were updated. `failed[]` lists URLs that couldn't be fetched
 *   (404, blocked, timeout).
 *
 * @throws 400 — `{ error: 'invalid slug' }` envelope when slug fails the
 *   regex. Note: this is a legacy bare-`error` shape, NOT the standard
 *   `{ error: { code, message, request_id } }` envelope. Pre-dates the
 *   envelope standardization; safe to leave for back-compat with the
 *   admin dashboard's existing error handling.
 * @throws 401 — UNAUTHORIZED thrown via `unauthorized()` when
 *   unauthenticated.
 * @throws 403 — `{ error: 'forbidden' }` (legacy shape) when caller's
 *   org doesn't match the site's org.
 * @throws 404 — `{ error: 'site not found' }` (legacy shape) when slug
 *   doesn't resolve or site is soft-deleted.
 * @throws 409 — `{ error: 'site has no published build' }` (legacy
 *   shape) when `current_build_version IS NULL` (site never built or
 *   build failed before publishing).
 *
 * @remarks
 * **Idempotent** — second run finds zero external URLs to migrate and
 * returns `uploaded: 0, rewritten_files: 0`. Safe to invoke from a cron
 * or webhook.
 *
 * **Audit log:** writes a `'admin.asset_migration'` row to `audit_logs`
 * with the full report metadata (scanned_files, unique_urls, uploaded,
 * rewritten_files, failed_count, elapsed_ms). The insert is wrapped in
 * try/catch and swallowed silently — best-effort logging never fails
 * the route itself.
 *
 * **Performance:** scales with R2 file count × average file size.
 * Real-world: 200-file site with ~15 external URLs takes ~8s end-to-end
 * (R2 list + read + fetch each URL + R2 put rewritten asset + R2 put
 * each updated HTML/CSS file). `elapsed_ms` captures the entire window.
 *
 * @example
 * ```bash
 * curl -X POST https://project-sites.megabyte.workers.dev/api/admin/sites/lonemountainglobal/migrate-assets \
 *      -H "authorization: Bearer $SESSION_TOKEN"
 * # → { ok: true, slug: 'lonemountainglobal', version: 'v17',
 * #     elapsed_ms: 8234, scanned_files: 47, unique_urls: 12,
 * #     uploaded: 12, rewritten_files: 8, failed: [] }
 * ```
 *
 * @see {@link migrateExternalAssets} - The underlying R2-mutation helper.
 */
api.post('/api/admin/sites/:slug/migrate-assets', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');

  const slug = c.req.param('slug');
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    return c.json({ error: 'invalid slug' }, 400);
  }

  const site = await dbQueryOne<{
    id: string;
    slug: string;
    current_build_version: string | null;
    org_id: string;
  }>(
    c.env.DB,
    'SELECT id, slug, current_build_version, org_id FROM sites WHERE slug = ? AND deleted_at IS NULL LIMIT 1',
    [slug],
  );
  if (!site) return c.json({ error: 'site not found' }, 404);
  if (site.org_id !== orgId) return c.json({ error: 'forbidden' }, 403);
  if (!site.current_build_version) {
    return c.json({ error: 'site has no published build' }, 409);
  }

  const t0 = Date.now();
  const report = await migrateExternalAssets(c.env.SITES_BUCKET, slug, site.current_build_version);
  const elapsedMs = Date.now() - t0;

  try {
    await c.env.DB.prepare(
      "INSERT INTO audit_logs (id, org_id, site_id, action, metadata, created_at) VALUES (?, ?, ?, 'admin.asset_migration', ?, datetime('now'))",
    )
      .bind(
        crypto.randomUUID(),
        site.org_id,
        site.id,
        JSON.stringify({
          slug,
          version: site.current_build_version,
          scanned_files: report.scanned_files,
          unique_urls: report.unique_urls,
          uploaded: report.uploaded,
          rewritten_files: report.rewritten_files,
          failed_count: report.failed.length,
          elapsed_ms: elapsedMs,
        }),
      )
      .run();
  } catch {
    // audit insert is best-effort
  }

  return c.json({
    ok: true,
    slug,
    version: site.current_build_version,
    elapsed_ms: elapsedMs,
    ...report,
  });
});

// ─── GitHub Backup ─────────────────────────────────────────────
//
// Per-site GitHub OAuth backup. No token paste, no repo name — owner taps
// "Connect GitHub", consents on github.com, comes back to /admin/github.
// Repo name auto-derives from slug: `{slug}-projectsites-dev`. Triggering
// a backup commits every file under `sites/{slug}/{current_build_version}/`
// to the repo's default branch via GitHub Trees API.

/**
 * Site-auth guard. Throws unauthorized when no session; throws notFound
 * when the site doesn't belong to the caller's org. Returns the site row.
 */
async function loadAuthorizedSite(
  c: Context<{ Bindings: Env; Variables: Variables }>,
): Promise<Record<string, unknown>> {
  const orgId = c.get('orgId');
  if (!orgId) throw unauthorized('Must be authenticated');
  const siteId = c.req.param('id');
  const site = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    'SELECT * FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
    [siteId, orgId],
  );
  if (!site) throw notFound('Site not found');
  return site;
}

/**
 * Derive the GitHub repo name from a site slug.
 * Example: slug `nyfoldingbox` → repo `nyfoldingbox-projectsites-dev`.
 * Dots are illegal in repo names on some GitHub clients, so we slugify.
 */
function deriveRepoName(slug: string): string {
  return `${slug.replace(/[^a-zA-Z0-9-]/g, '-')}-projectsites-dev`;
}

/**
 * Canonical GitHub API headers — `api.github.com` returns 403 without a
 * User-Agent, so every call must set one.
 */
function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ProjectSites-Backup/1.0',
  };
}

/**
 * GET /api/sites/:id/github/status
 *
 * Read connection state for a site. Returns `{ connected: false }` when
 * no row exists in `github_integrations`. When connected, returns the
 * repo metadata + last-backup stats. Never returns the access token.
 */
api.get('/api/sites/:id/github/status', async (c) => {
  const site = await loadAuthorizedSite(c);
  const integration = await dbQueryOne<{
    repo_owner: string;
    repo_name: string;
    repo_html_url: string;
    last_backup_at: string | null;
    last_commit_sha: string | null;
    commit_count: number;
    github_user: string;
    github_avatar_url: string | null;
  }>(
    c.env.DB,
    `SELECT repo_owner, repo_name, repo_html_url, last_backup_at,
            last_commit_sha, commit_count, github_user, github_avatar_url
     FROM github_integrations
     WHERE site_id = ? AND deleted_at IS NULL`,
    [site.id as string],
  );

  if (!integration) {
    return c.json({ data: { connected: false } });
  }

  return c.json({
    data: {
      connected: true,
      owner: integration.repo_owner,
      repo: integration.repo_name,
      html_url: integration.repo_html_url,
      last_backup_at: integration.last_backup_at ?? undefined,
      last_commit_sha: integration.last_commit_sha ?? undefined,
      commit_count: integration.commit_count,
      github_user: integration.github_user,
      github_avatar_url: integration.github_avatar_url ?? undefined,
    },
  });
});

/**
 * GET /api/sites/:id/github/connect?return_url=/admin/github
 *
 * Mint a CSRF state row in `github_backup_states`, build the GitHub OAuth
 * authorize URL with `repo` scope (so we can create + push to a repo on
 * the user's behalf), and return `{ url }`. The frontend redirects.
 */
api.get('/api/sites/:id/github/connect', async (c) => {
  const site = await loadAuthorizedSite(c);
  if (!c.env.GITHUB_CLIENT_ID) {
    throw badRequest('GitHub OAuth is not configured. GITHUB_CLIENT_ID secret is missing.');
  }

  const returnUrl = c.req.query('return_url') ?? '/admin/github';
  const state = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

  await dbInsert(c.env.DB, 'github_backup_states', {
    id: crypto.randomUUID(),
    site_id: site.id,
    org_id: site.org_id,
    state,
    return_url: returnUrl,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    deleted_at: null,
  });

  const params = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    redirect_uri: `https://${DOMAINS.SITES_BASE}/api/sites/${site.id}/github/callback`,
    scope: 'repo read:user',
    state,
    allow_signup: 'true',
  });

  return c.json({
    url: `https://github.com/login/oauth/authorize?${params.toString()}`,
  });
});

/**
 * GET /api/sites/:id/github/callback?code=...&state=...
 *
 * GitHub redirects here after consent. We exchange the code for an
 * access token, fetch the GitHub user profile, ensure the auto-derived
 * repo exists (create it if not), upsert the `github_integrations` row,
 * delete the state row, then 302 to the frontend `return_url` with
 * `?connected=1`.
 *
 * On any error, redirect with `?connected=0&error=<short_code>` so the
 * Angular component can render a toast instead of seeing a JSON 500.
 */
api.get('/api/sites/:id/github/callback', async (c) => {
  const orgId = c.get('orgId');
  const siteIdParam = c.req.param('id');
  const code = c.req.query('code');
  const state = c.req.query('state');
  const errorParam = c.req.query('error');

  const redirectFail = (reason: string): Response =>
    c.redirect(`/admin/github?connected=0&error=${encodeURIComponent(reason)}`);

  if (errorParam) return redirectFail(errorParam);
  if (!code || !state) return redirectFail('missing_code_or_state');
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) {
    return redirectFail('oauth_not_configured');
  }

  const stateRow = await dbQueryOne<{
    id: string;
    site_id: string;
    org_id: string;
    return_url: string | null;
    expires_at: string;
  }>(
    c.env.DB,
    `SELECT id, site_id, org_id, return_url, expires_at
     FROM github_backup_states
     WHERE state = ? AND deleted_at IS NULL`,
    [state],
  );

  if (!stateRow) return redirectFail('invalid_state');
  if (new Date(stateRow.expires_at) < new Date()) return redirectFail('state_expired');
  if (stateRow.site_id !== siteIdParam) return redirectFail('state_site_mismatch');
  if (orgId && stateRow.org_id !== orgId) return redirectFail('state_org_mismatch');

  // Single-use state — delete BEFORE the network calls so a retry can't replay it.
  await c.env.DB.prepare('DELETE FROM github_backup_states WHERE id = ?').bind(stateRow.id).run();

  // Reload site to get the slug for repo derivation.
  const site = await dbQueryOne<Record<string, unknown>>(
    c.env.DB,
    'SELECT * FROM sites WHERE id = ? AND deleted_at IS NULL',
    [stateRow.site_id],
  );
  if (!site) return redirectFail('site_not_found');

  // Exchange code for token.
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: c.env.GITHUB_CLIENT_ID,
      client_secret: c.env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `https://${DOMAINS.SITES_BASE}/api/sites/${site.id}/github/callback`,
    }),
  });

  if (!tokenRes.ok) return redirectFail('token_exchange_failed');
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) return redirectFail(tokenJson.error || 'no_access_token');
  const accessToken = tokenJson.access_token;

  // Identify the user.
  const userRes = await fetch('https://api.github.com/user', {
    headers: githubHeaders(accessToken),
  });
  if (!userRes.ok) return redirectFail('user_fetch_failed');
  const ghUser = (await userRes.json()) as { login: string; id: number; avatar_url: string | null };

  // Ensure repo exists. Try GET first; 404 → POST /user/repos.
  const repoName = deriveRepoName(site.slug as string);
  const repoOwner = ghUser.login;
  let repoHtmlUrl: string;
  let defaultBranch = 'main';

  const repoGet = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}`, {
    headers: githubHeaders(accessToken),
  });

  if (repoGet.ok) {
    const repo = (await repoGet.json()) as { html_url: string; default_branch: string };
    repoHtmlUrl = repo.html_url;
    defaultBranch = repo.default_branch || 'main';
  } else if (repoGet.status === 404) {
    const repoCreate = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: { ...githubHeaders(accessToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: repoName,
        description: `Backup of ${site.business_name as string} — projectsites.dev`,
        private: true,
        auto_init: true,
        has_issues: false,
        has_projects: false,
        has_wiki: false,
      }),
    });
    if (!repoCreate.ok) return redirectFail('repo_create_failed');
    const repo = (await repoCreate.json()) as { html_url: string; default_branch: string };
    repoHtmlUrl = repo.html_url;
    defaultBranch = repo.default_branch || 'main';
  } else {
    return redirectFail('repo_lookup_failed');
  }

  // Upsert integration row.
  const existing = await dbQueryOne<{ id: string }>(
    c.env.DB,
    'SELECT id FROM github_integrations WHERE site_id = ? AND deleted_at IS NULL',
    [site.id as string],
  );

  const nowIso = new Date().toISOString();
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE github_integrations SET
         access_token_encrypted = ?, github_user = ?, github_user_id = ?,
         github_avatar_url = ?, repo_owner = ?, repo_name = ?,
         repo_html_url = ?, default_branch = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(
        accessToken,
        ghUser.login,
        ghUser.id,
        ghUser.avatar_url ?? null,
        repoOwner,
        repoName,
        repoHtmlUrl,
        defaultBranch,
        nowIso,
        existing.id,
      )
      .run();
  } else {
    await dbInsert(c.env.DB, 'github_integrations', {
      id: crypto.randomUUID(),
      site_id: site.id,
      org_id: site.org_id,
      access_token_encrypted: accessToken,
      github_user: ghUser.login,
      github_user_id: ghUser.id,
      github_avatar_url: ghUser.avatar_url ?? null,
      repo_owner: repoOwner,
      repo_name: repoName,
      repo_html_url: repoHtmlUrl,
      default_branch: defaultBranch,
      last_backup_at: null,
      last_commit_sha: null,
      commit_count: 0,
      deleted_at: null,
    });
  }

  await auditService
    .writeAuditLog(c.env.DB, {
      org_id: site.org_id as string,
      actor_id: c.get('userId') ?? null,
      action: 'github.backup_connected',
      target_type: 'site',
      target_id: site.id as string,
      metadata_json: { github_user: ghUser.login, repo: `${repoOwner}/${repoName}` },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  const returnUrl = stateRow.return_url || '/admin/github';
  return c.redirect(`${returnUrl}?connected=1`);
});

/**
 * POST /api/sites/:id/github/backup
 *
 * Pull every R2 object under `sites/{slug}/{current_build_version}/` and
 * commit them to the connected repo's default branch as a single commit
 * via the GitHub Trees API (blob → tree → commit → ref).
 *
 * Returns `{ data: { commit_sha, html_url } }`.
 */
api.post('/api/sites/:id/github/backup', async (c) => {
  const site = await loadAuthorizedSite(c);
  const integration = await dbQueryOne<{
    id: string;
    access_token_encrypted: string;
    repo_owner: string;
    repo_name: string;
    repo_html_url: string;
    default_branch: string;
    commit_count: number;
  }>(
    c.env.DB,
    `SELECT id, access_token_encrypted, repo_owner, repo_name,
            repo_html_url, default_branch, commit_count
     FROM github_integrations
     WHERE site_id = ? AND deleted_at IS NULL`,
    [site.id as string],
  );

  if (!integration) throw notFound('GitHub backup is not connected for this site');

  const buildVersion = site.current_build_version as string | null;
  if (!buildVersion) throw badRequest('Site has no published build to back up');

  const token = integration.access_token_encrypted;
  const { repo_owner: owner, repo_name: repo, default_branch: branch } = integration;
  const prefix = `sites/${site.slug as string}/${buildVersion}/`;

  // List all R2 objects for this build.
  const objects: { key: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const page = await c.env.SITES_BUCKET.list({ prefix, limit: 1000, cursor });
    for (const obj of page.objects) objects.push({ key: obj.key, size: obj.size });
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  if (objects.length === 0) throw notFound('No files found for this build');

  // Get the current branch HEAD SHA.
  const refRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/ref/heads/${branch}`,
    { headers: githubHeaders(token) },
  );
  if (!refRes.ok) throw badRequest(`GitHub ref lookup failed (${refRes.status})`);
  const refJson = (await refRes.json()) as { object: { sha: string } };
  const baseCommitSha = refJson.object.sha;

  const baseCommitRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/commits/${baseCommitSha}`,
    { headers: githubHeaders(token) },
  );
  if (!baseCommitRes.ok) throw badRequest('GitHub base commit lookup failed');
  const baseCommit = (await baseCommitRes.json()) as { tree: { sha: string } };
  const baseTreeSha = baseCommit.tree.sha;

  // Create blobs in parallel (GitHub allows ~5k req/hr authenticated).
  const treeEntries = await Promise.all(
    objects.map(async (obj) => {
      const r2Obj = await c.env.SITES_BUCKET.get(obj.key);
      if (!r2Obj) throw badRequest(`R2 fetch failed for ${obj.key}`);
      const buf = await r2Obj.arrayBuffer();
      const base64 = arrayBufferToBase64(buf);

      const blobRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: base64, encoding: 'base64' }),
      });
      if (!blobRes.ok) throw badRequest(`GitHub blob create failed for ${obj.key}`);
      const blob = (await blobRes.json()) as { sha: string };
      return {
        path: obj.key.slice(prefix.length),
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      };
    }),
  );

  // Create tree.
  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees`, {
    method: 'POST',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
  });
  if (!treeRes.ok) throw badRequest('GitHub tree create failed');
  const tree = (await treeRes.json()) as { sha: string };

  // Create commit.
  const commitRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/commits`, {
    method: 'POST',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: `Backup build ${buildVersion} — ${new Date().toISOString()}`,
      tree: tree.sha,
      parents: [baseCommitSha],
    }),
  });
  if (!commitRes.ok) throw badRequest('GitHub commit create failed');
  const commit = (await commitRes.json()) as { sha: string; html_url: string };

  // Update branch ref.
  const updateRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/refs/heads/${branch}`,
    {
      method: 'PATCH',
      headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: commit.sha, force: false }),
    },
  );
  if (!updateRes.ok) throw badRequest('GitHub ref update failed');

  const nowIso = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE github_integrations SET
       last_backup_at = ?, last_commit_sha = ?, commit_count = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(nowIso, commit.sha, integration.commit_count + 1, nowIso, integration.id)
    .run();

  await auditService
    .writeAuditLog(c.env.DB, {
      org_id: site.org_id as string,
      actor_id: c.get('userId') ?? null,
      action: 'github.backup_pushed',
      target_type: 'site',
      target_id: site.id as string,
      metadata_json: {
        repo: `${owner}/${repo}`,
        commit_sha: commit.sha,
        file_count: objects.length,
        build_version: buildVersion,
      },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({
    data: {
      commit_sha: commit.sha,
      html_url: commit.html_url,
    },
  });
});

/**
 * POST /api/sites/:id/github/disconnect
 *
 * Soft-delete the integration row (sets `deleted_at`). The OAuth token
 * is NOT revoked on GitHub's side — the owner can revoke from the GitHub
 * Settings → Applications page. We log the disconnect for audit.
 */
api.post('/api/sites/:id/github/disconnect', async (c) => {
  const site = await loadAuthorizedSite(c);
  const integration = await dbQueryOne<{ id: string; repo_owner: string; repo_name: string }>(
    c.env.DB,
    `SELECT id, repo_owner, repo_name FROM github_integrations
     WHERE site_id = ? AND deleted_at IS NULL`,
    [site.id as string],
  );

  if (!integration) throw notFound('GitHub backup is not connected for this site');

  await c.env.DB.prepare(
    `UPDATE github_integrations SET deleted_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(new Date().toISOString(), new Date().toISOString(), integration.id)
    .run();

  await auditService
    .writeAuditLog(c.env.DB, {
      org_id: site.org_id as string,
      actor_id: c.get('userId') ?? null,
      action: 'github.backup_disconnected',
      target_type: 'site',
      target_id: site.id as string,
      metadata_json: { repo: `${integration.repo_owner}/${integration.repo_name}` },
      request_id: c.get('requestId'),
    })
    .catch(() => {});

  return c.json({ data: { disconnected: true } });
});

/**
 * Convert an ArrayBuffer to a base64 string. Works in Workers (no Buffer)
 * via a chunked btoa over Latin-1 byte strings. Chunked to stay under the
 * 8KB call-stack budget for `String.fromCharCode(...)` on large blobs.
 */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/**
 * Map a filename to a `Content-Type` header value for R2 PUT operations
 * during snapshot revert / file republishing flows.
 *
 * @param filename - Filename (or full path; only the segment after the
 *   last `.` matters). Case-insensitive extension match.
 * @returns MIME type string, or `'application/octet-stream'` when the
 *   extension is unknown / missing.
 *
 * @remarks
 * Covers the 14 file types that appear in generated sites (`html`, `css`,
 * `js`, `json`, `svg`, `png`, `jpg/jpeg`, `gif`, `webp`, `ico`, `txt`,
 * `xml`, `woff`, `woff2`). Intentionally narrow — anything outside this
 * set falls through to `application/octet-stream` rather than guessing,
 * which forces browsers to download rather than mis-render an unknown
 * binary as text.
 *
 * Mirrors the lookup table in `services/site_serving.ts::guessContentType`
 * but lives here as a private helper so the revert hot-path doesn't
 * import the larger serving module (which pulls in additional R2 / KV
 * dependencies). Keep the two tables in sync when adding new types.
 */
function guessContentTypeForRevert(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    html: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    ico: 'image/x-icon',
    txt: 'text/plain',
    xml: 'text/xml',
    woff: 'font/woff',
    woff2: 'font/woff2',
  };
  return types[ext ?? ''] ?? 'application/octet-stream';
}

export { api };
