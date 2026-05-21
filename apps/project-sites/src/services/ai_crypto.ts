/**
 * AES-GCM encryption helpers for MCP OAuth tokens.
 * Key is provided via env.MCP_ENCRYPTION_KEY (base64-encoded 32 bytes).
 * Encrypted blob format: base64(iv ‖ ciphertext) where iv is 12 bytes.
 */
import type { Env } from '../types/env.js';

async function getKey(env: Env): Promise<CryptoKey> {
  const raw = env.MCP_ENCRYPTION_KEY;
  if (!raw) throw new Error('MCP_ENCRYPTION_KEY not configured');
  const buf = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (buf.length !== 32) throw new Error('MCP_ENCRYPTION_KEY must decode to 32 bytes');
  return crypto.subtle.importKey('raw', buf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(env: Env, plaintext: string): Promise<string> {
  const key = await getKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext)),
  );
  const combined = new Uint8Array(iv.length + ct.length);
  combined.set(iv, 0);
  combined.set(ct, iv.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decrypt(env: Env, blob: string): Promise<string> {
  const key = await getKey(env);
  const combined = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ct = combined.slice(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}
