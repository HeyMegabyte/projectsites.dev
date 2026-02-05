import type { ApiErrorCode } from '../schemas/api.js';

/**
 * Typed application error with HTTP status code and error code.
 */
export class AppError extends Error {
  public readonly code: ApiErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly requestId?: string;

  constructor(opts: {
    code: ApiErrorCode;
    message: string;
    statusCode: number;
    details?: Record<string, unknown>;
    requestId?: string;
    cause?: Error;
  }) {
    super(opts.message, { cause: opts.cause });
    this.name = 'AppError';
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.details = opts.details;
    this.requestId = opts.requestId;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        request_id: this.requestId,
        details: this.details,
      },
    };
  }
}

/** Helper factory functions */
export function badRequest(message: string, details?: Record<string, unknown>): AppError {
  return new AppError({ code: 'BAD_REQUEST', message, statusCode: 400, details });
}

export function unauthorized(message = 'Unauthorized'): AppError {
  return new AppError({ code: 'UNAUTHORIZED', message, statusCode: 401 });
}

export function forbidden(message = 'Forbidden'): AppError {
  return new AppError({ code: 'FORBIDDEN', message, statusCode: 403 });
}

export function notFound(message = 'Not found'): AppError {
  return new AppError({ code: 'NOT_FOUND', message, statusCode: 404 });
}

export function conflict(message: string): AppError {
  return new AppError({ code: 'CONFLICT', message, statusCode: 409 });
}

export function payloadTooLarge(message = 'Payload too large'): AppError {
  return new AppError({ code: 'PAYLOAD_TOO_LARGE', message, statusCode: 413 });
}

export function rateLimited(message = 'Rate limit exceeded'): AppError {
  return new AppError({ code: 'RATE_LIMITED', message, statusCode: 429 });
}

export function internalError(message = 'Internal server error', cause?: Error): AppError {
  return new AppError({ code: 'INTERNAL_ERROR', message, statusCode: 500, cause });
}

export function validationError(message: string, details?: Record<string, unknown>): AppError {
  return new AppError({ code: 'VALIDATION_ERROR', message, statusCode: 400, details });
}
