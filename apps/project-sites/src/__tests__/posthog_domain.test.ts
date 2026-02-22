/**
 * Tests for the PostHog domain tracking function.
 */

import * as posthog from '../lib/posthog.js';

const originalFetch = global.fetch;

const mockEnv = {
  POSTHOG_API_KEY: 'test-posthog-key',
  POSTHOG_HOST: 'https://test.posthog.com',
  ENVIRONMENT: 'test',
} as any;

const mockCtx = {
  waitUntil: jest.fn(),
} as unknown as ExecutionContext;

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn().mockResolvedValue(new Response('ok'));
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('trackDomain', () => {
  it('sends domain event to PostHog', () => {
    posthog.trackDomain(mockEnv, mockCtx, 'provisioned', 'user-1', {
      hostname: 'test.example.com',
      type: 'custom_cname',
    });

    expect(mockCtx.waitUntil).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('posthog.com/capture/'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('domain_provisioned'),
      }),
    );
  });

  it('includes hostname and type in properties', () => {
    posthog.trackDomain(mockEnv, mockCtx, 'verified', 'user-2', {
      hostname: 'app.mysite.com',
      type: 'custom_cname',
      status: 'active',
    });

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);

    expect(body.event).toBe('domain_verified');
    expect(body.distinct_id).toBe('user-2');
    expect(body.properties.hostname).toBe('app.mysite.com');
    expect(body.properties.type).toBe('custom_cname');
    expect(body.properties.status).toBe('active');
  });

  it('no-ops when POSTHOG_API_KEY is not set', () => {
    const envNoKey = { ...mockEnv, POSTHOG_API_KEY: '' };

    posthog.trackDomain(envNoKey, mockCtx, 'provisioned', 'user-1');

    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockCtx.waitUntil).not.toHaveBeenCalled();
  });
});

describe('capture', () => {
  it('sends event with correct API key', () => {
    posthog.capture(mockEnv, mockCtx, {
      event: 'test_event',
      distinctId: 'user-1',
      properties: { key: 'value' },
    });

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);

    expect(body.api_key).toBe('test-posthog-key');
    expect(body.event).toBe('test_event');
    expect(body.distinct_id).toBe('user-1');
    expect(body.properties.key).toBe('value');
    expect(body.properties.$lib).toBe('project-sites-worker');
  });

  it('uses default PostHog URL when POSTHOG_HOST not set', () => {
    const envNoHost = { ...mockEnv, POSTHOG_HOST: undefined };

    posthog.capture(envNoHost, mockCtx, {
      event: 'test_event',
      distinctId: 'user-1',
    });

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    expect(fetchCall[0]).toContain('us.i.posthog.com/capture/');
  });
});

describe('trackSite', () => {
  it('sends site event', () => {
    posthog.trackSite(mockEnv, mockCtx, 'created', 'user-1', {
      site_id: 'site-123',
    });

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);

    expect(body.event).toBe('site_created');
    expect(body.properties.site_id).toBe('site-123');
  });
});

describe('trackError', () => {
  it('sends error event with system distinct ID', () => {
    posthog.trackError(mockEnv, mockCtx, 'api_error', 'Something failed', {
      route: '/api/test',
    });

    const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);

    expect(body.event).toBe('server_error');
    expect(body.distinct_id).toBe('system');
    expect(body.properties.error_type).toBe('api_error');
    expect(body.properties.error_message).toBe('Something failed');
    expect(body.properties.route).toBe('/api/test');
  });
});
