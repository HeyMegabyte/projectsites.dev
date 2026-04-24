/**
 * @module services/retry
 * @description Retry with exponential backoff + jitter for external API calls.
 *
 * Provides transient error classification and structured retry logic.
 * Only retries errors that are likely to succeed on retry (timeouts, rate limits,
 * server errors, network failures). Permanent errors (auth, validation, not found)
 * are thrown immediately.
 *
 * @packageDocumentation
 */

/**
 * Error category for structured logging and retry decisions.
 */
export type ErrorCategory =
  | 'timeout'
  | 'rate_limit'
  | 'auth'
  | 'server_error'
  | 'network'
  | 'validation'
  | 'unknown';

/**
 * Options for the retry utility.
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3). */
  maxRetries?: number;
  /** Base delay in milliseconds before first retry (default: 1000). */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds (default: 30000). */
  maxDelayMs?: number;
  /** Custom predicate to determine if an error is retryable (default: isTransientError). */
  retryOn?: (error: unknown) => boolean;
  /** Callback invoked before each retry attempt for logging/telemetry. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
}

/**
 * Extract HTTP status code from an error, if present.
 *
 * @param error - The error to inspect
 * @returns The HTTP status code, or undefined if not determinable
 */
function extractStatusCode(error: unknown): number | undefined {
  if (error instanceof Error) {
    // Match patterns like "API error 429:" or "status 503"
    const match = error.message.match(/\b(4\d{2}|5\d{2})\b/);
    if (match) return parseInt(match[1], 10);
  }
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.status === 'number') return obj.status;
    if (typeof obj.statusCode === 'number') return obj.statusCode;
  }
  return undefined;
}

/**
 * Classify an error into a category for logging and retry decisions.
 *
 * @param error - The error to classify
 * @returns One of the predefined error categories
 *
 * @example
 * ```ts
 * try {
 *   await callAPI();
 * } catch (err) {
 *   const category = classifyError(err);
 *   console.warn(JSON.stringify({ category, message: err.message }));
 * }
 * ```
 */
export function classifyError(error: unknown): ErrorCategory {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    const name = error.name.toLowerCase();

    // Timeout errors
    if (
      name === 'aborterror' ||
      name === 'timeouterror' ||
      msg.includes('timeout') ||
      msg.includes('aborted') ||
      msg.includes('timed out')
    ) {
      return 'timeout';
    }

    // Network errors
    if (
      name === 'typeerror' && (msg.includes('fetch') || msg.includes('network')) ||
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('enotfound') ||
      msg.includes('network') ||
      msg.includes('dns') ||
      msg.includes('socket')
    ) {
      return 'network';
    }

    // Check HTTP status codes
    const status = extractStatusCode(error);
    if (status === 429) return 'rate_limit';
    if (status === 401 || status === 403) return 'auth';
    if (status === 400 || status === 422) return 'validation';
    if (status !== undefined && status >= 500 && status <= 503) return 'server_error';
  }

  // Check for object-shaped errors with status
  const status = extractStatusCode(error);
  if (status === 429) return 'rate_limit';
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 422) return 'validation';
  if (status !== undefined && status >= 500 && status <= 503) return 'server_error';

  return 'unknown';
}

/**
 * Determine whether an error is transient (retryable) or permanent.
 *
 * Transient errors (returns true):
 * - Timeouts (AbortError, deadline exceeded)
 * - Rate limits (HTTP 429)
 * - Server errors (HTTP 500, 502, 503)
 * - Network failures (ECONNREFUSED, ECONNRESET, DNS failures)
 *
 * Permanent errors (returns false):
 * - Bad request (HTTP 400)
 * - Unauthorized (HTTP 401)
 * - Forbidden (HTTP 403)
 * - Not found (HTTP 404)
 * - Validation (HTTP 422)
 *
 * @param error - The error to evaluate
 * @returns true if the error is likely transient and worth retrying
 *
 * @example
 * ```ts
 * if (isTransientError(err)) {
 *   // Safe to retry
 * } else {
 *   // Permanent failure, surface to user
 * }
 * ```
 */
export function isTransientError(error: unknown): boolean {
  const category = classifyError(error);
  return (
    category === 'timeout' ||
    category === 'rate_limit' ||
    category === 'server_error' ||
    category === 'network'
  );
}

/**
 * Retry a function with exponential backoff + jitter.
 *
 * Only retries transient failures by default. Permanent errors (auth, validation)
 * are thrown immediately without consuming retry budget.
 *
 * @param fn - The async function to execute (and potentially retry)
 * @param options - Retry configuration
 * @returns The result of the function on success
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => callOpenAI(apiKey, model, opts),
 *   {
 *     maxRetries: 3,
 *     baseDelayMs: 1000,
 *     onRetry: (attempt, err, delay) => {
 *       console.warn(`Retry ${attempt} after ${delay}ms: ${err}`);
 *     },
 *   },
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const maxDelayMs = options?.maxDelayMs ?? 30_000;
  const retryOn = options?.retryOn ?? isTransientError;
  const onRetry = options?.onRetry;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Don't retry if this is the last attempt or the error is not retryable
      if (attempt === maxRetries || !retryOn(err)) {
        throw err;
      }

      // Exponential backoff with jitter, capped at maxDelayMs
      const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * baseDelayMs * 0.5;
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      if (onRetry) {
        onRetry(attempt + 1, err, delay);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}
