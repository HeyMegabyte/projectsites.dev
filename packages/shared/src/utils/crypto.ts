/**
 * Cryptographic utilities that work in both Node.js and Cloudflare Workers (Web Crypto API).
 */

/**
 * Generate a cryptographically secure random hex string.
 */
export function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate a random UUID v4.
 */
export function randomUUID(): string {
  return crypto.randomUUID();
}

/**
 * Generate a numeric OTP of specified length.
 */
export function generateOtp(length: number = 6): string {
  const max = Math.pow(10, length);
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0]! % max).toString().padStart(length, '0');
}

/**
 * Hash a string with SHA-256 and return hex.
 */
export async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute HMAC-SHA256 signature.
 */
export async function hmacSha256(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Timing-safe string comparison.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < bufA.length; i++) {
    result |= bufA[i]! ^ bufB[i]!;
  }
  return result === 0;
}
