/**
 * Project Sites Cloudflare Worker
 * Main entry point - API gateway + site delivery
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';

import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandlerMiddleware } from './middleware/error-handler.js';
import { loggingMiddleware } from './middleware/logging.js';

import { healthRoutes } from './routes/health.js';
import { siteRoutes } from './routes/sites.js';
import { apiRoutes } from './routes/api/index.js';
import { webhookRoutes } from './routes/webhooks/index.js';

import type { AppContext } from './types.js';

// =============================================================================
// Create Hono App
// =============================================================================

const app = new Hono<AppContext>();

// =============================================================================
// Global Middleware
// =============================================================================

// Request ID (first, so it's available for all other middleware)
app.use('*', requestIdMiddleware);

// Timing headers
app.use('*', timing());

// Security headers
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      fontSrc: ["'self'", 'https:'],
      connectSrc: ["'self'", 'https:'],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: [],
    },
    xContentTypeOptions: 'nosniff',
    xFrameOptions: 'DENY',
    xXssProtection: '1; mode=block',
    referrerPolicy: 'strict-origin-when-cross-origin',
    strictTransportSecurity: 'max-age=31536000; includeSubDomains',
  }),
);

// CORS (configured per-route as needed)
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      // Allow requests from our domains
      const allowedOrigins = [
        'https://sites.megabyte.space',
        'https://sites-staging.megabyte.space',
        'https://bolt.megabyte.space',
        'http://localhost:5173',
        'http://localhost:8787',
      ];
      if (allowedOrigins.includes(origin)) {
        return origin;
      }
      // Check for *.sites.megabyte.space subdomains
      if (origin.match(/^https:\/\/[\w-]+\.sites\.megabyte\.space$/)) {
        return origin;
      }
      return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposeHeaders: ['X-Request-ID', 'X-Trace-ID'],
    credentials: true,
    maxAge: 86400,
  }),
);

// Logging
app.use('*', loggingMiddleware);

// Error handler (wraps everything)
app.use('*', errorHandlerMiddleware);

// =============================================================================
// Routes
// =============================================================================

// Health check endpoints
app.route('/health', healthRoutes);
app.route('/_health', healthRoutes);

// API routes
app.route('/api', apiRoutes);

// Webhook routes (no CORS, signature verification)
app.route('/webhooks', webhookRoutes);

// Site serving (catch-all for site routes)
// This handles *.sites.megabyte.space and custom hostnames
app.route('/', siteRoutes);

// =============================================================================
// Export
// =============================================================================

export default app;

// Export Durable Object classes
export { RateLimiter } from './durable-objects/rate-limiter.js';

// Export Workflow classes
export { SiteGenerationWorkflow } from './workflows/site-generation.js';
