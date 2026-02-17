import type { Env } from '../types/env.js';
import {
  captureEvent,
  capturePageView,
  identifyUser,
  captureFunnelEvent,
} from '../services/analytics.js';

const mockFetch = jest.fn().mockResolvedValue({ ok: true });
(global as any).fetch = mockFetch;

function makeEnv(overrides?: Partial<Env>): Env {
  return {
    POSTHOG_API_KEY: 'phk_test123',
    POSTHOG_HOST: 'https://us.i.posthog.com',
    ...overrides,
  } as unknown as Env;
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── captureEvent ─────────────────────────────────────────────

describe('captureEvent', () => {
  it('sends POST to PostHog /capture/ endpoint', async () => {
    const env = makeEnv();

    await captureEvent(env, 'test_event', 'user-1');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://us.i.posthog.com/capture/');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/json');
  });

  it('includes api_key, event, distinct_id, and timestamp in request body', async () => {
    const env = makeEnv();

    await captureEvent(env, 'signup', 'user-42');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.api_key).toBe('phk_test123');
    expect(body.event).toBe('signup');
    expect(body.distinct_id).toBe('user-42');
    expect(body.timestamp).toBeDefined();
    // Timestamp should be a valid ISO string
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it('includes custom properties in request body', async () => {
    const env = makeEnv();

    await captureEvent(env, 'click', 'user-1', { button: 'submit', page: '/home' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.properties.button).toBe('submit');
    expect(body.properties.page).toBe('/home');
  });

  it('uses default host https://us.i.posthog.com when POSTHOG_HOST not set', async () => {
    const env = makeEnv({ POSTHOG_HOST: undefined });

    await captureEvent(env, 'test', 'user-1');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://us.i.posthog.com/capture/');
  });

  it('uses custom POSTHOG_HOST when set', async () => {
    const env = makeEnv({ POSTHOG_HOST: 'https://eu.posthog.com' });

    await captureEvent(env, 'test', 'user-1');

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe('https://eu.posthog.com/capture/');
  });

  it('skips if POSTHOG_API_KEY is empty string', async () => {
    const env = makeEnv({ POSTHOG_API_KEY: '' });

    await captureEvent(env, 'test', 'user-1');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('skips if POSTHOG_API_KEY is missing (undefined)', async () => {
    const env = makeEnv({ POSTHOG_API_KEY: undefined as unknown as string });

    await captureEvent(env, 'test', 'user-1');

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not throw on fetch error (logs instead)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const env = makeEnv();

    await expect(captureEvent(env, 'test', 'user-1')).resolves.not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('includes $lib and $lib_version in properties', async () => {
    const env = makeEnv();

    await captureEvent(env, 'test', 'user-1');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.properties.$lib).toBe('project-sites-worker');
    expect(body.properties.$lib_version).toBe('0.1.0');
  });
});

// ─── capturePageView ──────────────────────────────────────────

describe('capturePageView', () => {
  it('sends $pageview event with $current_url property', async () => {
    const env = makeEnv();

    await capturePageView(env, 'visitor-1', 'https://example.com/about');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe('$pageview');
    expect(body.properties.$current_url).toBe('https://example.com/about');
  });

  it('includes additional properties alongside $current_url', async () => {
    const env = makeEnv();

    await capturePageView(env, 'visitor-1', 'https://example.com/', { referrer: 'google.com' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.properties.$current_url).toBe('https://example.com/');
    expect(body.properties.referrer).toBe('google.com');
  });
});

// ─── identifyUser ─────────────────────────────────────────────

describe('identifyUser', () => {
  it('sends $identify event with $set properties', async () => {
    const env = makeEnv();

    await identifyUser(env, 'user-99', { email: 'a@b.com', plan: 'pro' });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe('$identify');
    expect(body.distinct_id).toBe('user-99');
    expect(body.properties.$set).toEqual({ email: 'a@b.com', plan: 'pro' });
  });

  it('skips if no API key', async () => {
    const env = makeEnv({ POSTHOG_API_KEY: '' });

    await identifyUser(env, 'user-99', { email: 'a@b.com' });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not throw on fetch error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const env = makeEnv();

    await expect(identifyUser(env, 'user-99', { email: 'a@b.com' })).resolves.not.toThrow();

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('includes timestamp in request body', async () => {
    const env = makeEnv();

    await identifyUser(env, 'user-99');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.timestamp).toBeDefined();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });
});

// ─── captureFunnelEvent ───────────────────────────────────────

describe('captureFunnelEvent', () => {
  it('sends funnel_{step} event with org_id and site_id', async () => {
    const env = makeEnv();

    await captureFunnelEvent(env, 'user-1', 'signup', 'org-abc', 'site-xyz');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe('funnel_signup');
    expect(body.properties.org_id).toBe('org-abc');
    expect(body.properties.site_id).toBe('site-xyz');
    expect(body.properties.funnel_step).toBe('signup');
  });

  it('handles missing orgId and siteId by sending null', async () => {
    const env = makeEnv();

    await captureFunnelEvent(env, 'user-1', 'landing');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe('funnel_landing');
    expect(body.properties.org_id).toBeNull();
    expect(body.properties.site_id).toBeNull();
  });
});
