/**
 * @module routes/health
 *
 * @description
 * Two-tier health surface for the Worker. Both endpoints are public, never
 * authenticated, and safe to hit at high frequency.
 *
 * - `GET /health` — lightweight liveness probe. Touches KV + R2 and returns
 *   200 with `status: "ok"` or `"degraded"` plus per-dependency latency.
 *   Suitable for uptime monitors (`uptimerobot`, `betteruptime`, CF Health
 *   Checks). Never returns 5xx — degraded deps surface in the JSON body so
 *   the probe can keep distinguishing transport errors from app errors.
 *
 * - `GET /health/deep` — full dependency walk: KV, R2, D1, AI binding.
 *   Returns HTTP **503** when any dep is degraded so orchestration tools
 *   (CF Workflows wait-for-healthy, Kubernetes-style readiness gates,
 *   deployment smoke tests) can use HTTP status alone. Also reports the
 *   serving colo (`cf.colo`) for region-level diagnostics.
 *
 * @remarks
 * Both endpoints intentionally probe with the literal key
 * `health-check-probe` — that R2 object never exists, which is the point:
 * the round-trip exercises the binding without polluting the bucket.
 *
 * @example
 * ```bash
 * # Lightweight liveness — always 200, body carries truth
 * curl https://projectsites.dev/health
 *
 * # Strict readiness — HTTP 503 if any dep is down
 * curl -fSL https://projectsites.dev/health/deep
 * ```
 */
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
