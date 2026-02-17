import { Hono } from 'hono';
import { health } from '../routes/health.js';

/**
 * Integration tests for the /health route.
 * Mocks KV and R2 bindings passed via Hono's app.request() env parameter.
 */

const createApp = (envOverrides: Record<string, unknown> = {}) => {
  const mockEnv = {
    ENVIRONMENT: 'test',
    CACHE_KV: { get: jest.fn().mockResolvedValue(null) },
    SITES_BUCKET: { head: jest.fn().mockResolvedValue(null) },
    ...envOverrides,
  };

  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.route('/', health);

  return { app, mockEnv };
};

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── Happy path ────────────────────────────────────────────────

describe('GET /health - happy path', () => {
  it('returns 200 status', async () => {
    const { app, mockEnv } = createApp();
    const res = await app.request('/health', undefined, mockEnv);

    expect(res.status).toBe(200);
  });

  it('returns status ok when all checks pass', async () => {
    const { app, mockEnv } = createApp();
    const res = await app.request('/health', undefined, mockEnv);
    const body = await res.json();

    expect(body.status).toBe('ok');
  });

  it('response includes version, environment, timestamp, latency_ms, and checks', async () => {
    const { app, mockEnv } = createApp();
    const res = await app.request('/health', undefined, mockEnv);
    const body = await res.json();

    expect(body).toHaveProperty('version', '0.1.0');
    expect(body).toHaveProperty('environment', 'test');
    expect(body).toHaveProperty('timestamp');
    expect(body).toHaveProperty('latency_ms');
    expect(typeof body.latency_ms).toBe('number');
    expect(body).toHaveProperty('checks');
    expect(body.checks).toHaveProperty('kv');
    expect(body.checks).toHaveProperty('r2');
  });

  it('kv and r2 checks report ok status with latency_ms', async () => {
    const { app, mockEnv } = createApp();
    const res = await app.request('/health', undefined, mockEnv);
    const body = await res.json();

    expect(body.checks.kv.status).toBe('ok');
    expect(typeof body.checks.kv.latency_ms).toBe('number');
    expect(body.checks.r2.status).toBe('ok');
    expect(typeof body.checks.r2.latency_ms).toBe('number');
  });
});

// ─── KV failure ────────────────────────────────────────────────

describe('GET /health - KV failure', () => {
  it('returns degraded when KV throws', async () => {
    const { app, mockEnv } = createApp({
      CACHE_KV: { get: jest.fn().mockRejectedValue(new Error('KV is down')) },
    });
    const res = await app.request('/health', undefined, mockEnv);
    const body = await res.json();

    expect(body.status).toBe('degraded');
  });

  it('KV check includes error message', async () => {
    const { app, mockEnv } = createApp({
      CACHE_KV: { get: jest.fn().mockRejectedValue(new Error('KV connection timeout')) },
    });
    const res = await app.request('/health', undefined, mockEnv);
    const body = await res.json();

    expect(body.checks.kv.status).toBe('error');
    expect(body.checks.kv.message).toBe('KV connection timeout');
  });
});

// ─── R2 failure ────────────────────────────────────────────────

describe('GET /health - R2 failure', () => {
  it('returns degraded when R2 throws', async () => {
    const { app, mockEnv } = createApp({
      SITES_BUCKET: { head: jest.fn().mockRejectedValue(new Error('R2 is down')) },
    });
    const res = await app.request('/health', undefined, mockEnv);
    const body = await res.json();

    expect(body.status).toBe('degraded');
  });

  it('R2 check includes error message', async () => {
    const { app, mockEnv } = createApp({
      SITES_BUCKET: { head: jest.fn().mockRejectedValue(new Error('R2 bucket unreachable')) },
    });
    const res = await app.request('/health', undefined, mockEnv);
    const body = await res.json();

    expect(body.checks.r2.status).toBe('error');
    expect(body.checks.r2.message).toBe('R2 bucket unreachable');
  });
});

// ─── Both fail ─────────────────────────────────────────────────

describe('GET /health - both KV and R2 fail', () => {
  it('returns degraded when both KV and R2 throw', async () => {
    const { app, mockEnv } = createApp({
      CACHE_KV: { get: jest.fn().mockRejectedValue(new Error('KV fail')) },
      SITES_BUCKET: { head: jest.fn().mockRejectedValue(new Error('R2 fail')) },
    });
    const res = await app.request('/health', undefined, mockEnv);
    const body = await res.json();

    expect(body.status).toBe('degraded');
    expect(body.checks.kv.status).toBe('error');
    expect(body.checks.r2.status).toBe('error');
  });
});

// ─── Edge cases ────────────────────────────────────────────────

describe('GET /health - edge cases', () => {
  it('defaults environment to development when ENVIRONMENT is not set', async () => {
    const { app } = createApp();
    // Pass env without ENVIRONMENT key
    const envWithoutEnv = {
      CACHE_KV: { get: jest.fn().mockResolvedValue(null) },
      SITES_BUCKET: { head: jest.fn().mockResolvedValue(null) },
    };
    const res = await app.request('/health', undefined, envWithoutEnv);
    const body = await res.json();

    expect(body.environment).toBe('development');
  });

  it('timestamp is a valid ISO 8601 format', async () => {
    const { app, mockEnv } = createApp();
    const res = await app.request('/health', undefined, mockEnv);
    const body = await res.json();

    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
    expect(isNaN(parsed.getTime())).toBe(false);
  });

  it('KV error from non-Error thrown value uses fallback message', async () => {
    const { app, mockEnv } = createApp({
      CACHE_KV: { get: jest.fn().mockRejectedValue('string error') },
    });
    const res = await app.request('/health', undefined, mockEnv);
    const body = await res.json();

    expect(body.checks.kv.status).toBe('error');
    expect(body.checks.kv.message).toBe('KV check failed');
  });

  it('R2 error from non-Error thrown value uses fallback message', async () => {
    const { app, mockEnv } = createApp({
      SITES_BUCKET: { head: jest.fn().mockRejectedValue(42) },
    });
    const res = await app.request('/health', undefined, mockEnv);
    const body = await res.json();

    expect(body.checks.r2.status).toBe('error');
    expect(body.checks.r2.message).toBe('R2 check failed');
  });
});
