/**
 * API routes index
 */
import { Hono } from 'hono';
import type { AppContext } from '../../types.js';

export const apiRoutes = new Hono<AppContext>();

// =============================================================================
// API Version and Info
// =============================================================================

apiRoutes.get('/', (c) => {
  return c.json({
    name: 'Project Sites API',
    version: '1.0.0',
    environment: c.env.ENVIRONMENT,
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// Placeholder routes (to be implemented)
// =============================================================================

// Auth routes
apiRoutes.get('/auth/me', (c) => {
  return c.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Auth routes not yet implemented' } }, 501);
});

// Org routes
apiRoutes.get('/orgs', (c) => {
  return c.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Org routes not yet implemented' } }, 501);
});

// Site routes
apiRoutes.get('/sites', (c) => {
  return c.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Site routes not yet implemented' } }, 501);
});

// Billing routes
apiRoutes.get('/billing', (c) => {
  return c.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Billing routes not yet implemented' } }, 501);
});

// Hostname routes
apiRoutes.get('/hostnames', (c) => {
  return c.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Hostname routes not yet implemented' } }, 501);
});

// Admin routes
apiRoutes.get('/admin', (c) => {
  return c.json({ error: { code: 'NOT_IMPLEMENTED', message: 'Admin routes not yet implemented' } }, 501);
});

// Config endpoint (public, for frontend)
apiRoutes.get('/config', (c) => {
  return c.json({
    data: {
      environment: c.env.ENVIRONMENT,
      stripe_publishable_key: c.env.STRIPE_PUBLISHABLE_KEY,
      google_client_id: c.env.GOOGLE_CLIENT_ID,
      features: {
        postcards_enabled: c.env.ENABLE_POSTCARDS === 'true',
        metering_provider: c.env.METERING_PROVIDER ?? 'internal',
      },
    },
  });
});
