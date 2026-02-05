/**
 * Webhook routes
 * All webhooks go through signature verification and idempotency checks
 */
import { Hono } from 'hono';
import type { AppContext } from '../../types.js';
import { stripeWebhooks } from './stripe.js';

export const webhookRoutes = new Hono<AppContext>();

// =============================================================================
// Stripe Webhooks
// =============================================================================

webhookRoutes.route('/stripe', stripeWebhooks);

// =============================================================================
// Placeholder routes for other providers
// =============================================================================

webhookRoutes.post('/dub', (c) => {
  return c.json({ received: true, provider: 'dub', status: 'not_implemented' });
});

webhookRoutes.post('/chatwoot', (c) => {
  return c.json({ received: true, provider: 'chatwoot', status: 'not_implemented' });
});

webhookRoutes.post('/novu', (c) => {
  return c.json({ received: true, provider: 'novu', status: 'not_implemented' });
});

webhookRoutes.post('/lago', (c) => {
  return c.json({ received: true, provider: 'lago', status: 'not_implemented' });
});
