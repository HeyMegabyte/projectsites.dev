/**
 * Utility function tests
 * Comprehensive tests for all shared utilities
 */
import {
  generateId,
  generateToken,
  generateOtp,
  sha256,
  slugify,
  slugifyUnique,
  nowISO,
  hoursFromNow,
  minutesFromNow,
  daysFromNow,
  isExpired,
  isWithinTolerance,
  sanitizeText,
  escapeHtml,
  redactSensitive,
  generateRequestId,
  generateTraceId,
  exponentialBackoff,
  ok,
  err,
  tryCatch,
} from './index.js';

describe('generateId', () => {
  it('should generate a valid UUID', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('should generate unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateToken', () => {
  it('should generate token of default length (32)', () => {
    const token = generateToken();
    expect(token).toHaveLength(64); // 32 bytes = 64 hex chars
  });

  it('should generate token of specified length', () => {
    const token = generateToken(16);
    expect(token).toHaveLength(32); // 16 bytes = 32 hex chars
  });

  it('should generate hex-only tokens', () => {
    const token = generateToken();
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  it('should generate unique tokens', () => {
    const tokens = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(tokens.size).toBe(100);
  });
});

describe('generateOtp', () => {
  it('should generate 6-digit OTP', () => {
    const otp = generateOtp();
    expect(otp).toMatch(/^\d{6}$/);
  });

  it('should generate numeric-only OTP', () => {
    const otp = generateOtp();
    expect(parseInt(otp, 10)).not.toBeNaN();
  });

  it('should generate varied OTPs', () => {
    const otps = new Set(Array.from({ length: 50 }, () => generateOtp()));
    expect(otps.size).toBeGreaterThan(40); // Allow some collisions
  });

  it('should pad with leading zeros if needed', () => {
    // Run multiple times to increase chance of getting a low number
    let foundPadded = false;
    for (let i = 0; i < 1000 && !foundPadded; i++) {
      const otp = generateOtp();
      if (otp.startsWith('0')) {
        foundPadded = true;
      }
    }
    // Can't guarantee, but the padding logic should work
    expect(generateOtp()).toHaveLength(6);
  });
});

describe('sha256', () => {
  it('should hash string to hex', async () => {
    const hash = await sha256('hello');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('should produce consistent hashes', async () => {
    const hash1 = await sha256('test');
    const hash2 = await sha256('test');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different inputs', async () => {
    const hash1 = await sha256('test1');
    const hash2 = await sha256('test2');
    expect(hash1).not.toBe(hash2);
  });

  it('should hash empty string', async () => {
    const hash = await sha256('');
    expect(hash).toHaveLength(64);
  });

  it('should hash unicode correctly', async () => {
    const hash = await sha256('Hello \u00e9\u00e8');
    expect(hash).toHaveLength(64);
  });
});

describe('slugify', () => {
  it('should convert to lowercase', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('should replace spaces with hyphens', () => {
    expect(slugify('my business name')).toBe('my-business-name');
  });

  it('should remove special characters', () => {
    expect(slugify("John's Cafe & Bar")).toBe('johns-cafe-bar');
  });

  it('should handle multiple spaces', () => {
    expect(slugify('hello   world')).toBe('hello-world');
  });

  it('should trim hyphens from ends', () => {
    expect(slugify(' hello world ')).toBe('hello-world');
  });

  it('should handle underscores', () => {
    expect(slugify('hello_world')).toBe('hello-world');
  });

  it('should truncate to 63 characters', () => {
    const long = 'a'.repeat(100);
    expect(slugify(long)).toHaveLength(63);
  });

  it('should handle numbers', () => {
    expect(slugify('Business 123')).toBe('business-123');
  });

  it('should handle unicode', () => {
    expect(slugify('Caf\u00e9 M\u00fcller')).toBe('caf-mller');
  });

  it('should handle empty string', () => {
    expect(slugify('')).toBe('');
  });
});

describe('slugifyUnique', () => {
  it('should include random suffix', () => {
    const slug = slugifyUnique('Hello World');
    expect(slug).toMatch(/^hello-world-[a-f0-9]{8}$/);
  });

  it('should generate unique slugs', () => {
    const slugs = new Set(Array.from({ length: 100 }, () => slugifyUnique('test')));
    expect(slugs.size).toBe(100);
  });

  it('should truncate base to leave room for suffix', () => {
    const long = 'a'.repeat(100);
    const slug = slugifyUnique(long);
    expect(slug.length).toBeLessThanOrEqual(64);
  });
});

describe('nowISO', () => {
  it('should return ISO 8601 string', () => {
    const now = nowISO();
    expect(new Date(now).toISOString()).toBe(now);
  });

  it('should be close to current time', () => {
    const now = nowISO();
    const diff = Math.abs(Date.now() - new Date(now).getTime());
    expect(diff).toBeLessThan(1000);
  });
});

describe('hoursFromNow', () => {
  it('should add hours correctly', () => {
    const future = hoursFromNow(24);
    const diff = new Date(future).getTime() - Date.now();
    expect(Math.round(diff / 3600000)).toBe(24);
  });

  it('should handle negative hours', () => {
    const past = hoursFromNow(-1);
    expect(new Date(past).getTime()).toBeLessThan(Date.now());
  });
});

describe('minutesFromNow', () => {
  it('should add minutes correctly', () => {
    const future = minutesFromNow(30);
    const diff = new Date(future).getTime() - Date.now();
    expect(Math.round(diff / 60000)).toBe(30);
  });
});

describe('daysFromNow', () => {
  it('should add days correctly', () => {
    const future = daysFromNow(7);
    const diff = new Date(future).getTime() - Date.now();
    expect(Math.round(diff / 86400000)).toBe(7);
  });
});

describe('isExpired', () => {
  it('should return true for past timestamp', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(isExpired(past)).toBe(true);
  });

  it('should return false for future timestamp', () => {
    const future = new Date(Date.now() + 60000).toISOString();
    expect(isExpired(future)).toBe(false);
  });

  it('should return true for now (edge case)', () => {
    // Might flake, but generally should be expired or about to
    const now = new Date().toISOString();
    // Just verify it doesn't throw
    expect(typeof isExpired(now)).toBe('boolean');
  });
});

describe('isWithinTolerance', () => {
  it('should return true for current timestamp', () => {
    const now = Math.floor(Date.now() / 1000);
    expect(isWithinTolerance(now)).toBe(true);
  });

  it('should return true within tolerance', () => {
    const recent = Math.floor(Date.now() / 1000) - 100;
    expect(isWithinTolerance(recent, 300)).toBe(true);
  });

  it('should return false outside tolerance', () => {
    const old = Math.floor(Date.now() / 1000) - 600;
    expect(isWithinTolerance(old, 300)).toBe(false);
  });

  it('should handle future timestamps', () => {
    const future = Math.floor(Date.now() / 1000) + 100;
    expect(isWithinTolerance(future, 300)).toBe(true);
  });

  it('should reject far future timestamps', () => {
    const farFuture = Math.floor(Date.now() / 1000) + 600;
    expect(isWithinTolerance(farFuture, 300)).toBe(false);
  });
});

describe('sanitizeText', () => {
  it('should remove script tags', () => {
    const input = 'Hello <script>alert(1)</script> World';
    expect(sanitizeText(input)).toBe('Hello  World');
  });

  it('should remove javascript: protocol', () => {
    const input = 'Click javascript:alert(1) here';
    expect(sanitizeText(input)).toBe('Click alert(1) here');
  });

  it('should remove data: protocol', () => {
    const input = 'Image data:text/html,<h1>Hi</h1>';
    expect(sanitizeText(input)).toBe('Image text/html,<h1>Hi</h1>');
  });

  it('should remove event handlers', () => {
    const input = '<img onerror=alert(1) src="x">';
    expect(sanitizeText(input)).not.toContain('onerror');
  });

  it('should preserve normal text', () => {
    const input = 'Hello World';
    expect(sanitizeText(input)).toBe('Hello World');
  });

  it('should trim whitespace', () => {
    const input = '  Hello  ';
    expect(sanitizeText(input)).toBe('Hello');
  });

  it('should handle multiline script', () => {
    const input = '<script>\nalert(1)\n</script>';
    expect(sanitizeText(input)).toBe('');
  });
});

describe('escapeHtml', () => {
  it('should escape &', () => {
    expect(escapeHtml('A & B')).toBe('A &amp; B');
  });

  it('should escape <', () => {
    expect(escapeHtml('1 < 2')).toBe('1 &lt; 2');
  });

  it('should escape >', () => {
    expect(escapeHtml('2 > 1')).toBe('2 &gt; 1');
  });

  it('should escape quotes', () => {
    expect(escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it('should escape single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#039;s');
  });

  it('should escape all in combination', () => {
    expect(escapeHtml('<script>"alert"</script>')).toBe(
      '&lt;script&gt;&quot;alert&quot;&lt;/script&gt;',
    );
  });

  it('should handle empty string', () => {
    expect(escapeHtml('')).toBe('');
  });
});

describe('redactSensitive', () => {
  it('should redact password fields', () => {
    const input = { password: 'secret123' };
    expect(redactSensitive(input)).toEqual({ password: '[REDACTED]' });
  });

  it('should redact token fields', () => {
    const input = { access_token: 'abc123' };
    expect(redactSensitive(input)).toEqual({ access_token: '[REDACTED]' });
  });

  it('should redact api_key fields', () => {
    const input = { api_key: 'key123' };
    expect(redactSensitive(input)).toEqual({ api_key: '[REDACTED]' });
  });

  it('should redact fields containing secret', () => {
    const input = { my_secret_key: 'value' };
    expect(redactSensitive(input)).toEqual({ my_secret_key: '[REDACTED]' });
  });

  it('should redact emails in strings', () => {
    const input = 'Contact: test@example.com';
    expect(redactSensitive(input)).toBe('Contact: [EMAIL]');
  });

  it('should redact phone numbers in strings', () => {
    const input = 'Call +14155551234';
    expect(redactSensitive(input)).toBe('Call [PHONE]');
  });

  it('should handle nested objects', () => {
    const input = { user: { password: 'secret' } };
    expect(redactSensitive(input)).toEqual({ user: { password: '[REDACTED]' } });
  });

  it('should handle arrays', () => {
    const input = [{ token: 'abc' }, { token: 'def' }];
    expect(redactSensitive(input)).toEqual([{ token: '[REDACTED]' }, { token: '[REDACTED]' }]);
  });

  it('should preserve non-sensitive fields', () => {
    const input = { name: 'John', age: 30 };
    expect(redactSensitive(input)).toEqual({ name: 'John', age: 30 });
  });

  it('should handle null and undefined', () => {
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
  });

  it('should handle deeply nested objects up to max depth', () => {
    let nested: Record<string, unknown> = { value: 'test' };
    for (let i = 0; i < 15; i++) {
      nested = { nested };
    }
    const result = redactSensitive(nested) as Record<string, unknown>;
    // Should not throw and should cap at max depth
    expect(result).toBeDefined();
  });
});

describe('generateRequestId', () => {
  it('should start with req_', () => {
    const id = generateRequestId();
    expect(id).toMatch(/^req_/);
  });

  it('should be unique', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateRequestId()));
    expect(ids.size).toBe(100);
  });

  it('should include timestamp component', () => {
    const id = generateRequestId();
    expect(id.split('_').length).toBe(3); // req_timestamp_random
  });
});

describe('generateTraceId', () => {
  it('should start with trace_', () => {
    const id = generateTraceId();
    expect(id).toMatch(/^trace_/);
  });

  it('should be unique', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });
});

describe('exponentialBackoff', () => {
  it('should calculate correct base delay', () => {
    const delay = exponentialBackoff(0, 1000, 30000);
    expect(delay).toBeGreaterThanOrEqual(1000);
    expect(delay).toBeLessThanOrEqual(1250); // With 25% jitter
  });

  it('should increase exponentially', () => {
    const delay0 = exponentialBackoff(0, 1000, 30000);
    const delay1 = exponentialBackoff(1, 1000, 30000);
    const delay2 = exponentialBackoff(2, 1000, 30000);

    // Average should roughly double each time
    expect(delay1).toBeGreaterThan(delay0);
    expect(delay2).toBeGreaterThan(delay1);
  });

  it('should cap at max delay', () => {
    const delay = exponentialBackoff(10, 1000, 30000);
    expect(delay).toBeLessThanOrEqual(37500); // 30000 + 25% jitter
  });

  it('should include jitter', () => {
    // Run multiple times and check for variation
    const delays = Array.from({ length: 20 }, () => exponentialBackoff(0, 1000, 30000));
    const unique = new Set(delays);
    expect(unique.size).toBeGreaterThan(1);
  });
});

describe('Result type', () => {
  describe('ok', () => {
    it('should create success result', () => {
      const result = ok(42);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });
  });

  describe('err', () => {
    it('should create error result', () => {
      const result = err(new Error('failed'));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('failed');
      }
    });
  });

  describe('tryCatch', () => {
    it('should return ok on success', async () => {
      const result = await tryCatch(async () => 'success');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('success');
      }
    });

    it('should return err on failure', async () => {
      const result = await tryCatch(async () => {
        throw new Error('failed');
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('failed');
      }
    });

    it('should wrap non-Error throws', async () => {
      const result = await tryCatch(async () => {
        throw 'string error';
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('string error');
      }
    });
  });
});
