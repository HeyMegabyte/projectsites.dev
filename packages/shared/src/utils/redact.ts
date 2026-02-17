/**
 * Centralized PII redaction utilities for safe logging and observability.
 *
 * All log output in the application should pass through {@link redact} (for
 * plain strings) or {@link redactObject} (for structured payloads) before being
 * emitted. This prevents accidental leakage of emails, phone numbers, API
 * tokens, and key-value secrets into logs, traces, and error reporters.
 *
 * | Export         | Description                                          |
 * | -------------- | ---------------------------------------------------- |
 * | `redact`       | Replace PII/secret patterns in a plain string        |
 * | `redactObject` | Deep-redact sensitive fields in a structured object   |
 *
 * @example
 * ```ts
 * import { redact, redactObject } from '@shared/utils/redact.js';
 *
 * console.warn(redact('User email is alice@example.com'));
 * // => 'User email is [REDACTED_EMAIL]'
 *
 * console.warn(JSON.stringify(redactObject({
 *   user: 'alice',
 *   token: 'sk_live_abc123xyz',
 *   nested: { password: 's3cret!' },
 * })));
 * // => '{"user":"alice","token":"[REDACTED]","nested":{"password":"[REDACTED]"}}'
 * ```
 *
 * @module redact
 * @packageDocumentation
 */

/**
 * Pattern matching email addresses (RFC 5322 simplified).
 * @internal
 */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
/**
 * Pattern matching international phone numbers (E.164-ish, 7-15 digits).
 * @internal
 */
const PHONE_REGEX = /\+?[1-9]\d{6,14}/g;

/**
 * Pattern matching well-known API token prefixes (Stripe, webhooks, Bearer).
 * @internal
 */
const TOKEN_REGEX = /(?:sk_(?:test|live)_|pk_(?:test|live)_|whsec_|rk_|Bearer\s+)[a-zA-Z0-9_-]{6,}/g;

/**
 * Pattern matching generic `key=value` or `key: value` pairs where the key
 * suggests a secret (password, token, OTP, etc.) and the value is 8+ chars.
 * @internal
 */
const SECRET_KV_REGEX = /(?:password|secret|token|otp|code)["']?\s*[:=]\s*["']?[a-zA-Z0-9_+/=-]{8,}["']?/gi;

/**
 * Replace PII and secret patterns in a plain string with redaction placeholders.
 *
 * Patterns are applied in a specific order to avoid partial matches:
 * 1. API tokens / Bearer tokens -> `[REDACTED_TOKEN]`
 * 2. Secret key-value pairs      -> `[REDACTED_SECRET]`
 * 3. Email addresses              -> `[REDACTED_EMAIL]`
 * 4. Phone numbers                -> `[REDACTED_PHONE]`
 *
 * @param input - The raw string that may contain sensitive data.
 * @returns A new string with all recognised sensitive patterns replaced.
 *
 * @example
 * ```ts
 * redact('Charge failed for alice@example.com, token sk_live_abc123xyz');
 * // => 'Charge failed for [REDACTED_EMAIL], token [REDACTED_TOKEN]'
 * ```
 */
export function redact(input: string): string {
  return input
    .replace(TOKEN_REGEX, '[REDACTED_TOKEN]')
    .replace(SECRET_KV_REGEX, '[REDACTED_SECRET]')
    .replace(EMAIL_REGEX, '[REDACTED_EMAIL]')
    .replace(PHONE_REGEX, '[REDACTED_PHONE]');
}

/**
 * Deep-redact sensitive fields from a structured object for safe logging.
 *
 * Processing logic for each key-value pair:
 * - If the **key** is in the built-in sensitive-keys set (case-insensitive),
 *   the value is replaced with `'[REDACTED]'`.
 * - If the value is a **string**, it is run through {@link redact}.
 * - If the value is a **nested object** (non-array), `redactObject` recurses.
 * - All other values (numbers, booleans, arrays) pass through unchanged.
 *
 * The sensitive-keys set includes: `password`, `secret`, `token`, `otp`,
 * `code`, `api_key`, `apiKey`, `authorization`, `cookie`, `session_token`,
 * `refresh_token`, `access_token`, `stripe_secret_key`.
 *
 * @typeParam T - The shape of the input object.
 * @param obj - The object to redact. Not mutated; a new object is returned.
 * @returns A shallow-to-deep copy of `obj` with sensitive values replaced.
 *
 * @example
 * ```ts
 * redactObject({ user: 'bob', authorization: 'Bearer xyz', meta: { email: 'bob@co.com' } });
 * // => { user: 'bob', authorization: '[REDACTED]', meta: { email: '[REDACTED_EMAIL]' } }
 * ```
 */
export function redactObject<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const sensitiveKeys = new Set([
    'password',
    'secret',
    'token',
    'otp',
    'code',
    'api_key',
    'apiKey',
    'authorization',
    'cookie',
    'session_token',
    'refresh_token',
    'access_token',
    'stripe_secret_key',
  ]);

  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      result[key] = redact(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      result[key] = redactObject(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}
