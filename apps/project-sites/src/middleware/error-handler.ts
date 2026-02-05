/**
 * Global error handler middleware with comprehensive error handling
 * - Normalizes errors to AppError
 * - Logs with proper context and PII redaction
 * - Returns consistent error responses
 * - Handles specific error types appropriately
 */

import type { ErrorHandler } from 'hono';
import type { AppEnv } from '../types';
import {
  AppError,
  normalizeError,
  createErrorResponse,
  redactPiiFromObject,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ConflictError,
} from '@project-sites/shared';
import { createLogger, type Logger } from '../lib/logger';
import { ConfigurationError } from '../lib/config';

// ============================================================================
// ERROR CLASSIFICATION
// ============================================================================

interface ErrorClassification {
  category: 'client' | 'server' | 'infrastructure' | 'unknown';
  shouldAlert: boolean;
  shouldRetry: boolean;
  logLevel: 'warn' | 'error';
}

function classifyError(error: AppError): ErrorClassification {
  // Client errors (4xx) - expected, don't need alerts
  if (error.statusCode >= 400 && error.statusCode < 500) {
    return {
      category: 'client',
      shouldAlert: false,
      shouldRetry: false,
      logLevel: error.statusCode === 401 || error.statusCode === 403 ? 'warn' : 'warn',
    };
  }

  // Server errors (5xx)
  if (error.statusCode >= 500) {
    // Infrastructure issues - may be transient
    if (
      error.code === 'DATABASE_ERROR' ||
      error.code === 'EXTERNAL_SERVICE_ERROR' ||
      error.code === 'TIMEOUT_ERROR'
    ) {
      return {
        category: 'infrastructure',
        shouldAlert: true,
        shouldRetry: true,
        logLevel: 'error',
      };
    }

    // Configuration errors - critical
    if (error.code === 'CONFIGURATION_ERROR') {
      return {
        category: 'infrastructure',
        shouldAlert: true,
        shouldRetry: false,
        logLevel: 'error',
      };
    }

    // General server errors
    return {
      category: 'server',
      shouldAlert: true,
      shouldRetry: false,
      logLevel: 'error',
    };
  }

  return {
    category: 'unknown',
    shouldAlert: true,
    shouldRetry: false,
    logLevel: 'error',
  };
}

// ============================================================================
// ERROR HANDLER
// ============================================================================

export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
  const requestId = c.get('request_id') ?? generateFallbackRequestId();
  const traceId = c.get('trace_id');
  const startTime = c.get('start_time');
  const duration = startTime ? Date.now() - startTime : undefined;

  // Normalize the error
  const appError = normalizeToAppError(error);
  const classification = classifyError(appError);

  // Create logger with request context
  const environment = (c.env.ENVIRONMENT ?? 'development') as 'development' | 'staging' | 'production';
  const logLevel = c.env.LOG_LEVEL ?? (environment === 'production' ? 'info' : 'debug');

  const logger = createLogger(
    { logLevel: logLevel as 'debug' | 'info' | 'warn' | 'error', environment },
    {
      request_id: requestId,
      trace_id: traceId,
      path: c.req.path,
      method: c.req.method,
    }
  );

  // Log the error
  logError(logger, appError, classification, {
    duration_ms: duration,
    org_id: c.get('org_id'),
    user_id: c.get('auth')?.user_id,
  });

  // Build response
  const response = createErrorResponse(appError, requestId);

  // Add retry hint header for transient errors
  if (classification.shouldRetry) {
    c.header('Retry-After', '5');
  }

  // Add deprecation warning if needed
  if (appError.code === 'DEPRECATED_ENDPOINT') {
    c.header('Deprecation', 'true');
  }

  return c.json(response, appError.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503);
};

// ============================================================================
// ERROR NORMALIZATION
// ============================================================================

function normalizeToAppError(error: unknown): AppError {
  // Already an AppError
  if (error instanceof AppError) {
    return error;
  }

  // ConfigurationError from our config module
  if (error instanceof ConfigurationError) {
    return new AppError(
      error.message,
      500,
      'CONFIGURATION_ERROR',
      { isOperational: true }
    );
  }

  // Hono HTTPException
  if (isHonoHTTPException(error)) {
    return new AppError(
      error.message || 'Request failed',
      error.status,
      httpStatusToCode(error.status),
      { isOperational: true }
    );
  }

  // Zod validation errors
  if (isZodError(error)) {
    return new ValidationError('Validation failed', formatZodErrors(error));
  }

  // Stripe errors
  if (isStripeError(error)) {
    return handleStripeError(error);
  }

  // Supabase/PostgreSQL errors
  if (isPostgresError(error)) {
    return handlePostgresError(error);
  }

  // Network/timeout errors
  if (isNetworkError(error)) {
    return new AppError(
      'Service temporarily unavailable',
      503,
      'EXTERNAL_SERVICE_ERROR',
      { isOperational: true }
    );
  }

  // Use the shared normalizeError as fallback
  return normalizeError(error);
}

// ============================================================================
// ERROR TYPE GUARDS
// ============================================================================

interface HonoHTTPException {
  status: number;
  message: string;
  name: string;
}

function isHonoHTTPException(error: unknown): error is HonoHTTPException {
  return (
    error !== null &&
    typeof error === 'object' &&
    'status' in error &&
    typeof (error as HonoHTTPException).status === 'number' &&
    'message' in error
  );
}

interface ZodError {
  name: 'ZodError';
  errors: Array<{ path: (string | number)[]; message: string }>;
}

function isZodError(error: unknown): error is ZodError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    (error as ZodError).name === 'ZodError'
  );
}

function formatZodErrors(error: ZodError): Record<string, string> {
  const formatted: Record<string, string> = {};
  for (const err of error.errors) {
    const path = err.path.join('.');
    formatted[path || 'value'] = err.message;
  }
  return formatted;
}

interface StripeError {
  type: string;
  code?: string;
  message: string;
  statusCode?: number;
}

function isStripeError(error: unknown): error is StripeError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'type' in error &&
    typeof (error as StripeError).type === 'string' &&
    (error as StripeError).type.startsWith('Stripe')
  );
}

function handleStripeError(error: StripeError): AppError {
  const statusCode = error.statusCode ?? 500;

  switch (error.type) {
    case 'StripeCardError':
      return new AppError(error.message, 402, 'PAYMENT_FAILED', {
        details: { stripe_code: error.code },
        isOperational: true,
      });
    case 'StripeRateLimitError':
      return new RateLimitError('Payment service rate limited');
    case 'StripeInvalidRequestError':
      return new ValidationError('Invalid payment request', {
        stripe_code: error.code ?? 'unknown',
      });
    case 'StripeAuthenticationError':
      return new AppError('Payment service configuration error', 500, 'CONFIGURATION_ERROR', {
        isOperational: true,
      });
    case 'StripeAPIConnectionError':
      return new AppError('Payment service unavailable', 503, 'EXTERNAL_SERVICE_ERROR', {
        isOperational: true,
      });
    default:
      return new AppError(error.message || 'Payment error', statusCode, 'PAYMENT_ERROR', {
        isOperational: true,
      });
  }
}

interface PostgresError {
  code: string;
  message: string;
  detail?: string;
  constraint?: string;
}

function isPostgresError(error: unknown): error is PostgresError {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as PostgresError).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((error as PostgresError).code)
  );
}

function handlePostgresError(error: PostgresError): AppError {
  // Unique violation
  if (error.code === '23505') {
    const field = error.constraint?.split('_').slice(1, -1).join('_') ?? 'value';
    return new ConflictError(`${field} already exists`);
  }

  // Foreign key violation
  if (error.code === '23503') {
    return new ValidationError('Referenced record does not exist', {
      constraint: error.constraint ?? 'unknown',
    });
  }

  // Check constraint violation
  if (error.code === '23514') {
    return new ValidationError('Data validation failed', {
      constraint: error.constraint ?? 'unknown',
    });
  }

  // Connection errors
  if (error.code.startsWith('08')) {
    return new AppError('Database connection error', 503, 'DATABASE_ERROR', {
      isOperational: true,
    });
  }

  // Default database error
  return new AppError('Database error', 500, 'DATABASE_ERROR', {
    isOperational: true,
  });
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && error.message.includes('fetch')) {
    return true;
  }
  if (error instanceof Error) {
    const networkMessages = ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'network', 'timeout'];
    return networkMessages.some((msg) => error.message.toLowerCase().includes(msg.toLowerCase()));
  }
  return false;
}

// ============================================================================
// LOGGING
// ============================================================================

function logError(
  logger: Logger,
  error: AppError,
  classification: ErrorClassification,
  context: Record<string, unknown>
): void {
  const logContext = {
    ...context,
    error_code: error.code,
    status_code: error.statusCode,
    is_operational: error.isOperational,
    category: classification.category,
    should_retry: classification.shouldRetry,
    details: error.details ? redactPiiFromObject(error.details) : undefined,
  };

  if (classification.logLevel === 'error') {
    logger.error(`Error: ${error.message}`, error, logContext);
  } else {
    logger.warn(`Warning: ${error.message}`, logContext);
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

function generateFallbackRequestId(): string {
  return `fallback-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function httpStatusToCode(status: number): string {
  const statusCodes: Record<number, string> = {
    400: 'BAD_REQUEST',
    401: 'UNAUTHORIZED',
    403: 'FORBIDDEN',
    404: 'NOT_FOUND',
    405: 'METHOD_NOT_ALLOWED',
    409: 'CONFLICT',
    422: 'UNPROCESSABLE_ENTITY',
    429: 'RATE_LIMITED',
    500: 'INTERNAL_ERROR',
    502: 'BAD_GATEWAY',
    503: 'SERVICE_UNAVAILABLE',
    504: 'GATEWAY_TIMEOUT',
  };
  return statusCodes[status] ?? 'UNKNOWN_ERROR';
}

// ============================================================================
// NOT FOUND HANDLER
// ============================================================================

export const notFoundHandler = (c: any) => {
  const requestId = c.get('request_id') ?? generateFallbackRequestId();

  return c.json(
    {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${c.req.method} ${c.req.path} not found`,
      },
      request_id: requestId,
    },
    404
  );
};
