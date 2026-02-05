/**
 * Project Sites Cloudflare Worker
 * Main entry point for the API and site delivery
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { timing } from 'hono/timing';
import Stripe from 'stripe';

import type { AppEnv, QueueMessage, CronContext, CloudflareBindings } from './types';
import { requestIdMiddleware } from './middleware/request-id';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { authMiddleware } from './middleware/auth';
import { dbMiddleware } from './middleware/db';
import { loadConfig, loadStripeConfig, validateRequiredSecrets, ConfigurationError } from './lib/config';
import { createLogger, logRequestCompletion, type Logger } from './lib/logger';

// Routes
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { orgRoutes } from './routes/orgs';
import { siteRoutes } from './routes/sites';
import { hostnameRoutes } from './routes/hostnames';
import { billingRoutes } from './routes/billing';
import { webhookRoutes } from './routes/webhooks';
import { adminRoutes } from './routes/admin';
import { intakeRoutes } from './routes/intake';
import { siteServeHandler } from './routes/serve';

// Queue handlers
import { handleQueueMessage } from './handlers/queue';
import { handleScheduled } from './handlers/scheduled';

// ============================================================================
// APP INITIALIZATION
// ============================================================================

const app = new Hono<AppEnv>();

// ============================================================================
// GLOBAL MIDDLEWARE
// ============================================================================

// Request ID and timing (must be first)
app.use('*', requestIdMiddleware);

// Start time tracking
app.use('*', async (c, next) => {
  c.set('start_time', Date.now());
  await next();
});

// Timing headers
app.use('*', timing());

// Secure headers
app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://challenges.cloudflare.com', 'https://js.stripe.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'", 'https://api.stripe.com', 'https://r.stripe.com'],
      frameSrc: ["'self'", 'https://js.stripe.com', 'https://challenges.cloudflare.com'],
    },
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
  })
);

// CORS configuration
app.use(
  '/api/*',
  cors({
    origin: (origin) => {
      const allowedOrigins = [
        'https://bolt.megabyte.space',
        'https://sites.megabyte.space',
        'https://sites-staging.megabyte.space',
        'http://localhost:5173',
        'http://localhost:3000',
      ];
      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return null;
      // Check if origin is in allowed list
      if (allowedOrigins.includes(origin)) return origin;
      // Allow subdomains of megabyte.space
      if (origin.endsWith('.megabyte.space')) return origin;
      return null;
    },
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Trace-ID'],
    exposeHeaders: ['X-Request-ID', 'X-Trace-ID', 'Retry-After'],
    credentials: true,
    maxAge: 86400,
  })
);

// Configuration validation and Stripe initialization
app.use('*', async (c, next) => {
  try {
    // Load and validate configuration
    const config = loadConfig(c.env);

    // Validate required secrets on first request (cached after)
    const validation = validateRequiredSecrets(c.env);
    if (!validation.valid) {
      const logger = createLogger(config);
      logger.error('Missing required secrets', undefined, {
        missing: validation.missing,
      });
      // In development, log warnings but continue
      if (config.isProduction) {
        throw new ConfigurationError(`Missing required secrets: ${validation.missing.join(', ')}`);
      }
    }

    // Log warnings for missing recommended secrets
    if (validation.warnings.length > 0 && config.isDevelopment) {
      const logger = createLogger(config);
      for (const warning of validation.warnings) {
        logger.warn(warning);
      }
    }

    // Initialize Stripe client
    if (c.env.STRIPE_SECRET_KEY) {
      const stripeConfig = loadStripeConfig(c.env, config);
      const stripe = new Stripe(stripeConfig.secretKey, {
        apiVersion: '2024-12-18.acacia',
        typescript: true,
        maxNetworkRetries: 3,
        timeout: 30000,
      });
      c.set('stripe', stripe);
    }

    await next();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      const requestId = c.get('request_id') ?? 'unknown';
      return c.json(
        {
          success: false,
          error: {
            code: 'CONFIGURATION_ERROR',
            message: 'Service configuration error. Please contact support.',
          },
          request_id: requestId,
        },
        500
      );
    }
    throw error;
  }
});

// Database client
app.use('*', dbMiddleware);

// Request logging middleware
app.use('*', async (c, next) => {
  await next();

  // Log request completion
  const config = loadConfig(c.env);
  const logger = createLogger(config, {
    request_id: c.get('request_id'),
    trace_id: c.get('trace_id'),
  });

  const startTime = c.get('start_time') ?? Date.now();
  const duration = Date.now() - startTime;

  logRequestCompletion(logger, {
    request_id: c.get('request_id') ?? 'unknown',
    method: c.req.method,
    path: c.req.path,
    status_code: c.res.status,
    duration_ms: duration,
    ip_address: c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for'),
    user_agent: c.req.header('user-agent'),
    org_id: c.get('org_id'),
    user_id: c.get('auth')?.user_id,
  });
});

// Auth (for API routes)
app.use('/api/*', authMiddleware);

// Error handler (must wrap all routes)
app.onError(errorHandler);

// Not found handler
app.notFound(notFoundHandler);

// ============================================================================
// ROUTES
// ============================================================================

// Health check (no auth required)
app.route('/health', healthRoutes);

// Public intake (no auth required)
app.route('/api/intake', intakeRoutes);

// Auth routes (partially protected)
app.route('/api/auth', authRoutes);

// Protected API routes
app.route('/api/orgs', orgRoutes);
app.route('/api/sites', siteRoutes);
app.route('/api/hostnames', hostnameRoutes);
app.route('/api/billing', billingRoutes);

// Admin routes (requires admin role)
app.route('/api/admin', adminRoutes);

// Webhook routes (no auth, signature verification instead)
app.route('/webhooks', webhookRoutes);

// Site serving (catch-all for subdomain routing)
app.get('*', siteServeHandler);

// ============================================================================
// QUEUE HANDLER
// ============================================================================

async function handleQueue(
  batch: MessageBatch<QueueMessage>,
  env: CloudflareBindings
): Promise<void> {
  const config = loadConfig(env);
  const logger = createLogger(config, { handler: 'queue' });

  logger.info(`Processing queue batch`, { message_count: batch.messages.length });

  for (const message of batch.messages) {
    const messageLogger = logger.child({
      message_id: message.id,
      message_type: message.body?.type,
      attempt: message.body?.metadata?.attempt ?? 1,
    });

    try {
      messageLogger.debug('Processing message', {
        payload_type: typeof message.body?.payload,
      });

      await handleQueueMessage(message.body, env);

      message.ack();
      messageLogger.info('Message processed successfully');
    } catch (error) {
      messageLogger.error('Message processing failed', error);

      // Check if we should retry
      const attempt = message.body?.metadata?.attempt ?? 1;
      const maxAttempts = message.body?.metadata?.max_attempts ?? 3;

      if (attempt < maxAttempts) {
        messageLogger.info(`Retrying message`, {
          current_attempt: attempt,
          max_attempts: maxAttempts,
        });
        message.retry();
      } else {
        messageLogger.error(`Message exhausted all retries, moving to DLQ`, undefined, {
          total_attempts: attempt,
        });
        // Let it go to DLQ by not retrying
        message.ack();
      }
    }
  }

  logger.info('Queue batch processing complete', {
    processed: batch.messages.length,
  });
}

// ============================================================================
// SCHEDULED HANDLER
// ============================================================================

async function handleCron(
  event: ScheduledEvent,
  env: CloudflareBindings,
  ctx: ExecutionContext
): Promise<void> {
  const config = loadConfig(env);
  const logger = createLogger(config, {
    handler: 'scheduled',
    cron: event.cron,
  });

  logger.info('Scheduled task triggered', {
    scheduled_time: new Date(event.scheduledTime).toISOString(),
  });

  const cronContext: CronContext = {
    env,
    ctx,
    cron: event.cron,
  };

  try {
    await handleScheduled(cronContext);
    logger.info('Scheduled task completed successfully');
  } catch (error) {
    logger.error('Scheduled task failed', error);
    throw error;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  fetch: app.fetch,
  queue: handleQueue,
  scheduled: handleCron,
};
