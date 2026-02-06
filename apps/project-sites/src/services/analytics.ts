import type { Env } from '../types/env.js';

/** PostHog event properties */
interface EventProperties {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * PostHog analytics client for Cloudflare Workers.
 * Server-side event capture via PostHog HTTP API.
 */
export async function captureEvent(
  env: Env,
  event: string,
  distinctId: string,
  properties: EventProperties = {},
): Promise<void> {
  if (!env.POSTHOG_API_KEY) return;

  const host = env.POSTHOG_HOST ?? 'https://us.i.posthog.com';

  try {
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.POSTHOG_API_KEY,
        event,
        distinct_id: distinctId,
        properties: {
          ...properties,
          $lib: 'project-sites-worker',
          $lib_version: '0.1.0',
        },
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'warn',
        service: 'analytics',
        message: 'Failed to capture PostHog event',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/**
 * Capture a page view event.
 */
export async function capturePageView(
  env: Env,
  distinctId: string,
  url: string,
  properties: EventProperties = {},
): Promise<void> {
  await captureEvent(env, '$pageview', distinctId, {
    $current_url: url,
    ...properties,
  });
}

/**
 * Identify a user with properties.
 */
export async function identifyUser(
  env: Env,
  distinctId: string,
  properties: EventProperties = {},
): Promise<void> {
  if (!env.POSTHOG_API_KEY) return;

  const host = env.POSTHOG_HOST ?? 'https://us.i.posthog.com';

  try {
    await fetch(`${host}/capture/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: env.POSTHOG_API_KEY,
        event: '$identify',
        distinct_id: distinctId,
        properties: { $set: properties },
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'warn',
        service: 'analytics',
        message: 'Failed to identify user in PostHog',
        error: err instanceof Error ? err.message : 'unknown',
      }),
    );
  }
}

/**
 * Capture funnel events for conversion tracking.
 */
export async function captureFunnelEvent(
  env: Env,
  distinctId: string,
  funnelStep: string,
  orgId?: string,
  siteId?: string,
): Promise<void> {
  await captureEvent(env, `funnel_${funnelStep}`, distinctId, {
    org_id: orgId ?? null,
    site_id: siteId ?? null,
    funnel_step: funnelStep,
  });
}
