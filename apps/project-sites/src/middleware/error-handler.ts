import type { ErrorHandler } from 'hono';
import { AppError } from '@project-sites/shared';
import { ZodError } from 'zod';
import type { Env, Variables } from '../types/env.js';

/**
 * Global error handler.
 * Converts known errors to typed JSON responses.
 * Logs structured error details for observability.
 */
export const errorHandler: ErrorHandler<{
  Bindings: Env;
  Variables: Variables;
}> = (err, c) => {
  const requestId = c.get('requestId') ?? 'unknown';

  // AppError: known typed errors
  if (err instanceof AppError) {
    console.error(
      JSON.stringify({
        level: err.statusCode >= 500 ? 'error' : 'warn',
        code: err.code,
        message: err.message,
        request_id: requestId,
        status: err.statusCode,
      }),
    );

    return c.json(err.toJSON(), err.statusCode as 400);
  }

  // ZodError: validation failures
  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));

    console.error(
      JSON.stringify({
        level: 'warn',
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        request_id: requestId,
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

  // Unknown errors: log full details, return generic message
  console.error(
    JSON.stringify({
      level: 'error',
      code: 'INTERNAL_ERROR',
      message: err instanceof Error ? err.message : 'Unknown error',
      request_id: requestId,
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );

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
