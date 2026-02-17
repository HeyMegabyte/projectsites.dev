/**
 * Functional / integration tests for API routes.
 * Mounts the full route tree and tests multi-step flows.
 */

jest.mock('../services/db.js', () => ({
  dbQuery: jest.fn().mockResolvedValue({ data: [], error: null }),
  dbQueryOne: jest.fn().mockResolvedValue(null),
  dbInsert: jest.fn().mockResolvedValue({ error: null }),
  dbUpdate: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
  dbExecute: jest.fn().mockResolvedValue({ error: null, changes: 1 }),
}));

jest.mock('../services/audit.js', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../lib/sentry.js', () => ({
  captureError: jest.fn(),
  captureMessage: jest.fn(),
  createSentry: jest.fn(),
}));

jest.mock('../lib/posthog.js', () => ({
  capture: jest.fn(),
  trackAuth: jest.fn(),
  trackSite: jest.fn(),
  trackError: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';
import { dbQueryOne } from '../services/db.js';

const mockDbQueryOne = dbQueryOne as jest.Mock;

const originalFetch = global.fetch;
let mockFetch: jest.Mock;

const createMockEnv = (overrides: Partial<Env> = {}): Env =>
  ({
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    RESEND_API_KEY: 'test-resend-key',
    SENDGRID_API_KEY: 'test-sendgrid-key',
    GOOGLE_CLIENT_ID: 'test-google-id',
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
    STRIPE_SECRET_KEY: 'test-stripe-key',
    STRIPE_WEBHOOK_SECRET: 'test-stripe-webhook',
    ...overrides,
  }) as unknown as Env;

function createApp(envOverrides: Partial<Env> = {}) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.route('/', api);
  const env = createMockEnv(envOverrides);
  return { app, env };
}

function makeRequest(
  app: Hono<{ Bindings: Env; Variables: Variables }>,
  env: Env,
  path: string,
  options?: RequestInit,
) {
  return app.request(path, options, env);
}

function createAuthenticatedApp(
  vars: Partial<Variables> = {},
  envOverrides: Partial<Env> = {},
) {
  const authedApp = new Hono<{ Bindings: Env; Variables: Variables }>();
  authedApp.onError(errorHandler);
  authedApp.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  authedApp.route('/', api);
  const env = createMockEnv(envOverrides);
  return { app: authedApp, env };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  mockFetch = jest.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: 'mock-id' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  global.fetch = mockFetch;
});

afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = originalFetch;
});

// ─── Contact Form Routes ────────────────────────────────────

describe('POST /api/contact', () => {
  it('returns 200 with success for valid contact form', async () => {
    const { app, env } = createApp();

    const res = await makeRequest(app, env, '/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Jane Doe',
        email: 'jane@example.com',
        message: 'Hello, I have a question about your platform.',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.success).toBe(true);
    // Should have made 2 fetch calls (notification + confirmation emails)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns 400 for missing email', async () => {
    const { app, env } = createApp();

    const res = await makeRequest(app, env, '/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob',
        message: 'This is a test message.',
      }),
    });

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 for XSS in message', async () => {
    const { app, env } = createApp();

    const res = await makeRequest(app, env, '/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob',
        email: 'bob@test.com',
        message: 'Hello <script>alert("xss")</script> world',
      }),
    });

    expect(res.status).toBe(400);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns 400 for message too short', async () => {
    const { app, env } = createApp();

    const res = await makeRequest(app, env, '/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob',
        email: 'bob@test.com',
        message: 'Short',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('handles email provider failure gracefully', async () => {
    mockFetch.mockResolvedValue(new Response('error', { status: 500 }));
    const { app, env } = createApp();

    const res = await makeRequest(app, env, '/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob',
        email: 'bob@test.com',
        message: 'Testing email provider failure scenario.',
      }),
    });

    // Both providers fail → error propagated
    expect(res.status).toBe(400);
  });

  it('falls back to SendGrid when Resend fails', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response('error', { status: 500 }))   // Resend fails (notification)
      .mockResolvedValueOnce(new Response('', { status: 202 }))        // SendGrid succeeds
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'x' }), { status: 200 }));  // Resend succeeds (confirmation)

    const { app, env } = createApp();

    const res = await makeRequest(app, env, '/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Jane',
        email: 'jane@test.com',
        message: 'Testing Resend to SendGrid fallback.',
      }),
    });

    expect(res.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('returns error when no email provider configured', async () => {
    const { app, env } = createApp({
      RESEND_API_KEY: undefined,
      SENDGRID_API_KEY: undefined,
    } as any);

    const res = await makeRequest(app, env, '/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob',
        email: 'bob@test.com',
        message: 'Testing no email providers.',
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain('Email delivery is not configured');
  });
});

// ─── Auth Routes (unauthenticated) ──────────────────────────

describe('POST /api/auth/magic-link', () => {
  it('returns 400 for missing email', async () => {
    const { app, env } = createApp();

    const res = await makeRequest(app, env, '/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid email format', async () => {
    const { app, env } = createApp();

    const res = await makeRequest(app, env, '/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });

    expect(res.status).toBe(400);
  });
});

// ─── GET /api/auth/me ───────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('returns 401 when not authenticated', async () => {
    const { app, env } = createApp();

    const res = await makeRequest(app, env, '/api/auth/me');

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns user info when authenticated', async () => {
    mockDbQueryOne.mockResolvedValueOnce({
      email: 'alice@example.com',
      display_name: 'Alice',
    });

    const { app, env } = createAuthenticatedApp({
      userId: 'user-123',
      orgId: 'org-456',
    });

    const res = await makeRequest(app, env, '/api/auth/me');

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      user_id: 'user-123',
      org_id: 'org-456',
      email: 'alice@example.com',
      display_name: 'Alice',
    });
  });

  it('returns 401 when user not found in DB', async () => {
    mockDbQueryOne.mockResolvedValueOnce(null);

    const { app, env } = createAuthenticatedApp({
      userId: 'deleted-user',
      orgId: 'org-456',
    });

    const res = await makeRequest(app, env, '/api/auth/me');

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
