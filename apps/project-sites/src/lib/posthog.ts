/**
 * PostHog server-side event capture for Cloudflare Workers.
 *
 * Uses the PostHog HTTP API directly (no SDK needed) to track
 * server-side events like auth flows, site creation, and errors.
 *
 * @module lib/posthog
 */

import type { Env } from '../types/env.js';

interface PostHogEvent {
  event: string;
  distinctId: string;
  properties?: Record<string, unknown>;
}

const POSTHOG_API_URL = 'https://us.i.posthog.com/capture/';

/**
 * Capture a server-side event in PostHog.
 *
 * Fire-and-forget: uses waitUntil to avoid blocking the response.
 * Safe to call even if POSTHOG_API_KEY is not configured.
 */
export function capture(
  env: Env,
  ctx: ExecutionContext,
  event: PostHogEvent,
): void {
  if (!env.POSTHOG_API_KEY) return;

  const host = env.POSTHOG_HOST ?? POSTHOG_API_URL;
  const url = host.endsWith('/capture/') ? host : `${host}/capture/`;

  const body = JSON.stringify({
    api_key: env.POSTHOG_API_KEY,
    event: event.event,
    distinct_id: event.distinctId,
    properties: {
      ...event.properties,
      $lib: 'project-sites-worker',
      environment: env.ENVIRONMENT,
    },
    timestamp: new Date().toISOString(),
  });

  const promise = fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch((err) => {
    console.warn(JSON.stringify({
      level: 'warn',
      service: 'posthog',
      message: 'Failed to capture event',
      error: err instanceof Error ? err.message : String(err),
    }));
  });

  ctx.waitUntil(promise);
}

/**
 * Track an authentication event.
 */
export function trackAuth(
  env: Env,
  ctx: ExecutionContext,
  method: 'magic_link' | 'google_oauth',
  step: 'requested' | 'verified' | 'failed',
  distinctId: string,
  extra?: Record<string, unknown>,
): void {
  capture(env, ctx, {
    event: `auth_${method}_${step}`,
    distinctId,
    properties: {
      auth_method: method,
      auth_step: step,
      ...extra,
    },
  });
}

/**
 * Track a site lifecycle event.
 */
export function trackSite(
  env: Env,
  ctx: ExecutionContext,
  action: string,
  distinctId: string,
  extra?: Record<string, unknown>,
): void {
  capture(env, ctx, {
    event: `site_${action}`,
    distinctId,
    properties: extra,
  });
}

/**
 * Track an error event.
 */
export function trackError(
  env: Env,
  ctx: ExecutionContext,
  errorType: string,
  message: string,
  extra?: Record<string, unknown>,
): void {
  capture(env, ctx, {
    event: 'server_error',
    distinctId: 'system',
    properties: {
      error_type: errorType,
      error_message: message,
      ...extra,
    },
  });
}

/**
 * Track a domain lifecycle event.
 */
export function trackDomain(
  env: Env,
  ctx: ExecutionContext,
  action: string,
  distinctId: string,
  extra?: Record<string, unknown>,
): void {
  capture(env, ctx, {
    event: `domain_${action}`,
    distinctId,
    properties: extra,
  });
}
