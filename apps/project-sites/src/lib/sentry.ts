/**
 * Sentry integration for Cloudflare Workers using toucan-js.
 *
 * Provides a lightweight Sentry client that works within the Workers runtime.
 * Initializes per-request to capture errors, breadcrumbs, and context.
 *
 * @module lib/sentry
 */

import { Toucan } from 'toucan-js';
import type { Context } from 'hono';
import type { Env, Variables } from '../types/env.js';

/**
 * Create a Sentry client scoped to a single request.
 *
 * @param c - Hono context (provides env bindings and request).
 * @returns Toucan instance ready for `captureException` / `captureMessage`.
 */
export function createSentry(c: Context<{ Bindings: Env; Variables: Variables }>): Toucan {
  const sentry = new Toucan({
    dsn: c.env.SENTRY_DSN,
    context: c.executionCtx,
    request: c.req.raw,
    environment: c.env.ENVIRONMENT ?? 'development',
    release: 'project-sites@0.1.0',
    sampleRate: c.env.ENVIRONMENT === 'production' ? 0.5 : 1.0,
  });

  sentry.setTag('service', 'project-sites-worker');
  sentry.setTag('request_id', c.get('requestId') ?? 'unknown');

  const userId = c.get('userId');
  if (userId) {
    sentry.setUser({ id: userId });
  }

  return sentry;
}

/**
 * Report an error to Sentry with additional context.
 *
 * Safe to call even if SENTRY_DSN is not configured (no-ops).
 */
export function captureError(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  error: unknown,
  extra?: Record<string, unknown>,
): void {
  if (!c.env.SENTRY_DSN) return;

  try {
    const sentry = createSentry(c);
    if (extra) {
      sentry.setExtras(extra);
    }
    sentry.captureException(error);
  } catch {
    // Don't let Sentry errors break the app
    console.warn(JSON.stringify({
      level: 'warn',
      service: 'sentry',
      message: 'Failed to report to Sentry',
    }));
  }
}

/**
 * Send a message-level event to Sentry.
 */
export function captureMessage(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
): void {
  if (!c.env.SENTRY_DSN) return;

  try {
    const sentry = createSentry(c);
    sentry.captureMessage(message, level);
  } catch {
    // Swallow
  }
}
