import { type WebhookProvider, hmacSha256, timingSafeEqual } from '@project-sites/shared';
import type { SupabaseClient } from './db.js';
import { supabaseQuery } from './db.js';

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Generic webhook ingestion framework.
 * Used by Stripe, Dub, Chatwoot, Novu, Lago.
 *
 * Steps:
 * 1. Verify signature
 * 2. Check idempotency (provider + event_id)
 * 3. Store event
 * 4. Process
 * 5. Mark processed
 */

/**
 * Verify Stripe webhook signature.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds: number = 300,
): Promise<WebhookVerificationResult> {
  if (!signatureHeader || !secret) {
    return { valid: false, reason: 'Missing signature or secret' };
  }

  const parts = signatureHeader.split(',').reduce(
    (acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) {
        acc[key.trim()] = value.trim();
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  const timestamp = parts['t'];
  const v1Signature = parts['v1'];

  if (!timestamp || !v1Signature) {
    return { valid: false, reason: 'Invalid signature format' };
  }

  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000);
  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts) || Math.abs(now - ts) > toleranceSeconds) {
    return { valid: false, reason: 'Timestamp outside tolerance' };
  }

  // Compute expected signature
  const payload = `${timestamp}.${rawBody}`;
  const expectedSignature = await hmacSha256(secret, payload);

  if (!timingSafeEqual(v1Signature, expectedSignature)) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true };
}

/**
 * Generic HMAC signature verification for custom webhooks.
 */
export async function verifyHmacSignature(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<WebhookVerificationResult> {
  if (!signature || !secret) {
    return { valid: false, reason: 'Missing signature or secret' };
  }

  const expected = await hmacSha256(secret, rawBody);

  if (!timingSafeEqual(signature, expected)) {
    return { valid: false, reason: 'Signature mismatch' };
  }

  return { valid: true };
}

/**
 * Check if a webhook event has already been processed (idempotency).
 */
export async function checkWebhookIdempotency(
  db: SupabaseClient,
  provider: WebhookProvider,
  eventId: string,
): Promise<{ isDuplicate: boolean; existingId?: string }> {
  const query = `provider=eq.${provider}&event_id=eq.${encodeURIComponent(eventId)}&select=id,status`;

  const result = await supabaseQuery<Array<{ id: string; status: string }>>(db, 'webhook_events', {
    query,
  });

  if (result.data && result.data.length > 0) {
    return { isDuplicate: true, existingId: result.data[0]!.id };
  }

  return { isDuplicate: false };
}

/**
 * Store a webhook event record for replay/debug.
 */
export async function storeWebhookEvent(
  db: SupabaseClient,
  event: {
    provider: WebhookProvider;
    event_id: string;
    event_type: string;
    org_id?: string;
    payload_hash?: string;
    status?: string;
  },
): Promise<{ id: string | null; error: string | null }> {
  const body = {
    id: crypto.randomUUID(),
    provider: event.provider,
    event_id: event.event_id,
    event_type: event.event_type,
    org_id: event.org_id ?? null,
    payload_hash: event.payload_hash ?? null,
    status: event.status ?? 'received',
    attempts: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  const result = await supabaseQuery<Array<{ id: string }>>(db, 'webhook_events', {
    method: 'POST',
    body,
    headers: { Prefer: 'return=representation' },
  });

  if (result.error) {
    return { id: null, error: result.error };
  }

  return { id: result.data?.[0]?.id ?? body.id, error: null };
}

/**
 * Mark a webhook event as processed.
 */
export async function markWebhookProcessed(
  db: SupabaseClient,
  eventId: string,
  status: 'processed' | 'failed' = 'processed',
  errorMessage?: string,
): Promise<void> {
  await supabaseQuery(db, 'webhook_events', {
    method: 'PATCH',
    query: `id=eq.${eventId}`,
    body: {
      status,
      processed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: errorMessage ?? null,
    },
  });
}
