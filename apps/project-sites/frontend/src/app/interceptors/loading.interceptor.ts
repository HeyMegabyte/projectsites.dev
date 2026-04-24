import { type HttpInterceptorFn, HttpRequest, type HttpHandlerFn, type HttpEvent } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { LoadingService } from '../services/loading.service';

/**
 * Functional HTTP interceptor that automatically tracks loading state for API calls.
 *
 * @remarks
 * Sets a loading key based on the request method and URL path.
 * The key format is `{METHOD}:{path}` (e.g., `GET:/api/sites`).
 * Also increments a global `http` key so consumers can detect any active request.
 */
export const loadingInterceptor: HttpInterceptorFn = (
  req: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> => {
  const loading = inject(LoadingService);
  // Use path only — never expose query params (may contain tokens/PII)
  const url = new URL(req.url, window.location.origin);
  const key = `${req.method}:${url.pathname}`;

  loading.startLoading(key);
  loading.startLoading('http');

  return next(req).pipe(
    finalize(() => {
      loading.stopLoading(key);
      loading.stopLoading('http');
    }),
  );
};
