/**
 * Shared utilities
 */

// =============================================================================
// ID GENERATION
// =============================================================================

/**
 * Generate a UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a secure random token
 */
export function generateToken(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a 6-digit OTP
 */
export function generateOtp(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const num = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
  return String(num % 1000000).padStart(6, '0');
}

// =============================================================================
// HASHING
// =============================================================================

/**
 * Hash a string using SHA-256
 */
export async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash for idempotency keys
 */
export async function hashIdempotencyKey(provider: string, eventId: string): Promise<string> {
  return sha256(`${provider}:${eventId}`);
}

// =============================================================================
// SLUG GENERATION
// =============================================================================

/**
 * Generate a URL-safe slug from a string
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars
    .replace(/[\s_-]+/g, '-') // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
    .slice(0, 63); // Max 63 chars for DNS compatibility
}

/**
 * Generate a unique slug with random suffix
 */
export function slugifyUnique(input: string): string {
  const base = slugify(input).slice(0, 55);
  const suffix = generateToken(4);
  return `${base}-${suffix}`;
}

// =============================================================================
// DATE UTILITIES
// =============================================================================

/**
 * Get current ISO timestamp
 */
export function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Add hours to current time and return ISO string
 */
export function hoursFromNow(hours: number): string {
  const date = new Date();
  date.setHours(date.getHours() + hours);
  return date.toISOString();
}

/**
 * Add minutes to current time and return ISO string
 */
export function minutesFromNow(minutes: number): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

/**
 * Add days to current time and return ISO string
 */
export function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

/**
 * Check if a timestamp is expired
 */
export function isExpired(isoTimestamp: string): boolean {
  return new Date(isoTimestamp) < new Date();
}

/**
 * Check if a timestamp is within tolerance (for webhook verification)
 */
export function isWithinTolerance(
  timestampSeconds: number,
  toleranceSeconds: number = 300,
): boolean {
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - timestampSeconds) <= toleranceSeconds;
}

// =============================================================================
// SANITIZATION
// =============================================================================

/**
 * Remove potentially dangerous content from strings
 */
export function sanitizeText(input: string): string {
  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '') // Remove script tags
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/data:/gi, '') // Remove data: protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .trim();
}

/**
 * Escape HTML entities
 */
export function escapeHtml(input: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return input.replace(/[&<>"']/g, (char) => escapeMap[char] ?? char);
}

// =============================================================================
// REDACTION (for logging)
// =============================================================================

const REDACT_KEYS = new Set([
  'password',
  'secret',
  'token',
  'api_key',
  'apikey',
  'authorization',
  'auth',
  'bearer',
  'otp',
  'code',
  'pin',
  'ssn',
  'credit_card',
  'card_number',
]);

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /\+?[1-9]\d{6,14}/g;

/**
 * Redact sensitive values from an object for logging
 */
export function redactSensitive(obj: unknown, depth = 0): unknown {
  if (depth > 10) return '[MAX_DEPTH]';

  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    // Redact emails and phones
    return obj.replace(EMAIL_REGEX, '[EMAIL]').replace(PHONE_REGEX, '[PHONE]');
  }

  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => redactSensitive(item, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (REDACT_KEYS.has(lowerKey) || lowerKey.includes('secret') || lowerKey.includes('password')) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redactSensitive(value, depth + 1);
    }
  }
  return result;
}

// =============================================================================
// REQUEST ID
// =============================================================================

/**
 * Generate a request ID with timestamp prefix
 */
export function generateRequestId(): string {
  const timestamp = Date.now().toString(36);
  const random = generateToken(8);
  return `req_${timestamp}_${random}`;
}

/**
 * Generate a trace ID
 */
export function generateTraceId(): string {
  return `trace_${generateToken(16)}`;
}

// =============================================================================
// EXPONENTIAL BACKOFF
// =============================================================================

/**
 * Calculate exponential backoff delay
 */
export function exponentialBackoff(
  attempt: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 30000,
): number {
  const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  // Add jitter (0-25% of delay)
  const jitter = Math.random() * delay * 0.25;
  return Math.floor(delay + jitter);
}

/**
 * Sleep for a given duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// RESULT TYPE (for error handling)
// =============================================================================

export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Wrap an async function in try-catch and return Result
 */
export async function tryCatch<T>(fn: () => Promise<T>): Promise<Result<T, Error>> {
  try {
    const value = await fn();
    return ok(value);
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
}
