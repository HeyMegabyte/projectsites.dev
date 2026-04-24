import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';

const health = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Health check endpoint.
 * Returns system status and optional dependency checks.
 */
health.get('/health', async (c) => {
  const startTime = Date.now();
  const checks: Record<string, { status: 'ok' | 'error'; latency_ms?: number; message?: string }> =
    {};

  // Check KV
  try {
    const kvStart = Date.now();
    await c.env.CACHE_KV.get('health-check-probe');
    checks['kv'] = { status: 'ok', latency_ms: Date.now() - kvStart };
  } catch (err) {
    checks['kv'] = {
      status: 'error',
      message: err instanceof Error ? err.message : 'KV check failed',
    };
  }

  // Check R2
  try {
    const r2Start = Date.now();
    await c.env.SITES_BUCKET.head('health-check-probe');
    checks['r2'] = { status: 'ok', latency_ms: Date.now() - r2Start };
  } catch (err) {
    checks['r2'] = {
      status: 'error',
      message: err instanceof Error ? err.message : 'R2 check failed',
    };
  }

  const hasErrors = Object.values(checks).some((ch) => ch.status === 'error');

  return c.json({
    status: hasErrors ? 'degraded' : 'ok',
    version: '0.1.0',
    environment: c.env.ENVIRONMENT ?? 'development',
    timestamp: new Date().toISOString(),
    latency_ms: Date.now() - startTime,
    checks,
  });
});

/**
 * Deep health check with full dependency verification.
 * Checks: D1, KV, R2. Returns 503 if any dependency is degraded.
 */
health.get('/health/deep', async (c) => {
  const startTime = Date.now();
  const checks: Record<string, { status: 'ok' | 'error'; latency_ms?: number; message?: string }> =
    {};

  // Check KV
  try {
    const kvStart = Date.now();
    await c.env.CACHE_KV.get('health-check-probe');
    checks['kv'] = { status: 'ok', latency_ms: Date.now() - kvStart };
  } catch (err) {
    checks['kv'] = {
      status: 'error',
      message: err instanceof Error ? err.message : 'KV check failed',
    };
  }

  // Check R2
  try {
    const r2Start = Date.now();
    await c.env.SITES_BUCKET.head('health-check-probe');
    checks['r2'] = { status: 'ok', latency_ms: Date.now() - r2Start };
  } catch (err) {
    checks['r2'] = {
      status: 'error',
      message: err instanceof Error ? err.message : 'R2 check failed',
    };
  }

  // Check D1
  try {
    const d1Start = Date.now();
    await c.env.DB.prepare('SELECT 1').first();
    checks['d1'] = { status: 'ok', latency_ms: Date.now() - d1Start };
  } catch (err) {
    checks['d1'] = {
      status: 'error',
      message: err instanceof Error ? err.message : 'D1 check failed',
    };
  }

  // Check AI binding
  try {
    const aiStart = Date.now();
    checks['ai'] = { status: c.env.AI ? 'ok' : 'error', latency_ms: Date.now() - aiStart };
  } catch {
    checks['ai'] = { status: 'error', message: 'AI binding unavailable' };
  }

  const hasErrors = Object.values(checks).some((ch) => ch.status === 'error');
  const statusCode = hasErrors ? 503 : 200;

  return c.json(
    {
      status: hasErrors ? 'degraded' : 'operational',
      version: '1.5.0',
      environment: c.env.ENVIRONMENT ?? 'development',
      timestamp: new Date().toISOString(),
      region: (c.req.raw as unknown as { cf?: { colo?: string } }).cf?.colo ?? 'unknown',
      latency_ms: Date.now() - startTime,
      checks,
    },
    statusCode,
  );
});

export { health };
