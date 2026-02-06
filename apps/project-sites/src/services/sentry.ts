import type { Env } from '../types/env.js';

/**
 * Lightweight Sentry error reporting for Cloudflare Workers.
 * Uses the Sentry HTTP API directly (no SDK needed for Workers).
 */

interface SentryEvent {
  exception?: {
    values: Array<{
      type: string;
      value: string;
      stacktrace?: { frames: Array<{ filename: string; lineno: number; function: string }> };
    }>;
  };
  message?: string;
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  timestamp: number;
  platform: string;
  server_name: string;
}

/**
 * Parse a Sentry DSN into its components.
 */
function parseDsn(dsn: string): { publicKey: string; host: string; projectId: string } | null {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const host = url.host;
    const projectId = url.pathname.replace('/', '');
    return { publicKey, host, projectId };
  } catch {
    return null;
  }
}

/**
 * Report an error to Sentry via HTTP API.
 */
export async function captureException(
  env: Env,
  error: Error,
  context: {
    requestId?: string;
    userId?: string;
    orgId?: string;
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  } = {},
): Promise<void> {
  if (!env.SENTRY_DSN) return;

  const dsn = parseDsn(env.SENTRY_DSN);
  if (!dsn) return;

  const sentryEvent: SentryEvent = {
    exception: {
      values: [
        {
          type: error.name,
          value: error.message,
          stacktrace: error.stack
            ? {
                frames: error.stack
                  .split('\n')
                  .slice(1, 10)
                  .map((line) => {
                    const match = line.match(/at\s+(\S+)\s+\((.+):(\d+):\d+\)/);
                    return {
                      function: match?.[1] ?? '<anonymous>',
                      filename: match?.[2] ?? '<unknown>',
                      lineno: Number(match?.[3] ?? 0),
                    };
                  }),
              }
            : undefined,
        },
      ],
    },
    level: 'error',
    tags: {
      environment: env.ENVIRONMENT ?? 'development',
      service: 'project-sites-worker',
      ...context.tags,
      ...(context.requestId ? { request_id: context.requestId } : {}),
      ...(context.userId ? { user_id: context.userId } : {}),
      ...(context.orgId ? { org_id: context.orgId } : {}),
    },
    extra: context.extra ?? {},
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    server_name: 'cloudflare-worker',
  };

  try {
    await fetch(`https://${dsn.host}/api/${dsn.projectId}/store/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=project-sites/0.1.0, sentry_key=${dsn.publicKey}`,
      },
      body: JSON.stringify(sentryEvent),
    });
  } catch {
    // Sentry reporting should never break the request
  }
}

/**
 * Report a message to Sentry.
 */
export async function captureMessage(
  env: Env,
  message: string,
  level: 'info' | 'warning' | 'error' = 'info',
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (!env.SENTRY_DSN) return;

  const dsn = parseDsn(env.SENTRY_DSN);
  if (!dsn) return;

  const sentryEvent: SentryEvent = {
    message,
    level,
    tags: {
      environment: env.ENVIRONMENT ?? 'development',
      service: 'project-sites-worker',
    },
    extra,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    server_name: 'cloudflare-worker',
  };

  try {
    await fetch(`https://${dsn.host}/api/${dsn.projectId}/store/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=project-sites/0.1.0, sentry_key=${dsn.publicKey}`,
      },
      body: JSON.stringify(sentryEvent),
    });
  } catch {
    // Sentry reporting should never break the request
  }
}
