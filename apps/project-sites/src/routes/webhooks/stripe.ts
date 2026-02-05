/**
 * Stripe webhook handler
 * Handles checkout.session.completed, subscription events, and invoice events
 */
import { Hono } from 'hono';
import { sha256, nowISO, redactSensitive } from '@project-sites/shared';
import type { AppContext } from '../../types.js';
import { ValidationError } from '../../middleware/error-handler.js';

export const stripeWebhooks = new Hono<AppContext>();

// =============================================================================
// Stripe Signature Verification
// =============================================================================

async function verifyStripeSignature(
  payload: string,
  signature: string,
  secret: string,
  toleranceSeconds: number = 300,
): Promise<{ timestamp: number; eventId: string } | null> {
  // Parse signature header
  const parts = signature.split(',').reduce(
    (acc, part) => {
      const [key, value] = part.split('=');
      if (key && value) {
        acc[key] = value;
      }
      return acc;
    },
    {} as Record<string, string>,
  );

  const timestamp = parseInt(parts.t ?? '0', 10);
  const v1Signature = parts.v1;

  if (!timestamp || !v1Signature) {
    return null;
  }

  // Check timestamp tolerance
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return null;
  }

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison
  if (expectedSignature.length !== v1Signature.length) {
    return null;
  }

  let match = true;
  for (let i = 0; i < expectedSignature.length; i++) {
    if (expectedSignature[i] !== v1Signature[i]) {
      match = false;
    }
  }

  if (!match) {
    return null;
  }

  // Extract event ID from payload
  try {
    const event = JSON.parse(payload) as { id?: string };
    return { timestamp, eventId: event.id ?? 'unknown' };
  } catch {
    return null;
  }
}

// =============================================================================
// Idempotency Check
// =============================================================================

async function checkIdempotency(
  kv: KVNamespace,
  provider: string,
  eventId: string,
): Promise<boolean> {
  const key = `idempo:${provider}:${eventId}`;
  const existing = await kv.get(key);
  return existing !== null;
}

async function markProcessed(
  kv: KVNamespace,
  provider: string,
  eventId: string,
  ttlSeconds: number = 86400 * 7, // 7 days
): Promise<void> {
  const key = `idempo:${provider}:${eventId}`;
  await kv.put(key, nowISO(), { expirationTtl: ttlSeconds });
}

// =============================================================================
// Webhook Handler
// =============================================================================

stripeWebhooks.post('/', async (c) => {
  const requestContext = c.get('requestContext');

  // Get raw body
  const payload = await c.req.text();

  // Verify signature
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    throw new ValidationError('Missing stripe-signature header');
  }

  const verified = await verifyStripeSignature(payload, signature, c.env.STRIPE_WEBHOOK_SECRET);

  if (!verified) {
    console.error(
      JSON.stringify({
        level: 'warn',
        type: 'webhook_signature_failed',
        request_id: requestContext.request_id,
        provider: 'stripe',
      }),
    );
    throw new ValidationError('Invalid webhook signature');
  }

  // Check idempotency
  const isProcessed = await checkIdempotency(c.env.CACHE_KV, 'stripe', verified.eventId);

  if (isProcessed) {
    console.log(
      JSON.stringify({
        level: 'info',
        type: 'webhook_duplicate',
        request_id: requestContext.request_id,
        provider: 'stripe',
        event_id: verified.eventId,
      }),
    );
    return c.json({ received: true, status: 'duplicate' });
  }

  // Parse event
  let event: {
    id: string;
    type: string;
    data: { object: unknown };
    livemode: boolean;
  };

  try {
    event = JSON.parse(payload);
  } catch {
    throw new ValidationError('Invalid JSON payload');
  }

  // Log event (redacted)
  console.log(
    JSON.stringify(
      redactSensitive({
        level: 'info',
        type: 'webhook_received',
        request_id: requestContext.request_id,
        provider: 'stripe',
        event_id: event.id,
        event_type: event.type,
        livemode: event.livemode,
      }),
    ),
  );

  // Handle event based on type
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(c, event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(c, event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(c, event.data.object);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(c, event.data.object);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(c, event.data.object);
        break;

      default:
        console.log(
          JSON.stringify({
            level: 'debug',
            type: 'webhook_unhandled_type',
            request_id: requestContext.request_id,
            provider: 'stripe',
            event_type: event.type,
          }),
        );
    }

    // Mark as processed
    await markProcessed(c.env.CACHE_KV, 'stripe', verified.eventId);

    return c.json({ received: true, status: 'processed' });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        type: 'webhook_handler_error',
        request_id: requestContext.request_id,
        provider: 'stripe',
        event_id: event.id,
        event_type: event.type,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    throw error;
  }
});

// =============================================================================
// Event Handlers
// =============================================================================

async function handleCheckoutCompleted(c: AppContext['Bindings'] & { env: AppContext['Bindings'] }, session: unknown): Promise<void> {
  // TODO: Implement
  // 1. Get org_id from client_reference_id or metadata
  // 2. Create/update subscription in Supabase
  // 3. Apply paid entitlements
  // 4. Provision free domain via CF for SaaS
  // 5. Call sale webhook if configured
  console.log('handleCheckoutCompleted - to be implemented', session);
}

async function handleSubscriptionUpdated(c: unknown, subscription: unknown): Promise<void> {
  // TODO: Implement
  // 1. Update subscription status in Supabase
  // 2. Update entitlements based on status
  console.log('handleSubscriptionUpdated - to be implemented', subscription);
}

async function handleSubscriptionDeleted(c: unknown, subscription: unknown): Promise<void> {
  // TODO: Implement
  // 1. Mark subscription as cancelled in Supabase
  // 2. Revert to free entitlements (show top bar)
  console.log('handleSubscriptionDeleted - to be implemented', subscription);
}

async function handleInvoicePaid(c: unknown, invoice: unknown): Promise<void> {
  // TODO: Implement
  // 1. Record payment in Supabase
  // 2. Reset dunning state if applicable
  console.log('handleInvoicePaid - to be implemented', invoice);
}

async function handleInvoicePaymentFailed(c: unknown, invoice: unknown): Promise<void> {
  // TODO: Implement
  // 1. Record failure in Supabase
  // 2. Start/advance dunning process
  console.log('handleInvoicePaymentFailed - to be implemented', invoice);
}
