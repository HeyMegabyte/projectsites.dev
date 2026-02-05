import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';
import {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  internalError,
} from '@project-sites/shared';
import { z } from 'zod';

/**
 * Integration tests for the error handler middleware.
 * Creates a real Hono app with the error handler attached and tests
 * actual HTTP responses for each error type.
 */

const createApp = () => {
  const app = new Hono<{ Bindings: any; Variables: any }>();
  app.onError(errorHandler);

  // Route that throws a 400 AppError
  app.get('/throw-app-error-400', (c) => {
    throw badRequest('Bad input');
  });

  // Route that throws a 500 AppError
  app.get('/throw-app-error-500', (c) => {
    throw internalError('Server broke');
  });

  // Route that throws a 401 AppError
  app.get('/throw-app-error-401', (c) => {
    throw unauthorized('Not allowed');
  });

  // Route that throws a 403 AppError
  app.get('/throw-app-error-403', (c) => {
    throw forbidden('No access');
  });

  // Route that throws a 404 AppError
  app.get('/throw-app-error-404', (c) => {
    throw notFound('Missing resource');
  });

  // Route that triggers a ZodError
  app.get('/throw-zod-error', (c) => {
    z.string().parse(123);
    return c.text('ok');
  });

  // Route that triggers a ZodError with an object schema (multiple issues)
  app.get('/throw-zod-error-multi', (c) => {
    z.object({ name: z.string(), age: z.number() }).parse({ name: 42, age: 'not-a-number' });
    return c.text('ok');
  });

  // Route that throws a standard Error
  app.get('/throw-unknown', (c) => {
    throw new Error('something broke');
  });

  // Route that throws a non-standard Error (TypeError, not AppError or ZodError)
  app.get('/throw-string', () => {
    throw new TypeError('type mismatch error');
  });

  // Route that sets a requestId before throwing
  app.get('/throw-with-request-id', (c) => {
    c.set('requestId', 'req-xyz-789');
    throw badRequest('Known request');
  });

  // Healthy route
  app.get('/ok', (c) => c.text('ok'));

  return app;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ─── AppError handling ─────────────────────────────────────────

describe('errorHandler - AppError handling', () => {
  it('returns correct status code for 400 error', async () => {
    const app = createApp();
    const res = await app.request('/throw-app-error-400');

    expect(res.status).toBe(400);
  });

  it('returns JSON body with code and message', async () => {
    const app = createApp();
    const res = await app.request('/throw-app-error-400');
    const body = await res.json();

    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('BAD_REQUEST');
    expect(body.error.message).toBe('Bad input');
  });

  it('logs with warn level for 4xx errors', async () => {
    const consoleSpy = jest.spyOn(console, 'error');
    const app = createApp();
    await app.request('/throw-app-error-400');

    const logCall = consoleSpy.mock.calls.find((call) => {
      const parsed = JSON.parse(call[0] as string);
      return parsed.code === 'BAD_REQUEST';
    });
    expect(logCall).toBeDefined();
    const parsed = JSON.parse(logCall![0] as string);
    expect(parsed.level).toBe('warn');
  });

  it('returns correct status code for 500 error and logs with error level', async () => {
    const consoleSpy = jest.spyOn(console, 'error');
    const app = createApp();
    const res = await app.request('/throw-app-error-500');

    expect(res.status).toBe(500);

    const logCall = consoleSpy.mock.calls.find((call) => {
      const parsed = JSON.parse(call[0] as string);
      return parsed.code === 'INTERNAL_ERROR' && parsed.message === 'Server broke';
    });
    expect(logCall).toBeDefined();
    const parsed = JSON.parse(logCall![0] as string);
    expect(parsed.level).toBe('error');
  });
});

// ─── ZodError handling ─────────────────────────────────────────

describe('errorHandler - ZodError handling', () => {
  it('returns 400 status for validation errors', async () => {
    const app = createApp();
    const res = await app.request('/throw-zod-error');

    expect(res.status).toBe(400);
  });

  it('returns JSON body with VALIDATION_ERROR code', async () => {
    const app = createApp();
    const res = await app.request('/throw-zod-error');
    const body = await res.json();

    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Request validation failed');
    expect(body.error).toHaveProperty('request_id');
  });

  it('includes issues array with path and message', async () => {
    const app = createApp();
    const res = await app.request('/throw-zod-error-multi');
    const body = await res.json();

    expect(body.error.details).toBeDefined();
    expect(Array.isArray(body.error.details.issues)).toBe(true);
    expect(body.error.details.issues.length).toBeGreaterThanOrEqual(2);

    for (const issue of body.error.details.issues) {
      expect(issue).toHaveProperty('path');
      expect(issue).toHaveProperty('message');
      expect(typeof issue.path).toBe('string');
      expect(typeof issue.message).toBe('string');
    }
  });
});

// ─── Unknown error handling ────────────────────────────────────

describe('errorHandler - Unknown error handling', () => {
  it('returns 500 for standard Error', async () => {
    const app = createApp();
    const res = await app.request('/throw-unknown');

    expect(res.status).toBe(500);
  });

  it('returns JSON body with INTERNAL_ERROR code and generic message', async () => {
    const app = createApp();
    const res = await app.request('/throw-unknown');
    const body = await res.json();

    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Internal server error');
    expect(body.error).toHaveProperty('request_id');
  });

  it('returns 500 for non-AppError/non-ZodError thrown values (TypeError)', async () => {
    const app = createApp();
    const res = await app.request('/throw-string');

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});

// ─── General behavior ──────────────────────────────────────────

describe('errorHandler - General behavior', () => {
  it('uses unknown as request_id when not set', async () => {
    const app = createApp();
    const res = await app.request('/throw-app-error-400');
    const body = await res.json();

    expect(body.error.request_id).toBeUndefined();

    // Verify the console log used 'unknown' as the request_id
    const consoleSpy = jest.spyOn(console, 'error');
    await app.request('/throw-app-error-400');
    const logCall = consoleSpy.mock.calls.find((call) => {
      try {
        const parsed = JSON.parse(call[0] as string);
        return parsed.code === 'BAD_REQUEST';
      } catch {
        return false;
      }
    });
    expect(logCall).toBeDefined();
    const parsed = JSON.parse(logCall![0] as string);
    expect(parsed.request_id).toBe('unknown');
  });

  it('successful routes are not affected by error handler', async () => {
    const app = createApp();
    const res = await app.request('/ok');

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe('ok');
  });
});
