/**
 * Tests for the workflow error serialization fix.
 * Ensures that workflow errors are always returned as strings
 * (never [object Object]) in the /api/sites/:id/workflow response.
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
  trackDomain: jest.fn(),
}));

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { errorHandler } from '../middleware/error_handler.js';
import { api } from '../routes/api.js';
import { dbQueryOne } from '../services/db.js';

const mockDbQueryOne = dbQueryOne as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function createAuthenticatedApp(vars: Partial<Variables> = {}, envOverrides: Partial<Env> = {}) {
  const authedApp = new Hono<{ Bindings: Env; Variables: Variables }>();
  authedApp.onError(errorHandler);
  authedApp.use('*', async (c, next) => {
    if (vars.userId) c.set('userId', vars.userId);
    if (vars.orgId) c.set('orgId', vars.orgId);
    if (vars.requestId) c.set('requestId', vars.requestId);
    await next();
  });
  authedApp.route('/', api);
  const env: Env = {
    ENVIRONMENT: 'test',
    DB: {} as D1Database,
    CACHE_KV: {} as KVNamespace,
    SITES_BUCKET: {} as R2Bucket,
    STRIPE_SECRET_KEY: 'test',
    STRIPE_PUBLISHABLE_KEY: 'test',
    STRIPE_WEBHOOK_SECRET: 'test',
    CF_API_TOKEN: 'test',
    CF_ZONE_ID: 'test',
    GOOGLE_CLIENT_ID: 'test',
    GOOGLE_CLIENT_SECRET: 'test',
    GOOGLE_PLACES_API_KEY: 'test',
    POSTHOG_API_KEY: 'test',
    AI: {} as Ai,
    PROMPT_STORE: {} as KVNamespace,
    SITE_WORKFLOW: null as unknown as Workflow,
    ...envOverrides,
  } as unknown as Env;
  return { app: authedApp, env };
}

describe('GET /api/sites/:id/workflow — error serialization', () => {
  it('serializes string errors correctly', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: 'site-1', status: 'building' });

    const mockWorkflow = {
      get: jest.fn().mockResolvedValue({
        id: 'wf-1',
        status: jest.fn().mockResolvedValue({
          status: 'errored',
          error: 'Something went wrong',
          output: null,
        }),
      }),
    };

    const { app, env } = createAuthenticatedApp(
      { userId: 'user-1', orgId: 'org-1' },
      { SITE_WORKFLOW: mockWorkflow as unknown as Workflow },
    );

    const res = await app.request('/api/sites/site-1/workflow', {}, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.workflow_error).toBe('Something went wrong');
    expect(typeof body.data.workflow_error).toBe('string');
  });

  it('serializes Error objects to their message string', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: 'site-1', status: 'building' });

    const mockWorkflow = {
      get: jest.fn().mockResolvedValue({
        id: 'wf-1',
        status: jest.fn().mockResolvedValue({
          status: 'errored',
          error: new Error('AI model timeout'),
          output: null,
        }),
      }),
    };

    const { app, env } = createAuthenticatedApp(
      { userId: 'user-1', orgId: 'org-1' },
      { SITE_WORKFLOW: mockWorkflow as unknown as Workflow },
    );

    const res = await app.request('/api/sites/site-1/workflow', {}, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.workflow_error).toBe('AI model timeout');
    expect(typeof body.data.workflow_error).toBe('string');
  });

  it('serializes plain objects with message property', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: 'site-1', status: 'building' });

    const mockWorkflow = {
      get: jest.fn().mockResolvedValue({
        id: 'wf-1',
        status: jest.fn().mockResolvedValue({
          status: 'errored',
          error: { message: 'Step failed', name: 'StepError', code: 500 },
          output: null,
        }),
      }),
    };

    const { app, env } = createAuthenticatedApp(
      { userId: 'user-1', orgId: 'org-1' },
      { SITE_WORKFLOW: mockWorkflow as unknown as Workflow },
    );

    const res = await app.request('/api/sites/site-1/workflow', {}, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.workflow_error).toBe('Step failed');
    expect(typeof body.data.workflow_error).toBe('string');
  });

  it('serializes plain objects without message to JSON', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: 'site-1', status: 'building' });

    const mockWorkflow = {
      get: jest.fn().mockResolvedValue({
        id: 'wf-1',
        status: jest.fn().mockResolvedValue({
          status: 'errored',
          error: { code: 'TIMEOUT', retries: 3 },
          output: null,
        }),
      }),
    };

    const { app, env } = createAuthenticatedApp(
      { userId: 'user-1', orgId: 'org-1' },
      { SITE_WORKFLOW: mockWorkflow as unknown as Workflow },
    );

    const res = await app.request('/api/sites/site-1/workflow', {}, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    // Should be a JSON string, not [object Object]
    expect(body.data.workflow_error).toContain('TIMEOUT');
    expect(typeof body.data.workflow_error).toBe('string');
    expect(body.data.workflow_error).not.toBe('[object Object]');
  });

  it('returns null when no error', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: 'site-1', status: 'published' });

    const mockWorkflow = {
      get: jest.fn().mockResolvedValue({
        id: 'wf-1',
        status: jest.fn().mockResolvedValue({
          status: 'complete',
          error: null,
          output: { version: 'v1' },
        }),
      }),
    };

    const { app, env } = createAuthenticatedApp(
      { userId: 'user-1', orgId: 'org-1' },
      { SITE_WORKFLOW: mockWorkflow as unknown as Workflow },
    );

    const res = await app.request('/api/sites/site-1/workflow', {}, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.workflow_error).toBeNull();
    expect(body.data.workflow_status).toBe('complete');
  });

  it('handles workflow not available', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: 'site-1', status: 'draft' });

    const { app, env } = createAuthenticatedApp(
      { userId: 'user-1', orgId: 'org-1' },
      { SITE_WORKFLOW: undefined as unknown as Workflow },
    );

    const res = await app.request('/api/sites/site-1/workflow', {}, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.workflow_available).toBe(false);
  });

  it('handles workflow instance not found', async () => {
    mockDbQueryOne.mockResolvedValueOnce({ id: 'site-1', status: 'building' });

    const mockWorkflow = {
      get: jest.fn().mockRejectedValue(new Error('Instance not found')),
    };

    const { app, env } = createAuthenticatedApp(
      { userId: 'user-1', orgId: 'org-1' },
      { SITE_WORKFLOW: mockWorkflow as unknown as Workflow },
    );

    const res = await app.request('/api/sites/site-1/workflow', {}, env);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.data.instance_id).toBeNull();
    expect(body.data.workflow_status).toBeNull();
  });
});
