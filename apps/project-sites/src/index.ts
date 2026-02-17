/**
 * @module index
 * @description Main entry point for the Project Sites Cloudflare Worker.
 *
 * Configures global middleware, mounts route modules, handles the
 * catch-all site-serving logic, and exports the Workers fetch/queue/scheduled
 * handlers.
 *
 * ## Middleware Stack (applied to every request)
 *
 * | Order | Middleware          | Purpose                              |
 * | ----- | ------------------- | ------------------------------------ |
 * | 1     | `requestId`         | Generate `X-Request-ID` header       |
 * | 2     | `payloadLimit`      | Reject oversized request bodies      |
 * | 3     | `securityHeaders`   | Set CSP, HSTS, X-Frame-Options       |
 * | 4     | `cors` (API only)   | CORS for `/api/*` endpoints          |
 * | 5     | `errorHandler`      | Catch + format errors as JSON        |
 *
 * ## Routing Priority
 *
 * 1. Health check (`/health`)
 * 2. Search routes (`/api/search/*`, `/api/sites/lookup`, `/api/sites/search`)
 * 3. API routes (`/api/*`) — includes `/api/sites/:id` param routes
 * 4. Webhook routes (`/webhooks/*`)
 * 5. Catch-all: marketing site or subdomain site serving
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Variables } from './types/env.js';
import { requestIdMiddleware } from './middleware/request_id.js';
import { errorHandler } from './middleware/error_handler.js';
import { payloadLimitMiddleware } from './middleware/payload_limit.js';
import { securityHeadersMiddleware } from './middleware/security_headers.js';
import { authMiddleware } from './middleware/auth.js';
import { health } from './routes/health.js';
import { api } from './routes/api.js';
import { search } from './routes/search.js';
import { webhooks } from './routes/webhooks.js';
import { resolveSite, serveSiteFromR2 } from './services/site_serving.js';
import { dbUpdate } from './services/db.js';
import { registerAllPrompts } from './services/ai_workflows.js';
import { DOMAINS } from '@project-sites/shared';
export { SiteGenerationWorkflow } from './workflows/site-generation.js';

// Register all prompt definitions at module load
registerAllPrompts();

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Global Middleware ───────────────────────────────────────

// Request ID on every request
app.use('*', requestIdMiddleware);

// Payload size limit
app.use('*', payloadLimitMiddleware);

// Security headers
app.use('*', securityHeadersMiddleware);

// CORS for API routes
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      // Allow requests from our domains
      const allowed = [
        `https://${DOMAINS.SITES_BASE}`,
        `https://${DOMAINS.SITES_STAGING}`,
        `https://${DOMAINS.BOLT_BASE}`,
        'http://localhost:3000',
        'http://localhost:5173',
      ];
      if (origin && allowed.includes(origin)) {
        return origin;
      }
      return '';
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  }),
);

// Auth middleware for API routes (sets userId/orgId if valid session)
app.use('/api/*', authMiddleware);

// Global error handler
app.onError(errorHandler);

// ─── Mount Routes ────────────────────────────────────────────

app.route('/', health);
app.route('/', search);  // Must come before api so /api/sites/search wins over /api/sites/:id
app.route('/', api);
app.route('/', webhooks);

// ─── Site Serving (catch-all for subdomain routing) ──────────

app.all('*', async (c) => {
  const hostname = c.req.header('host') ?? '';
  const url = new URL(c.req.url);
  const path = url.pathname;

  // Serve the marketing site homepage for the base domain
  if (
    hostname === DOMAINS.SITES_BASE ||
    hostname === DOMAINS.SITES_STAGING ||
    hostname === `www.${DOMAINS.SITES_BASE}` || // legacy support
    hostname.startsWith('localhost')
  ) {
    // Try to serve from R2 first (for production)
    const marketingPath = `marketing${path === '/' ? '/index.html' : path}`;
    let marketingAsset = await c.env.SITES_BUCKET.get(marketingPath);

    // Removed pages (/privacy, /terms, /content) redirect to homepage.
    // /contact scrolls to contact section on homepage.
    if (!marketingAsset && !path.includes('.') && path !== '/') {
      const redirectPaths = ['/privacy', '/terms', '/content', '/contact'];
      if (redirectPaths.includes(path)) {
        const baseUrl =
          hostname === DOMAINS.SITES_STAGING
            ? `https://${DOMAINS.SITES_STAGING}`
            : `https://${DOMAINS.SITES_BASE}`;
        const target = path === '/contact' ? `${baseUrl}/#contact-section` : `${baseUrl}/`;
        return Response.redirect(target, 301);
      }
    }

    if (marketingAsset) {
      const resolvedPath = marketingAsset.key;
      const ext = resolvedPath.split('.').pop()?.toLowerCase() ?? 'html';
      const mimeTypes: Record<string, string> = {
        html: 'text/html',
        css: 'text/css',
        js: 'application/javascript',
        json: 'application/json',
        png: 'image/png',
        jpg: 'image/jpeg',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
        xml: 'application/xml',
        webmanifest: 'application/manifest+json',
        txt: 'text/plain',
      };

      // For HTML, inject runtime env vars (PostHog key, Stripe publishable key)
      if (ext === 'html') {
        let html = await marketingAsset.text();
        const phKey = c.env.POSTHOG_API_KEY ?? 'none';
        html = html.replace('</head>', `<meta name="x-posthog-key" content="${phKey}">\n</head>`);
        return new Response(html, {
          headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'public, max-age=60',
          },
        });
      }

      return new Response(marketingAsset.body, {
        headers: {
          'Content-Type': mimeTypes[ext] ?? 'application/octet-stream',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    }

    // Final fallback: return JSON info when no static assets deployed at all
    return c.json(
      {
        name: 'Project Sites',
        tagline: 'Your website\u2014handled. Finally.',
        version: '0.1.0',
        homepage: 'Deploy the marketing site to R2 at marketing/index.html',
      },
      200,
    );
  }

  // Resolve the site from hostname using D1
  const site = await resolveSite(c.env, c.env.DB, hostname);

  if (!site) {
    return c.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Site not found',
          request_id: c.get('requestId'),
        },
      },
      404,
    );
  }

  // Check for ?chat query param (requires auth gate)
  if (url.searchParams.has('chat')) {
    // TODO: Implement chat overlay auth gate
    return c.json(
      {
        message: 'Chat overlay - authentication required',
        auth_url: `/api/auth/magic-link`,
      },
      200,
    );
  }

  // Serve static site from R2
  return serveSiteFromR2(c.env, site, path);
});

// ─── Queue Consumer ──────────────────────────────────────────

export default {
  fetch: app.fetch,

  /**
   * Queue consumer handler for workflow jobs.
   *
   * Processes queued `generate_site` jobs by running the v2 AI workflow,
   * uploading results to R2, and updating the site record in D1.
   */
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const payload = message.body as Record<string, unknown>;
        console.warn(
          JSON.stringify({
            level: 'info',
            service: 'queue',
            message: `Processing job: ${payload.job_name}`,
            site_id: payload.site_id,
          }),
        );

        if (payload.job_name === 'generate_site') {
          const { runSiteGenerationWorkflowV2 } = await import('./services/ai_workflows.js');

          const result = await runSiteGenerationWorkflowV2(env, {
            businessName: String(payload.business_name ?? ''),
            businessAddress: payload.business_address
              ? String(payload.business_address)
              : undefined,
            businessPhone: payload.business_phone
              ? String(payload.business_phone)
              : undefined,
            googlePlaceId: payload.google_place_id ? String(payload.google_place_id) : undefined,
            additionalContext: payload.additional_context
              ? String(payload.additional_context)
              : undefined,
          });

          // Upload generated files to R2
          const siteId = String(payload.site_id);
          const slug = String(payload.slug ?? payload.business_name ?? 'site')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          const version = new Date().toISOString().replace(/[:.]/g, '-');

          // Upload main page, privacy page, and terms page in parallel
          await Promise.all([
            env.SITES_BUCKET.put(`sites/${slug}/${version}/index.html`, result.html, {
              httpMetadata: { contentType: 'text/html' },
            }),
            env.SITES_BUCKET.put(`sites/${slug}/${version}/privacy.html`, result.privacyHtml, {
              httpMetadata: { contentType: 'text/html' },
            }),
            env.SITES_BUCKET.put(`sites/${slug}/${version}/terms.html`, result.termsHtml, {
              httpMetadata: { contentType: 'text/html' },
            }),
            // Store research data as JSON for future rebuilds
            env.SITES_BUCKET.put(
              `sites/${slug}/${version}/research.json`,
              JSON.stringify(result.research, null, 2),
              { httpMetadata: { contentType: 'application/json' } },
            ),
          ]);

          // Update site record in D1
          await dbUpdate(
            env.DB,
            'sites',
            {
              status: 'published',
              current_build_version: version,
            },
            'id = ?',
            [siteId],
          );

          console.warn(
            JSON.stringify({
              level: 'info',
              service: 'queue',
              message: `Site generated and published`,
              site_id: siteId,
              slug,
              version,
              quality_score: result.quality.overall,
              pages_uploaded: ['index.html', 'privacy.html', 'terms.html', 'research.json'],
            }),
          );
        }

        message.ack();
      } catch (err) {
        console.error(
          JSON.stringify({
            level: 'error',
            service: 'queue',
            message: err instanceof Error ? err.message : 'Job processing failed',
          }),
        );
        message.retry();
      }
    }
  },

  /**
   * Scheduled handler for periodic tasks (cron triggers).
   *
   * Planned tasks:
   * - Verify pending custom hostnames via Cloudflare API
   * - Dunning checks for past-due subscriptions
   * - Analytics rollup
   */
  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // TODO: Implement scheduled tasks
    // - verifyPendingHostnames
    // - dunning check
    // - analytics rollup
    console.warn(
      JSON.stringify({
        level: 'info',
        service: 'cron',
        message: 'Scheduled task triggered',
      }),
    );
  },
};
