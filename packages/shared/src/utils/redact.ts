/**
 * Centralized PII redaction utility.
 * Redacts emails, phones, tokens, and other sensitive data from log strings.
 */

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /\+?[1-9]\d{6,14}/g;
const TOKEN_REGEX = /(?:sk_(?:test|live)_|pk_(?:test|live)_|whsec_|rk_|Bearer\s+)[a-zA-Z0-9_-]{6,}/g;
const SECRET_KV_REGEX =
  /(?:password|secret|token|otp|code)["']?\s*[:=]\s*["']?[a-zA-Z0-9_+/=-]{8,}["']?/gi;

export function redact(input: string): string {
  return input
    .replace(TOKEN_REGEX, '[REDACTED_TOKEN]')
    .replace(SECRET_KV_REGEX, '[REDACTED_SECRET]')
    .replace(EMAIL_REGEX, '[REDACTED_EMAIL]')
    .replace(PHONE_REGEX, '[REDACTED_PHONE]');
}

/**
 * Redact sensitive fields from an object for structured logging.
 * Returns a new object with sensitive values replaced.
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
    'supabase_service_role_key',
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
