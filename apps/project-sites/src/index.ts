import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Variables } from './types/env.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error-handler.js';
import { payloadLimitMiddleware } from './middleware/payload-limit.js';
import { securityHeadersMiddleware } from './middleware/security-headers.js';
import { health } from './routes/health.js';
import { api } from './routes/api.js';
import { webhooks } from './routes/webhooks.js';
import { createServiceClient } from './services/db.js';
import { resolveSite, serveSiteFromR2 } from './services/site-serving.js';
import { DOMAINS } from '@project-sites/shared';

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
app.route('/', webhooks);

// ─── Site Serving (catch-all for subdomain routing) ──────────

app.all('*', async (c) => {
  const hostname = c.req.header('host') ?? '';
  const url = new URL(c.req.url);
  const path = url.pathname;

  // Skip if this is the main marketing site
  if (
    hostname === DOMAINS.SITES_BASE ||
    hostname === DOMAINS.SITES_STAGING ||
    hostname === `www.${DOMAINS.SITES_BASE}`
  ) {
    // TODO: Serve marketing site from R2
    return c.json(
      {
        name: 'Project Sites',
        tagline: 'Your website\u2014handled. Finally.',
        version: '0.1.0',
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
  async queue(batch: MessageBatch, _env: Env): Promise<void> {
    for (const message of batch.messages) {
      try {
        const payload = message.body as Record<string, unknown>;
        console.warn(
          JSON.stringify({
            level: 'info',
            service: 'queue',
            message: `Processing job: ${payload.job_name}`,
            job_id: payload.job_id,
            attempt: payload.attempt,
          }),
        );

        // TODO: Route to specific job handlers
        // - generate_site
        // - run_lighthouse
        // - provision_domain
        // - send_notification

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
