/**
 * @module services/analytics
 *
 * @description
 * Server-side PostHog event capture for the Project Sites Worker. PostHog's
 * official browser SDK does not run cleanly under the Workers runtime
 * (relies on `localStorage` + cookies), so we POST directly to the public
 * capture endpoint (PostHog, 2024). Every call is fire-and-forget — failures
 * log a structured `console.warn` (the only logging primitive allowed; see
 * `eslint.config.mjs` — `console.log` is blocked) and never throw.
 *
 * Conventions:
 * - `distinctId` is the user UUID when known, otherwise the org slug or
 *   `anon:<requestId>` for unauthenticated funnels.
 * - Every event automatically receives `$lib` + `$lib_version` so PostHog
 *   filters can split worker-emitted events from browser-emitted events.
 * - Authentication is enforced by env presence: missing `POSTHOG_API_KEY`
 *   short-circuits silently so local dev does not require analytics secrets.
 *
 * @example
 * ```ts
 * import { captureFunnelEvent } from './services/analytics.js';
 * await captureFunnelEvent(env, userId, 'site_created', orgId, siteId);
 * ```
 *
 * @see {@link https://posthog.com/docs/api/capture PostHog Capture API}
 */
import type { Env } from '../types/env.js';

/** Allowed value types in a PostHog event property bag. */
interface EventProperties {
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Capture an arbitrary PostHog event. Fire-and-forget — never throws.
 *
 * @param env - Worker bindings. `POSTHOG_API_KEY` gates the call entirely.
 * @param event - Event name (snake_case, project-sites-prefixed for custom events).
 * @param distinctId - User/org/anon identifier; see module-level conventions.
 * @param properties - Optional property bag merged with `$lib` metadata.
 *
 * @remarks
 * Side effect: emits one outbound `POST` to the configured PostHog ingest host
 * (`POSTHOG_HOST` or US default). Counts against the Worker subrequest budget
 * (1000/invocation per Cloudflare, 2024b) — caller should batch or defer via
 * `ctx.waitUntil` when on the hot path.
 *
 * @throws Never — failures are logged via structured `console.warn` and swallowed.
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
