import type { ErrorHandler } from 'hono';
import { AppError } from '@project-sites/shared';
import { ZodError } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { captureError } from '../lib/sentry.js';
import * as posthog from '../lib/posthog.js';

/**
 * Global error handler.
 * Converts known errors to typed JSON responses.
 * Reports errors to Sentry and PostHog for observability.
 */
export const errorHandler: ErrorHandler<{
  Bindings: Env;
  Variables: Variables;
}> = (err, c) => {
  const requestId = c.get('requestId') ?? 'unknown';
  const url = c.req.url;
  const method = c.req.method;

  // Safely access executionCtx (not available in test environments)
  let ctx: ExecutionContext | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    // executionCtx not available outside Workers runtime
  }

  // AppError: known typed errors
  if (err instanceof AppError) {
    console.warn(
      JSON.stringify({
        level: err.statusCode >= 500 ? 'error' : 'warn',
        code: err.code,
        message: err.message,
        request_id: requestId,
        status: err.statusCode,
        url,
        method,
      }),
    );

    // Report 5xx to Sentry
    if (err.statusCode >= 500) {
      captureError(c, err, { code: err.code, url, method });
      if (ctx) {
        posthog.trackError(c.env, ctx, err.code, err.message, {
          request_id: requestId,
          status: err.statusCode,
          url,
        });
      }
    }

    return c.json(err.toJSON(), err.statusCode as 400);
  }

  // ZodError: validation failures (duck-type check handles multiple zod instances in monorepo)
  const isZodError = err instanceof ZodError ||
    (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as ZodError).issues));
  if (isZodError) {
    const zodErr = err as ZodError;
    const issues = zodErr.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));

    console.warn(
      JSON.stringify({
        level: 'warn',
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        request_id: requestId,
        url,
        method,
        issues,
      }),
    );

    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          request_id: requestId,
          details: { issues },
        },
      },
      400,
    );
  }

  // Unknown errors: log full details, report to Sentry, return generic message
  const errorMessage = err instanceof Error ? err.message : 'Unknown error';
  const errorStack = err instanceof Error ? err.stack : undefined;

  console.warn(
    JSON.stringify({
      level: 'error',
      code: 'INTERNAL_ERROR',
      message: errorMessage,
      request_id: requestId,
      url,
      method,
      stack: errorStack,
    }),
  );

  // Always report unknown errors to Sentry
  captureError(c, err, { url, method, request_id: requestId });
  if (ctx) {
    posthog.trackError(c.env, ctx, 'INTERNAL_ERROR', errorMessage, {
      request_id: requestId,
      url,
    });
  }

  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        request_id: requestId,
      },
    },
    500,
  );
};
