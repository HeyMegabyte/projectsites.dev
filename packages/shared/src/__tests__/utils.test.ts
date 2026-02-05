import { sanitizeHtml, stripHtml, sanitizeSlug, businessNameToSlug } from '../utils/sanitize';
import { redact, redactObject } from '../utils/redact';
import {
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
} from '../utils/errors';
import { generateOtp, randomHex, randomUUID, timingSafeEqual } from '../utils/crypto';

// ─── Sanitize ────────────────────────────────────────────────

describe('sanitizeHtml', () => {
  it('removes script tags', () => {
    expect(sanitizeHtml('<script>alert("xss")</script>')).toBe('');
  });

  it('removes nested script tags', () => {
    const result = sanitizeHtml('<script>var x = 1;<script>nested</script></script>');
    expect(result).not.toContain('<script');
  });

  it('removes event handlers', () => {
    expect(sanitizeHtml('<img onerror="alert(1)">')).not.toContain('onerror');
  });

  it('removes javascript: URIs', () => {
    expect(sanitizeHtml('javascript:alert(1)')).not.toContain('javascript');
  });

  it('removes data: URIs', () => {
    expect(sanitizeHtml('data:text/html,<h1>hi</h1>')).not.toContain('data:');
  });

  it('removes vbscript: URIs', () => {
    expect(sanitizeHtml('vbscript:alert(1)')).not.toContain('vbscript');
  });

  it('removes iframes', () => {
    expect(sanitizeHtml('<iframe src="evil.com"></iframe>')).toBe('');
  });

  it('removes object tags', () => {
    expect(sanitizeHtml('<object data="evil.swf"></object>')).toBe('');
  });

  it('removes embed tags', () => {
    expect(sanitizeHtml('<embed src="evil.swf">')).toBe('');
  });

  it('preserves safe HTML', () => {
    expect(sanitizeHtml('<p>Hello <strong>World</strong></p>')).toBe('<p>Hello <strong>World</strong></p>');
  });

  it('handles empty strings', () => {
    expect(sanitizeHtml('')).toBe('');
  });

  it('handles plain text', () => {
    expect(sanitizeHtml('Just text')).toBe('Just text');
  });
});

describe('stripHtml', () => {
  it('removes all HTML tags', () => {
    expect(stripHtml('<p>Hello <strong>World</strong></p>')).toBe('Hello World');
  });

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });

  it('handles text without HTML', () => {
    expect(stripHtml('Just text')).toBe('Just text');
  });
});

describe('sanitizeSlug', () => {
  it('lowercases and strips invalid chars', () => {
    expect(sanitizeSlug('My Business!')).toBe('my-business');
  });

  it('collapses multiple hyphens', () => {
    expect(sanitizeSlug('my---business')).toBe('my-business');
  });

  it('trims leading/trailing hyphens', () => {
    expect(sanitizeSlug('-my-business-')).toBe('my-business');
  });

  it('truncates to 63 chars', () => {
    expect(sanitizeSlug('a'.repeat(100))).toHaveLength(63);
  });

  it('handles empty string', () => {
    expect(sanitizeSlug('')).toBe('');
  });
});

describe('businessNameToSlug', () => {
  it('converts business names to slugs', () => {
    expect(businessNameToSlug("Joe's Pizza & Pasta")).toBe('joes-pizza-and-pasta');
  });

  it('handles ampersands', () => {
    expect(businessNameToSlug('A & B')).toBe('a-and-b');
  });

  it('handles apostrophes', () => {
    expect(businessNameToSlug("O'Brien\u2019s Shop")).toBe('obriens-shop');
  });
});

// ─── Redact ──────────────────────────────────────────────────

describe('redact', () => {
  it('redacts Stripe test keys', () => {
    expect(redact('key: sk_test_abc123xyz')).toContain('[REDACTED_TOKEN]');
  });

  it('redacts Stripe live keys', () => {
    expect(redact('key: sk_live_abc123xyz')).toContain('[REDACTED_TOKEN]');
  });

  it('redacts Bearer tokens', () => {
    expect(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9')).toContain('[REDACTED_TOKEN]');
  });

  it('redacts emails', () => {
    expect(redact('user: test@example.com')).toContain('[REDACTED_EMAIL]');
  });

  it('redacts phone numbers', () => {
    expect(redact('phone: +14155551234')).toContain('[REDACTED_PHONE]');
  });

  it('redacts webhook secrets', () => {
    expect(redact('secret: whsec_abc123xyz1234')).toContain('[REDACTED_TOKEN]');
  });

  it('preserves non-sensitive text', () => {
    expect(redact('Hello World')).toBe('Hello World');
  });

  it('handles empty strings', () => {
    expect(redact('')).toBe('');
  });
});

describe('redactObject', () => {
  it('redacts sensitive keys', () => {
    const result = redactObject({ password: 'secret123', name: 'John' });
    expect(result.password).toBe('[REDACTED]');
    expect(result.name).toBe('John');
  });

  it('redacts nested objects', () => {
    const result = redactObject({
      config: { api_key: 'secret', url: 'https://example.com' },
    });
    expect((result.config as Record<string, unknown>).api_key).toBe('[REDACTED]');
  });

  it('redacts string values containing tokens', () => {
    const result = redactObject({ header: 'Bearer eyJhbGciOiJIUzI1NiJ9' });
    expect(result.header).toContain('[REDACTED_TOKEN]');
  });

  it('preserves non-sensitive values', () => {
    const result = redactObject({ id: 123, status: 'active' });
    expect(result.id).toBe(123);
    expect(result.status).toBe('active');
  });
});

// ─── Errors ──────────────────────────────────────────────────

describe('AppError', () => {
  it('creates error with correct properties', () => {
    const err = new AppError({
      code: 'BAD_REQUEST',
      message: 'Invalid input',
      statusCode: 400,
      details: { field: 'name' },
    });
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.message).toBe('Invalid input');
    expect(err.statusCode).toBe(400);
    expect(err.details).toEqual({ field: 'name' });
  });

  it('serializes to JSON', () => {
    const err = new AppError({
      code: 'NOT_FOUND',
      message: 'Not found',
      statusCode: 404,
      requestId: 'req-123',
    });
    const json = err.toJSON();
    expect(json.error.code).toBe('NOT_FOUND');
    expect(json.error.request_id).toBe('req-123');
  });

  it('extends Error', () => {
    const err = new AppError({ code: 'INTERNAL_ERROR', message: 'test', statusCode: 500 });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AppError');
  });

  it('preserves cause', () => {
    const cause = new Error('original');
    const err = new AppError({
      code: 'INTERNAL_ERROR',
      message: 'wrapped',
      statusCode: 500,
      cause,
    });
    expect(err.cause).toBe(cause);
  });
});

describe('error factories', () => {
  it('badRequest returns 400', () => {
    const err = badRequest('bad');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
  });

  it('unauthorized returns 401', () => {
    const err = unauthorized();
    expect(err.statusCode).toBe(401);
  });

  it('forbidden returns 403', () => {
    const err = forbidden();
    expect(err.statusCode).toBe(403);
  });

  it('notFound returns 404', () => {
    const err = notFound();
    expect(err.statusCode).toBe(404);
  });

  it('conflict returns 409', () => {
    const err = conflict('duplicate');
    expect(err.statusCode).toBe(409);
  });

  it('payloadTooLarge returns 413', () => {
    const err = payloadTooLarge();
    expect(err.statusCode).toBe(413);
  });

  it('rateLimited returns 429', () => {
    const err = rateLimited();
    expect(err.statusCode).toBe(429);
  });

  it('internalError returns 500', () => {
    const err = internalError();
    expect(err.statusCode).toBe(500);
  });

  it('validationError returns 400 with details', () => {
    const err = validationError('invalid', { fields: ['name'] });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.details).toEqual({ fields: ['name'] });
  });
});

// ─── Crypto ──────────────────────────────────────────────────

describe('randomHex', () => {
  it('generates hex string of correct length', () => {
    const hex = randomHex(16);
    expect(hex).toHaveLength(32);
    expect(/^[0-9a-f]+$/.test(hex)).toBe(true);
  });

  it('generates unique values', () => {
    const a = randomHex(16);
    const b = randomHex(16);
    expect(a).not.toBe(b);
  });
});

describe('randomUUID', () => {
  it('generates valid UUID v4', () => {
    const uuid = randomUUID();
    expect(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)).toBe(true);
  });

  it('generates unique values', () => {
    const a = randomUUID();
    const b = randomUUID();
    expect(a).not.toBe(b);
  });
});

describe('generateOtp', () => {
  it('generates 6-digit OTP by default', () => {
    const otp = generateOtp();
    expect(otp).toHaveLength(6);
    expect(/^\d{6}$/.test(otp)).toBe(true);
  });

  it('generates OTP of specified length', () => {
    const otp = generateOtp(4);
    expect(otp).toHaveLength(4);
    expect(/^\d{4}$/.test(otp)).toBe(true);
  });

  it('pads with leading zeros', () => {
    // Run multiple times to increase chance of hitting a small number
    const otps = Array.from({ length: 100 }, () => generateOtp());
    otps.forEach((otp) => expect(otp).toHaveLength(6));
  });
});

describe('timingSafeEqual', () => {
  it('returns true for equal strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(timingSafeEqual('abc', 'def')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(timingSafeEqual('', '')).toBe(true);
  });
});
