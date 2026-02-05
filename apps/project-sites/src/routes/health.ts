/**
 * Health check routes
 */
import { Hono } from 'hono';
import type { AppContext } from '../types.js';

export const healthRoutes = new Hono<AppContext>();

// Basic health check
healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: c.env.ENVIRONMENT,
  });
});

// Detailed health check (includes dependencies)
healthRoutes.get('/ready', async (c) => {
  const checks: Record<string, { status: 'ok' | 'error'; latency_ms?: number; error?: string }> =
    {};

  // Check KV
  try {
    const start = Date.now();
    await c.env.CACHE_KV.get('health-check');
    checks.kv = { status: 'ok', latency_ms: Date.now() - start };
  } catch (error) {
    checks.kv = { status: 'error', error: error instanceof Error ? error.message : 'Unknown' };
  }

  // Check R2
  try {
    const start = Date.now();
    await c.env.SITES_BUCKET.head('health-check');
    checks.r2 = { status: 'ok', latency_ms: Date.now() - start };
  } catch (error) {
    // R2 returns null for missing objects, error means actual failure
    if (error instanceof Error && !error.message.includes('not found')) {
      checks.r2 = { status: 'error', error: error.message };
    } else {
      checks.r2 = { status: 'ok', latency_ms: 0 };
    }
  }

  // Check Supabase connectivity
  try {
    const start = Date.now();
    const response = await fetch(`${c.env.SUPABASE_URL}/rest/v1/`, {
      method: 'HEAD',
      headers: {
        apikey: c.env.SUPABASE_ANON_KEY,
      },
    });
    checks.supabase = {
      status: response.ok ? 'ok' : 'error',
      latency_ms: Date.now() - start,
      ...(response.ok ? {} : { error: `HTTP ${response.status}` }),
    };
  } catch (error) {
    checks.supabase = { status: 'error', error: error instanceof Error ? error.message : 'Unknown' };
  }

  // Determine overall status
  const allOk = Object.values(checks).every((check) => check.status === 'ok');

  return c.json(
    {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      environment: c.env.ENVIRONMENT,
      checks,
    },
    allOk ? 200 : 503,
  );
});

// Liveness probe (minimal)
healthRoutes.get('/live', (c) => {
  return c.text('OK', 200);
});
