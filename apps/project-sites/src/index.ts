import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Variables } from './types/env.js';
import { requestIdMiddleware } from './middleware/request_id.js';
import { errorHandler } from './middleware/error_handler.js';
import { payloadLimitMiddleware } from './middleware/payload_limit.js';
import { securityHeadersMiddleware } from './middleware/security_headers.js';
import { health } from './routes/health.js';
import { api } from './routes/api.js';
import { search } from './routes/search.js';
import { webhooks } from './routes/webhooks.js';
import { createServiceClient } from './services/db.js';
import { resolveSite, serveSiteFromR2 } from './services/site_serving.js';
import { registerAllPrompts } from './services/ai_workflows.js';
import { DOMAINS } from '@project-sites/shared';

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

// Global error handler
app.onError(errorHandler);

// ─── Mount Routes ────────────────────────────────────────────

app.route('/', health);
app.route('/', api);
app.route('/', search);
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
    const marketingAsset = await c.env.SITES_BUCKET.get(marketingPath);

    if (marketingAsset) {
      const ext = marketingPath.split('.').pop()?.toLowerCase() ?? 'html';
      const mimeTypes: Record<string, string> = {
        html: 'text/html',
        css: 'text/css',
        js: 'application/javascript',
        json: 'application/json',
        png: 'image/png',
        jpg: 'image/jpeg',
        svg: 'image/svg+xml',
        ico: 'image/x-icon',
      };
      return new Response(marketingAsset.body, {
        headers: {
          'Content-Type': mimeTypes[ext] ?? 'application/octet-stream',
          'Cache-Control': 'public, max-age=60',
        },
      });
    }

    // Fallback: return JSON info when no static assets deployed
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

  // Resolve the site from hostname
  const db = createServiceClient(c.env);
  const site = await resolveSite(c.env, db, hostname);

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
          const { supabaseQuery } = await import('./services/db.js');
          const db = {
            url: env.SUPABASE_URL,
            headers: {
              apikey: env.SUPABASE_SERVICE_ROLE_KEY,
              Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
              Prefer: 'return=representation',
            },
            fetch: globalThis.fetch.bind(globalThis),
          };

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

          // Update site record
          await supabaseQuery(db, 'sites', {
            method: 'PATCH',
            query: `id=eq.${siteId}`,
            body: {
              status: 'published',
              current_build_version: version,
              updated_at: new Date().toISOString(),
            },
          });

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
   * Scheduled handler for periodic tasks.
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
