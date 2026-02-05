/**
 * Global error handler middleware
 * Catches all errors and returns consistent error responses
 */
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';
import { redactSensitive } from '@project-sites/shared';
import type { AppContext, ApiErrorResponse } from '../types.js';

// =============================================================================
// Custom Error Classes
// =============================================================================

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthError extends ApiError {
  constructor(message: string = 'Authentication required', code: string = 'AUTH_REQUIRED') {
    super(code, message, 401);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(message: string = 'Access denied', code: string = 'FORBIDDEN') {
    super(code, message, 403);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends ApiError {
  constructor(message: string = 'Resource not found', code: string = 'NOT_FOUND') {
    super(code, message, 404);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends ApiError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends ApiError {
  constructor(message: string = 'Too many requests', retryAfter?: number) {
    super('RATE_LIMITED', message, 429, retryAfter ? { retry_after: retryAfter } : undefined);
    this.name = 'RateLimitError';
  }
}

// =============================================================================
// Error Handler Middleware
// =============================================================================

export const errorHandlerMiddleware: MiddlewareHandler<AppContext> = async (c, next) => {
  try {
    await next();
  } catch (error) {
    const requestContext = c.get('requestContext');
    const requestId = requestContext?.request_id;
    const traceId = requestContext?.trace_id;

    // Log error (redacted)
    const logData = {
      request_id: requestId,
      trace_id: traceId,
      path: c.req.path,
      method: c.req.method,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };

    console.error('[ERROR]', JSON.stringify(redactSensitive(logData)));

    // Build error response
    let response: ApiErrorResponse;
    let status: number;

    if (error instanceof ApiError) {
      status = error.statusCode;
      response = {
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
          request_id: requestId,
          trace_id: traceId,
        },
      };
    } else if (error instanceof HTTPException) {
      status = error.status;
      response = {
        error: {
          code: getCodeFromStatus(status),
          message: error.message || getMessageFromStatus(status),
          request_id: requestId,
          trace_id: traceId,
        },
      };
    } else if (error instanceof ZodError) {
      status = 400;
      response = {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request data',
          details: {
            issues: error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
          request_id: requestId,
          trace_id: traceId,
        },
      };
    } else {
      // Unknown error - don't leak internal details
      status = 500;
      response = {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred',
          request_id: requestId,
          trace_id: traceId,
        },
      };

      // TODO: Send to Sentry
      // captureException(error, { requestId, traceId });
    }

    return c.json(response, status as 400 | 401 | 403 | 404 | 429 | 500);
  }
};

// =============================================================================
// Helpers
// =============================================================================

function getCodeFromStatus(status: number): string {
  const codes: Record<number, string> = {
    400: 'INVALID_REQUEST',
    401: 'AUTH_REQUIRED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_ERROR',
    502: 'BAD_GATEWAY',
    503: 'SERVICE_UNAVAILABLE',
    504: 'GATEWAY_TIMEOUT',
  };
  return codes[status] ?? 'UNKNOWN_ERROR';
}

function getMessageFromStatus(status: number): string {
  const messages: Record<number, string> = {
    400: 'Invalid request',
    401: 'Authentication required',
    403: 'Access denied',
    404: 'Resource not found',
    405: 'Method not allowed',
    429: 'Too many requests',
    500: 'Internal server error',
    502: 'Bad gateway',
    503: 'Service unavailable',
    504: 'Gateway timeout',
  };
  return messages[status] ?? 'An error occurred';
}
