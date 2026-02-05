import {
  sha256Hex,
  hmacSha256,
  randomHex,
  randomUUID,
  generateOtp,
  timingSafeEqual,
} from '../utils/crypto.js';

describe('sha256Hex extended', () => {
  it('produces correct hash for empty string', async () => {
    const hash = await sha256Hex('');
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('produces correct hash for "hello"', async () => {
    const hash = await sha256Hex('hello');
    expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('is deterministic', async () => {
    const a = await sha256Hex('deterministic-test');
    const b = await sha256Hex('deterministic-test');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', async () => {
    const a = await sha256Hex('input-one');
    const b = await sha256Hex('input-two');
    expect(a).not.toBe(b);
  });

  it('handles unicode input', async () => {
    const hash = await sha256Hex('\u{1F600}\u{1F4A9}');
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });

  it('handles long input (1MB)', async () => {
    const longStr = 'x'.repeat(1024 * 1024);
    const hash = await sha256Hex(longStr);
    expect(hash).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(hash)).toBe(true);
  });
});

describe('hmacSha256 extended', () => {
  it('produces correct signature for known test vector', async () => {
    const sig = await hmacSha256('key', 'The quick brown fox jumps over the lazy dog');
    expect(sig).toBe('f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8');
  });

  it('produces different signatures for same key, different messages', async () => {
    const a = await hmacSha256('shared-key', 'message-alpha');
    const b = await hmacSha256('shared-key', 'message-beta');
    expect(a).not.toBe(b);
  });

  it('produces different signatures for different keys, same message', async () => {
    const a = await hmacSha256('key-one', 'same-message');
    const b = await hmacSha256('key-two', 'same-message');
    expect(a).not.toBe(b);
  });

  it('handles empty message', async () => {
    const sig = await hmacSha256('some-key', '');
    expect(sig).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(sig)).toBe(true);
  });

  it('handles unicode key and message', async () => {
    const sig = await hmacSha256('\u{1F511}', '\u{1F4AC}');
    expect(sig).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(sig)).toBe(true);
  });
});

describe('randomHex extended', () => {
  it('returns correct length for various byte counts', () => {
    expect(randomHex(1)).toHaveLength(2);
    expect(randomHex(8)).toHaveLength(16);
    expect(randomHex(32)).toHaveLength(64);
  });

  it('only contains hex characters', () => {
    const hex = randomHex(64);
    expect(/^[0-9a-f]+$/.test(hex)).toBe(true);
  });

  it('returns empty string for zero bytes', () => {
    expect(randomHex(0)).toBe('');
  });
});

describe('randomUUID extended', () => {
  it('matches UUID v4 format', () => {
    const uuid = randomUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('generates unique values across multiple calls', () => {
    const uuids = new Set(Array.from({ length: 50 }, () => randomUUID()));
    expect(uuids.size).toBe(50);
  });
});

describe('generateOtp extended', () => {
  it('generates only digit characters', () => {
    const otp = generateOtp();
    expect(/^\d+$/.test(otp)).toBe(true);
  });

  it('respects custom length of 4', () => {
    const otp = generateOtp(4);
    expect(otp).toHaveLength(4);
    expect(/^\d{4}$/.test(otp)).toBe(true);
  });

  it('respects custom length of 8', () => {
    const otp = generateOtp(8);
    expect(otp).toHaveLength(8);
    expect(/^\d{8}$/.test(otp)).toBe(true);
  });
});

describe('timingSafeEqual extended', () => {
  it('detects single character difference', () => {
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
  });

  it('detects difference at start of string', () => {
    expect(timingSafeEqual('xbcdef', 'abcdef')).toBe(false);
  });

  it('handles long equal strings', () => {
    const s = 'a'.repeat(10000);
    expect(timingSafeEqual(s, s)).toBe(true);
  });
});
