/**
 * Unit tests for the dynamic /api/sites/by-slug/:slug/chat endpoint.
 *
 * The endpoint reads ALL current files from R2 and dynamically constructs
 * a bolt.diy-compatible chat JSON with boltArtifact/boltAction tags.
 * No static chat.json is needed — always in sync with latest files.
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

function createApp(r2GetMock: jest.Mock, dbPrepare?: jest.Mock) {
  const env = {
    ENVIRONMENT: 'test',
    DB: {
      prepare: dbPrepare ?? jest.fn().mockReturnValue({
        bind: jest.fn().mockReturnValue({
          first: jest.fn().mockResolvedValue({ business_name: "Test Business" }),
          all: jest.fn().mockResolvedValue({ results: [] }),
          run: jest.fn().mockResolvedValue({}),
        }),
      }),
    } as unknown as D1Database,
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
  it('returns 200 with dynamically built chat JSON containing boltArtifact', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/test-site/_manifest.json') {
          return Promise.resolve(createMockR2Object({
            current_version: 'v1',
            files: ['index.html', 'about.html', 'robots.txt'],
          }));
        }
        if (key === 'sites/test-site/v1/index.html') {
          return Promise.resolve(createMockR2Object('<!DOCTYPE html><html><body><h1>Test</h1></body></html>'));
        }
        if (key === 'sites/test-site/v1/about.html') {
          return Promise.resolve(createMockR2Object('<!DOCTYPE html><html><body><h1>About</h1></body></html>'));
        }
        if (key === 'sites/test-site/v1/robots.txt') {
          return Promise.resolve(createMockR2Object('User-agent: *\nAllow: /'));
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/test-site/chat', {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();

    // Must have two messages (user + assistant)
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[1].role).toBe('assistant');

    // Assistant message must contain boltArtifact with file actions
    const content = body.messages[1].content;
    expect(content).toContain('<boltArtifact');
    expect(content).toContain('</boltArtifact>');
    expect(content).toContain('<boltAction type="file" filePath="index.html">');
    expect(content).toContain('<boltAction type="file" filePath="about.html">');
    expect(content).toContain('<boltAction type="file" filePath="robots.txt">');

    // File content must be embedded
    expect(content).toContain('<!DOCTYPE html>');
    expect(content).toContain('User-agent');

    // Must have description and exportDate
    expect(body.description).toBeTruthy();
    expect(body.exportDate).toBeTruthy();
  });

  it('returns CORS header Access-Control-Allow-Origin: *', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/test-site/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: 'v1', files: ['index.html'] }));
        }
        if (key === 'sites/test-site/v1/index.html') {
          return Promise.resolve(createMockR2Object('<html></html>'));
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/test-site/chat', {}, env);

    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('filters out research.json and _meta/ files', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/test-site/_manifest.json') {
          return Promise.resolve(createMockR2Object({
            current_version: 'v1',
            files: ['index.html', 'research.json', '_meta/chat.json'],
          }));
        }
        if (key === 'sites/test-site/v1/index.html') {
          return Promise.resolve(createMockR2Object('<html></html>'));
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/test-site/chat', {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    const content = body.messages[1].content;
    expect(content).not.toContain('filePath="research.json"');
    expect(content).not.toContain('filePath="_meta/');
  });

  it('does not require authentication (slug is access token)', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/public-site/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: 'v1', files: ['index.html'] }));
        }
        if (key === 'sites/public-site/v1/index.html') {
          return Promise.resolve(createMockR2Object('<html></html>'));
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    // No Authorization header
    const res = await app.request('/api/sites/by-slug/public-site/chat', {}, env);

    expect(res.status).toBe(200);
  });

  it('returns Cache-Control: no-cache, no-store, must-revalidate', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/test-site/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: 'v1', files: ['index.html'] }));
        }
        if (key === 'sites/test-site/v1/index.html') {
          return Promise.resolve(createMockR2Object('<html></html>'));
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/test-site/chat', {}, env);

    expect(res.headers.get('Cache-Control')).toBe('no-cache, no-store, must-revalidate');
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

  it('returns 404 when no files found in R2', async () => {
    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/empty-site/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: 'v1', files: ['index.html'] }));
        }
        // All file reads return null
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get);
    const res = await app.request('/api/sites/by-slug/empty-site/chat', {}, env);

    expect(res.status).toBe(404);
  });

  it('looks up business name from D1', async () => {
    const dbPrepare = jest.fn().mockReturnValue({
      bind: jest.fn().mockReturnValue({
        first: jest.fn().mockResolvedValue({ business_name: "Vito's Mens Salon" }),
        all: jest.fn().mockResolvedValue({ results: [] }),
        run: jest.fn().mockResolvedValue({}),
      }),
    });

    const r2Get = jest.fn()
      .mockImplementation((key: string) => {
        if (key === 'sites/vitos-mens-salon/_manifest.json') {
          return Promise.resolve(createMockR2Object({ current_version: 'v1', files: ['index.html'] }));
        }
        if (key === 'sites/vitos-mens-salon/v1/index.html') {
          return Promise.resolve(createMockR2Object('<html></html>'));
        }
        return Promise.resolve(null);
      });

    const { app, env } = createApp(r2Get, dbPrepare);
    const res = await app.request('/api/sites/by-slug/vitos-mens-salon/chat', {}, env);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.description).toContain("Vito's Mens Salon");
    expect(body.messages[0].content).toContain("Vito's Mens Salon");
  });
});
