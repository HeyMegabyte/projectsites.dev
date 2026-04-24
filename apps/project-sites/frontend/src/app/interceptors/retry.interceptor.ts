import { type HttpInterceptorFn, HttpRequest, type HttpHandlerFn, type HttpEvent, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, timer } from 'rxjs';
import { retry, catchError } from 'rxjs/operators';

/** Status codes that are safe to retry (server errors + network failures). */
const RETRYABLE_STATUSES = new Set([0, 500, 502, 503, 504]);

/** HTTP methods safe to retry (idempotent). POST/DELETE are never retried. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT']);

/** Maximum number of retry attempts. */
const MAX_RETRIES = 2;

/** Base delay in milliseconds for exponential backoff. */
const BASE_DELAY_MS = 1000;

/**
 * Functional HTTP interceptor that retries failed requests with exponential backoff.
 *
 * @remarks
 * - Adds X-Request-ID header to every outgoing request for tracing.
 * - Only retries idempotent methods (GET, HEAD, OPTIONS, PUT).
 * - Only retries server errors (500-504) and network failures (status 0).
 * - Client errors (400, 401, 403, 404, 409, 422) are never retried.
 * - Uses exponential backoff: 1s, 2s between retries.
 */
export const retryInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const requestId = crypto.randomUUID();
  const cloned = req.clone({
    setHeaders: { 'X-Request-ID': requestId },
  });

  return next(cloned).pipe(
    retry({
      count: MAX_RETRIES,
      delay: (error: unknown, retryCount: number) => {
        // Never retry non-idempotent methods (POST, DELETE, PATCH)
        if (!SAFE_METHODS.has(cloned.method)) {
          return throwError(() => error);
        }
        if (
          error instanceof HttpErrorResponse &&
          RETRYABLE_STATUSES.has(error.status)
        ) {
          const delay = BASE_DELAY_MS * Math.pow(2, retryCount - 1);
          return timer(delay);
        }
        return throwError(() => error);
      },
    }),
    catchError((error: unknown) => {
      return throwError(() => error);
    }),
  );
};
