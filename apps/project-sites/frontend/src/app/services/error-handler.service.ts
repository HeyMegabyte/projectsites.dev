import { ErrorHandler, Injectable, inject, NgZone } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { ToastService } from './toast.service';

/** Maps HTTP status codes to user-friendly messages. */
function httpStatusMessage(status: number): string {
  switch (status) {
    case 400:
      return 'The request was invalid. Please check your input.';
    case 401:
      return 'Your session expired. Please sign in again.';
    case 403:
      return "You don't have permission to do that.";
    case 404:
      return "That resource wasn't found.";
    case 409:
      return 'A conflict occurred. Please refresh and try again.';
    case 422:
      return 'Some of the submitted data is invalid.';
    case 429:
      return 'Too many requests. Please wait a moment.';
    case 500:
    case 502:
    case 503:
    case 504:
      return "Something went wrong on our end. We're looking into it.";
    default:
      return status >= 500
        ? "Something went wrong. We're looking into it."
        : 'An unexpected error occurred. Please try again.';
  }
}

/** Detects if the error is a network connectivity issue (no internet, DNS failure, etc). */
function isNetworkError(error: HttpErrorResponse): boolean {
  return error.status === 0 || error.statusText === 'Unknown Error';
}

/**
 * Global error handler that catches all unhandled errors in the application.
 * Logs structured data and shows user-friendly toast notifications.
 *
 * @remarks
 * Registered as the application-wide ErrorHandler in app.config.ts.
 * Never exposes raw error messages to the user.
 */
/** Max toast errors per window to avoid spam. */
const MAX_TOASTS_PER_WINDOW = 5;
const TOAST_WINDOW_MS = 30_000;

@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private toast = inject(ToastService);
  private router = inject(Router);
  private zone = inject(NgZone);

  /** Rate limiter: track toast timestamps. */
  private toastTimestamps: number[] = [];

  handleError(error: unknown): void {
    const timestamp = new Date().toISOString();
    const route = this.router.url;
    const userAgent = navigator.userAgent;

    // Skip HttpErrorResponse — already handled by individual services/interceptors
    if (error instanceof HttpErrorResponse) return;

    this.handleGenericError(error, { timestamp, route, userAgent });
  }

  private handleHttpError(
    error: HttpErrorResponse,
    context: { timestamp: string; route: string; userAgent: string },
  ): void {
    const message = isNetworkError(error)
      ? 'You seem to be offline. Check your connection and try again.'
      : httpStatusMessage(error.status);

    console.warn('[GlobalErrorHandler] HTTP error', {
      status: error.status,
      url: error.url,
      message: error.message,
      route: context.route,
      timestamp: context.timestamp,
      userAgent: context.userAgent,
    });

    this.zone.run(() => {
      this.toast.error(message);
    });
  }

  private handleGenericError(
    error: unknown,
    context: { timestamp: string; route: string; userAgent: string },
  ): void {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.warn('[GlobalErrorHandler] Unhandled error', {
      message: errorMessage,
      stack: errorStack,
      route: context.route,
      timestamp: context.timestamp,
      userAgent: context.userAgent,
    });

    this.zone.run(() => {
      if (this.canShowToast()) {
        this.toast.error('Something unexpected happened. Please try again.');
      }
    });
  }

  /** Rate-limit toasts to avoid spam during error storms. */
  private canShowToast(): boolean {
    const now = Date.now();
    this.toastTimestamps = this.toastTimestamps.filter(t => now - t < TOAST_WINDOW_MS);
    if (this.toastTimestamps.length >= MAX_TOASTS_PER_WINDOW) return false;
    this.toastTimestamps.push(now);
    return true;
  }
}
