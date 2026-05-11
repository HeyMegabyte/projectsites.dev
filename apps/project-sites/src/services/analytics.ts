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
 *
 * @param env        - Worker bindings; missing `POSTHOG_API_KEY` short-circuits.
 * @param distinctId - User/org/anon identifier (see module conventions).
 * @param url        - Fully-qualified URL of the page being viewed. Stored
 *   as `$current_url` so PostHog's path-based funnels and trends Just Work.
 * @param properties - Optional supplementary properties; merged AFTER
 *   `$current_url` so callers cannot accidentally clobber the canonical key.
 *
 * @remarks
 * Emits the reserved PostHog event `$pageview` — PostHog treats this as
 * an autocapture event for retention/funnel calculations. Use this rather
 * than a custom `page_view` event so funnels match the JS SDK convention.
 *
 * @throws Never — delegates to `captureEvent`, which swallows.
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
 * Identify a user — bind a `distinctId` to a property bag PostHog stores
 * on the person profile (not the event).
 *
 * @param env        - Worker bindings; missing `POSTHOG_API_KEY` short-circuits.
 * @param distinctId - Stable user identifier (UUID preferred). Subsequent
 *   events emitted with the same `distinctId` inherit these person
 *   properties for cohort/funnel filtering.
 * @param properties - Property bag wrapped in `$set` server-side. PostHog
 *   treats `$set` as "overwrite on every identify"; use `$set_once` semantics
 *   only by sending the raw event (not supported here — keep this helper
 *   for the common path).
 *
 * @remarks
 * Why this is NOT routed through `captureEvent`: the `$identify` event has
 * a non-standard payload shape (`properties.$set` wrapper) that PostHog's
 * ingest pipeline treats specially — collapsing it into the generic helper
 * would force every caller to know the `$set` convention. Keep the special
 * case isolated.
 *
 * Side effect: 1 outbound `POST` to PostHog ingest. Counts against the
 * Worker subrequest budget (1000/invocation). Best invoked once per
 * session at auth time, NOT on every request.
 *
 * @throws Never — failures are logged via structured `console.warn`/`error`
 *   and swallowed. Identity drift is preferable to user-facing errors.
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
 * Capture a funnel step event for conversion tracking.
 *
 * @param env        - Worker bindings; missing `POSTHOG_API_KEY` short-circuits.
 * @param distinctId - User/org/anon identifier (see module conventions).
 *   Anonymous funnels SHOULD use `anon:<requestId>` so that the
 *   later `$identify` call merges the anon timeline into the
 *   authenticated user — PostHog's `alias` mechanic handles this
 *   automatically when distinctId is consistent.
 * @param funnelStep - Step name in snake_case (e.g. `site_created`,
 *   `checkout_started`, `published`). Becomes the event name prefixed
 *   with `funnel_` and is ALSO stored in `properties.funnel_step` so
 *   the same value can be filtered both by event name and property.
 * @param orgId      - Optional tenant org id; null when pre-auth.
 *   Stored as `properties.org_id` for cohort breakdowns.
 * @param siteId     - Optional site id (when the step is site-scoped).
 *   Stored as `properties.site_id` for per-site funnel analysis.
 *
 * @remarks
 * Naming convention: `funnel_${funnelStep}` is the PostHog event name —
 * keeps every conversion event under one filter prefix (`funnel_*`) so
 * the Insights UI can build a single multi-step funnel without
 * naming-collision hazards from random custom events.
 *
 * Nullable correlation: `org_id` and `site_id` default to `null` rather
 * than being omitted so PostHog's "has any value" filter behaves
 * predictably across anon→authed transitions.
 *
 * @throws Never — delegates to `captureEvent`, which swallows.
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
