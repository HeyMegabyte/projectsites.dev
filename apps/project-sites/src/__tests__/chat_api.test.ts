/**
 * Unit tests for the /api/sites/by-slug/:slug/chat endpoint.
 * Verifies chat.json retrieval from R2, format validation, error cases.
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

function createMockR2Object(data: unknown) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  return {
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(typeof data === 'string' ? JSON.parse(data) : data),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
  };
}

function createApp(r2GetMock: jest.Mock) {
  const env = {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    SITES_BUCKET: {
      get: r2GetMock,
      put: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue({ objects: [], truncated: false }),
    },
    RESEND_API_KEY: 'test-resend-key',
    SENDGRID_API_KEY: 'test-sendgrid-key',
    GOOGLE_CLIENT_ID: 'test-google-id',
    GOOGLE_CLIENT_SECRET: 'test-google-secret',
    STRIPE_SECRET_KEY: 'test-stripe-key',
    STRIPE_WEBHOOK_SECRET: 'test-stripe-webhook',
  } as unknown as Env;

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.onError(errorHandler);
  app.route('/', api);

  return { app, env };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/sites/by-slug/:slug/chat', () => {
  const validChatData = {
    messages: [
      { id: 'msg-1', role: 'user', content: 'Build me a pizza shop website' },
      { id: 'msg-2', role: 'assistant', content: 'I will create a professional pizza shop website...' },
    ],
    description: 'Pizza Shop Website',
    exportDate: '2025-02-21T10:00:00.000Z',
  };

  it('returns 200 with valid chat JSON when site exists', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/test-site/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: '2025-01-01T00-00-00Z' }));
        }
        if (key === 'sites/test-site/2025-01-01T00-00-00Z/_meta/chat.json') {
          return Promise.resolve(createMockR2Object(validChatData));
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/test-site/chat', {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[1].role).toBe('assistant');
    expect(body.description).toBe('Pizza Shop Website');
  });

  it('returns Content-Type application/json', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/test-site/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: 'v1' }));
        }
        if (key === 'sites/test-site/v1/_meta/chat.json') {
          return Promise.resolve(createMockR2Object(validChatData));
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/test-site/chat', {}, env);

    expect(res.headers.get('Content-Type')).toContain('application/json');
  });

  it('returns CORS header Access-Control-Allow-Origin: *', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/test-site/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: 'v1' }));
        }
        if (key === 'sites/test-site/v1/_meta/chat.json') {
          return Promise.resolve(createMockR2Object(validChatData));
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/test-site/chat', {}, env);

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('returns 404 when manifest does not exist', async () => {
    const r2Get = jest.fn().mockResolvedValue(null);

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/nonexistent/chat', {}, env);

    expect(res.status).toBe(404);
  });

  it('returns 404 when manifest has no current_version', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/no-version/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: '' }));
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/no-version/chat', {}, env);

    expect(res.status).toBe(404);
  });

  it('falls back to root chat.json when _meta/chat.json is missing', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/root-chat/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: 'v1' }));
        }
        if (key === 'sites/root-chat/v1/_meta/chat.json') {
          return Promise.resolve(null); // _meta not found
        }
        if (key === 'sites/root-chat/v1/chat.json') {
          return Promise.resolve(createMockR2Object(validChatData)); // found in root
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/root-chat/chat', {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.messages).toHaveLength(2);
  });

  it('returns 404 when chat.json does not exist in R2', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/no-chat/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: 'v1' }));
        }
        // chat.json not found
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/no-chat/chat', {}, env);

    expect(res.status).toBe(404);
  });

  it('does not require authentication (slug is access token)', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/public-site/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: 'v1' }));
        }
        if (key === 'sites/public-site/v1/_meta/chat.json') {
          return Promise.resolve(createMockR2Object(validChatData));
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    // No Authorization header
    const res = await app.request('/api/sites/by-slug/public-site/chat', {}, env);

    expect(res.status).toBe(200);
  });

  it('returns Cache-Control: no-cache header', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/test-site/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: 'v1' }));
        }
        if (key === 'sites/test-site/v1/_meta/chat.json') {
          return Promise.resolve(createMockR2Object(validChatData));
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/test-site/chat', {}, env);

    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });
});
