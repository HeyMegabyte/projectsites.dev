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
import { assets } from './routes/assets.js';
import { resolveSite, serveSiteFromR2 } from './services/site_serving.js';
import { dbUpdate } from './services/db.js';
import { registerAllPrompts } from './services/ai_workflows.js';
import { DOMAINS } from '@project-sites/shared';
export { SiteGenerationWorkflow } from './workflows/site-generation.js';
export { SiteBuilderContainer } from './container.js';

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

// Permissive CORS for *.projectsites.dev on ALL routes (sites loaded in iframes, cross-subdomain requests)
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (!origin) return '';
      const allowed = [
        `https://${DOMAINS.SITES_BASE}`,
        `https://${DOMAINS.BOLT_BASE}`,
        'http://localhost:3000',
        'http://localhost:4200',
        'http://localhost:4300',
        'http://localhost:5173',
      ];
      if (allowed.includes(origin)) return origin;
      // Allow any subdomain of projectsites.dev
      if (origin.endsWith(DOMAINS.SITES_SUFFIX)) return origin;
      // Allow any *.projectsites.dev origin (including deeply nested subdomains)
      if (origin.endsWith(`.${DOMAINS.SITES_BASE}`)) return origin;
      return '';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    credentials: true,
    maxAge: 86400,
  }),
);

// Rate limiting on sensitive endpoints
import { rateLimitMiddleware } from './middleware/rate_limit.js';
app.use('/api/auth/magic-link', rateLimitMiddleware({ maxRequests: 5, windowSeconds: 300, prefix: 'rl:magic' }));
app.use('/api/search/businesses', rateLimitMiddleware({ maxRequests: 30, windowSeconds: 60, prefix: 'rl:search' }));
app.use('/api/sites/create-from-search', rateLimitMiddleware({ maxRequests: 10, windowSeconds: 3600, prefix: 'rl:create' }));
app.use('/api/ai/*', rateLimitMiddleware({ maxRequests: 20, windowSeconds: 60, prefix: 'rl:ai' }));

// Auth middleware for API routes (sets userId/orgId if valid session)
app.use('/api/*', authMiddleware);

// Global error handler
app.onError(errorHandler);

// ─── Mount Routes ────────────────────────────────────────────

app.route('/', health);
app.route('/', search);  // Must come before api so /api/sites/search wins over /api/sites/:id
app.route('/', assets);  // Asset uploads + build-assets listing
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
    hostname === `www.${DOMAINS.SITES_BASE}` ||
    hostname.startsWith('localhost')
  ) {
    // /contact redirects to contact section on homepage
    if (path === '/contact') {
      return Response.redirect(`https://${DOMAINS.SITES_BASE}/#contact-section`, 301);
    }

    // Angular SPA handles all routes — serve index.html for non-file paths
    const hasExtension = path.includes('.') && !path.endsWith('/');
    const marketingPath = hasExtension ? `marketing${path}` : 'marketing/index.html';
    const marketingAsset = await c.env.SITES_BUCKET.get(marketingPath);

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
        woff2: 'font/woff2',
      };

      // For HTML, inject runtime env vars (PostHog key, Stripe publishable key)
      if (ext === 'html') {
        let html = await marketingAsset.text();
        const phKey = c.env.POSTHOG_API_KEY ?? 'none';
        const stripePk = c.env.STRIPE_PUBLISHABLE_KEY ?? '';
        html = html.replace('</head>', `<meta name="x-posthog-key" content="${phKey}">\n<meta name="x-stripe-pk" content="${stripePk}">\n</head>`);
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

  // editor.projectsites.dev → proxy to Cloudflare Pages (bolt-diy)
  if (hostname === DOMAINS.BOLT_BASE) {
    const pagesUrl = `https://bolt-diy-8jf.pages.dev${path}${url.search}`;
    const pagesRes = await fetch(pagesUrl, {
      method: c.req.method,
      headers: c.req.raw.headers,
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
    });
    const res = new Response(pagesRes.body, {
      status: pagesRes.status,
      headers: pagesRes.headers,
    });
    // Cross-origin isolation required for SharedArrayBuffer (WebContainers)
    res.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
    res.headers.set('Origin-Agent-Cluster', '?1');
    // CORS so editor can talk to projectsites.dev API
    res.headers.set('Access-Control-Allow-Origin', `https://${DOMAINS.BOLT_BASE}`);
    res.headers.set('Access-Control-Allow-Credentials', 'true');
    return res;
  }

  // Resolve the site from hostname using D1
  const site = await resolveSite(c.env, c.env.DB, hostname);

  if (!site) {
    const reqId = c.get('requestId') || 'unknown';
    const errorHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not Found | ProjectSites</title><link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400;500&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0f;color:#e0e0e0;font-family:'Space Grotesk',sans-serif;overflow:hidden}@keyframes glitch{0%,100%{transform:translate(0)}20%{transform:translate(-2px,2px)}40%{transform:translate(2px,-2px)}60%{transform:translate(-1px,-1px)}80%{transform:translate(1px,1px)}}@keyframes scanline{0%{top:-100%}100%{top:100%}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}@keyframes gradient{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}.container{text-align:center;max-width:600px;padding:2rem;position:relative;z-index:1}.bg{position:fixed;inset:0;background:linear-gradient(-45deg,#0a0a0f,#0d1117,#0a1628,#0f0a1e);background-size:400% 400%;animation:gradient 8s ease infinite}.grid{position:fixed;inset:0;background-image:linear-gradient(rgba(0,255,200,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,200,.03) 1px,transparent 1px);background-size:60px 60px}.scanline{position:fixed;width:100%;height:4px;background:linear-gradient(90deg,transparent,rgba(0,255,200,.08),transparent);animation:scanline 4s linear infinite;z-index:0}.code{font-size:8rem;font-weight:700;background:linear-gradient(135deg,#00ffc8,#00d4ff,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:float 3s ease-in-out infinite;line-height:1}.msg{font-size:1.5rem;color:#8892a4;margin:1rem 0 2rem;animation:pulse 3s ease-in-out infinite}.btn{display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#00ffc8,#00d4ff);color:#0a0a0f;font-weight:600;border-radius:50px;text-decoration:none;transition:all .3s;font-family:inherit}.btn:hover{transform:translateY(-3px);box-shadow:0 8px 30px rgba(0,255,200,.3)}.debug{margin-top:3rem;text-align:left;background:rgba(0,255,200,.04);border:1px solid rgba(0,255,200,.1);border-radius:12px;padding:1.5rem;font-family:'Fira Code',monospace;font-size:.75rem;color:#4a9;line-height:1.8}.debug-title{color:#00ffc8;font-size:.85rem;margin-bottom:.5rem;font-weight:500}.debug span{color:#667}</style></head><body><div class="bg"></div><div class="grid"></div><div class="scanline"></div><div class="container"><div class="code">404</div><p class="msg">This site doesn't exist yet</p><a class="btn" href="https://projectsites.dev/create">Build it with AI</a><div class="debug"><div class="debug-title">// debug info</div><span>hostname:</span> ${hostname}<br><span>request_id:</span> ${reqId}<br><span>timestamp:</span> ${new Date().toISOString()}<br><span>resolved:</span> null<br><span>edge:</span> ${c.req.header('cf-ray') || 'unknown'}<br><span>colo:</span> ${(c.req.raw as any).cf?.colo || 'unknown'}</div></div></body></html>`;
    return new Response(errorHtml, {
      status: 404,
      headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-cache' },
    });
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
   * Runs:
   * - Verify pending custom hostnames via Cloudflare API
   * - Log results for observability
   */
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.warn(
      JSON.stringify({
        level: 'info',
        service: 'cron',
        message: 'Scheduled task triggered',
        trigger: _event.cron,
      }),
    );

    try {
      const { verifyPendingHostnames } = await import('./services/domains.js');
      const result = await verifyPendingHostnames(env.DB, env);

      console.warn(
        JSON.stringify({
          level: 'info',
          service: 'cron',
          message: 'Hostname verification complete',
          verified: result.verified,
          failed: result.failed,
        }),
      );
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: 'error',
          service: 'cron',
          message: 'Hostname verification failed',
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }

    // Unstick stuck builds — any site in 'building' status for > 30 minutes gets marked as 'error'
    try {
      const { dbQuery, dbExecute } = await import('./services/db.js');
      const stuckSites = await dbQuery<{ id: string; slug: string; business_name: string }>(
        env.DB,
        `SELECT id, slug, business_name FROM sites
         WHERE status IN ('building', 'queued', 'generating', 'imaging', 'uploading')
         AND updated_at < datetime('now', '-30 minutes')
         AND deleted_at IS NULL`,
        [],
      );

      if (stuckSites.data.length > 0) {
        for (const site of stuckSites.data) {
          await dbExecute(
            env.DB,
            `UPDATE sites SET status = 'error', updated_at = datetime('now') WHERE id = ?`,
            [site.id],
          );
          console.warn(JSON.stringify({
            level: 'warn',
            service: 'cron',
            message: 'Unstuck build',
            siteId: site.id,
            slug: site.slug,
            businessName: site.business_name,
          }));
        }
        console.warn(JSON.stringify({
          level: 'info',
          service: 'cron',
          message: `Unstuck ${stuckSites.data.length} builds`,
        }));
      }
    } catch (err) {
      console.warn(JSON.stringify({
        level: 'error',
        service: 'cron',
        message: 'Stuck build scanner failed',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  },
};
