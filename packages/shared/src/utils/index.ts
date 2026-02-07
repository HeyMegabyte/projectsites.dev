/**
 * @module utils
 * @packageDocumentation
 *
 * Pure utility functions for sanitisation, PII redaction, typed application
 * errors, and cryptographic operations. All crypto helpers use the Web Crypto
 * API so they work in both Node.js and Cloudflare Workers without polyfills.
 *
 * | Export               | Source      | Description                                            |
 * | -------------------- | ---------- | ------------------------------------------------------ |
 * | `sanitizeHtml`       | `sanitize` | Strip `<script>`, event handlers, and dangerous URIs   |
 * | `stripHtml`          | `sanitize` | Remove all HTML tags from a string                     |
 * | `sanitizeSlug`       | `sanitize` | Normalize to lowercase alphanumeric + hyphens (max 63) |
 * | `businessNameToSlug` | `sanitize` | Convert a business name into a URL-safe slug           |
 * | `redact`             | `redact`   | Replace emails, phones, tokens in a log string         |
 * | `redactObject`       | `redact`   | Deep-redact sensitive keys/values in an object         |
 * | `AppError`           | `errors`   | Typed error class with HTTP status and `ApiErrorCode`  |
 * | `badRequest`         | `errors`   | Factory for 400 Bad Request errors                     |
 * | `unauthorized`       | `errors`   | Factory for 401 Unauthorized errors                    |
 * | `forbidden`          | `errors`   | Factory for 403 Forbidden errors                       |
 * | `notFound`           | `errors`   | Factory for 404 Not Found errors                       |
 * | `conflict`           | `errors`   | Factory for 409 Conflict errors                        |
 * | `payloadTooLarge`    | `errors`   | Factory for 413 Payload Too Large errors               |
 * | `rateLimited`        | `errors`   | Factory for 429 Rate Limited errors                    |
 * | `internalError`      | `errors`   | Factory for 500 Internal Server Error errors           |
 * | `validationError`    | `errors`   | Factory for 400 Validation Error errors                |
 * | `randomHex`          | `crypto`   | Cryptographically secure random hex string             |
 * | `randomUUID`         | `crypto`   | Random UUID v4 via `crypto.randomUUID()`               |
 * | `generateOtp`        | `crypto`   | Numeric OTP of configurable length (default 6)         |
 * | `sha256Hex`          | `crypto`   | SHA-256 hash returned as hex                           |
 * | `hmacSha256`         | `crypto`   | HMAC-SHA256 signature (e.g. Stripe webhook verify)     |
 * | `timingSafeEqual`    | `crypto`   | Constant-time string comparison                        |
 *
 * @example
 * ```ts
 * import {
 *   sanitizeHtml,
 *   businessNameToSlug,
 *   redactObject,
 *   AppError,
 *   notFound,
 *   hmacSha256,
 *   timingSafeEqual,
 * } from '@bolt/shared/utils';
 *
 * // Sanitise user content before storage
 * const safe = sanitizeHtml(userInput);
 * const slug = businessNameToSlug("Joe's Pizza & Grill"); // "joes-pizza-and-grill"
 *
 * // Redact PII before logging
 * console.warn(redactObject({ email: 'a@b.com', name: 'Joe' }));
 *
 * // Verify a Stripe webhook signature
 * const expected = await hmacSha256(secret, body);
 * if (!timingSafeEqual(expected, signatureHeader)) {
 *   throw notFound('Invalid signature');
 * }
 * ```
 */
export { sanitizeHtml, stripHtml, sanitizeSlug, businessNameToSlug } from './sanitize.js';
export { redact, redactObject } from './redact.js';
export {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  payloadTooLarge,
  rateLimited,
  internalError,
  validationError,
} from './errors.js';
export { randomHex, randomUUID, generateOtp, sha256Hex, hmacSha256, timingSafeEqual } from './crypto.js';
