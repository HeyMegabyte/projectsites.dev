import type { Env } from '../types/env.js';
import { captureException, captureMessage } from '../services/sentry.js';

const mockFetch = jest.fn().mockResolvedValue({ ok: true });
(global as any).fetch = mockFetch;

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    SENTRY_DSN: 'https://abc123@sentry.io/456789',
    ENVIRONMENT: 'test',
    ...overrides,
  } as unknown as Env;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── captureException ─────────────────────────────────────────

describe('captureException', () => {
  it('sends POST to https://sentry.io/api/456789/store/', async () => {
    const env = makeEnv();

    await captureException(env, new Error('boom'));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://sentry.io/api/456789/store/');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('includes X-Sentry-Auth header with publickey', async () => {
    const env = makeEnv();

    await captureException(env, new Error('test'));

    const [, options] = mockFetch.mock.calls[0];
    const authHeader = options.headers['X-Sentry-Auth'];
    expect(authHeader).toContain('sentry_key=abc123');
    expect(authHeader).toContain('sentry_version=7');
    expect(authHeader).toContain('sentry_client=project-sites/0.2.0');
  });

  it('includes exception type, value, and stacktrace', async () => {
    const env = makeEnv();
    const error = new TypeError('Cannot read property');

    await captureException(env, error);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.exception.values).toHaveLength(1);
    expect(body.exception.values[0].type).toBe('TypeError');
    expect(body.exception.values[0].value).toBe('Cannot read property');
    expect(body.exception.values[0].stacktrace).toBeDefined();
  });

  it('includes context tags (requestId, userId, orgId)', async () => {
    const env = makeEnv();

    await captureException(env, new Error('fail'), {
      requestId: 'req-001',
      userId: 'usr-002',
      orgId: 'org-003',
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tags.request_id).toBe('req-001');
    expect(body.tags.user_id).toBe('usr-002');
    expect(body.tags.org_id).toBe('org-003');
  });

  it('includes environment and service tags', async () => {
    const env = makeEnv();

    await captureException(env, new Error('fail'));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tags.environment).toBe('test');
    expect(body.tags.service).toBe('project-sites-worker');
  });

  it('skips if SENTRY_DSN is empty', async () => {
    const env = makeEnv({ SENTRY_DSN: '' });

    await captureException(env, new Error('fail'));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips if DSN is invalid URL', async () => {
    const env = makeEnv({ SENTRY_DSN: 'not-a-valid-dsn' });

    await captureException(env, new Error('fail'));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not throw on fetch error (silently fails)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const env = makeEnv();

    await expect(captureException(env, new Error('fail'))).resolves.not.toThrow();
  });

  it('parses stack trace frames correctly', async () => {
    const env = makeEnv();
    const error = new Error('stack test');
    error.stack = `Error: stack test
    at myFunction (/src/index.ts:42:10)
    at handleRequest (/src/handler.ts:15:5)`;

    await captureException(env, error);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const frames = body.exception.values[0].stacktrace.frames;
    expect(frames).toHaveLength(2);
    expect(frames[0].function).toBe('myFunction');
    expect(frames[0].filename).toBe('/src/index.ts');
    expect(frames[0].lineno).toBe(42);
    expect(frames[1].function).toBe('handleRequest');
    expect(frames[1].filename).toBe('/src/handler.ts');
    expect(frames[1].lineno).toBe(15);
  });

  it('handles error without stack trace', async () => {
    const env = makeEnv();
    const error = new Error('no stack');
    error.stack = undefined;

    await captureException(env, error);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.exception.values[0].stacktrace).toBeUndefined();
  });

  it('includes platform and server_name', async () => {
    const env = makeEnv();

    await captureException(env, new Error('test'));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.platform).toBe('javascript');
    expect(body.server_name).toBe('cloudflare-worker');
  });
});

// ─── captureMessage ───────────────────────────────────────────

describe('captureMessage', () => {
  it('sends message with specified level', async () => {
    const env = makeEnv();

    await captureMessage(env, 'Deployment completed', 'warning');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.message).toBe('Deployment completed');
    expect(body.level).toBe('warning');
  });

  it('defaults to info level', async () => {
    const env = makeEnv();

    await captureMessage(env, 'Hello world');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.level).toBe('info');
  });

  it('includes extra data', async () => {
    const env = makeEnv();

    await captureMessage(env, 'event happened', 'info', { count: 5, source: 'cron' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.extra.count).toBe(5);
    expect(body.extra.source).toBe('cron');
  });

  it('skips if no SENTRY_DSN', async () => {
    const env = makeEnv({ SENTRY_DSN: '' });

    await captureMessage(env, 'test message');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips if invalid DSN (unparseable URL)', async () => {
    const env = makeEnv({ SENTRY_DSN: ':::not-a-url' });

    await captureMessage(env, 'test message');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('includes platform and server_name', async () => {
    const env = makeEnv();

    await captureMessage(env, 'test');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.platform).toBe('javascript');
    expect(body.server_name).toBe('cloudflare-worker');
  });

  it('includes environment and service tags', async () => {
    const env = makeEnv();

    await captureMessage(env, 'test');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.tags.environment).toBe('test');
    expect(body.tags.service).toBe('project-sites-worker');
  });
});
