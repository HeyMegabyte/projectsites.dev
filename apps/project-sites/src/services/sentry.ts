import type { Env } from '../types/env.js';

/**
 * Full-stack Sentry error reporting and performance tracing for Cloudflare Workers.
 * Uses the Sentry HTTP API directly (no SDK needed for Workers).
 *
 * Features:
 * - Exception capture with stack traces
 * - Distributed tracing via sentry-trace header (connects frontend to backend)
 * - Performance transactions with nested spans
 * - Breadcrumbs for request lifecycle tracking
 * - Rich context: request, user, org, tags
 */

// ── Types ────────────────────────────────────────────────────

interface SentryBreadcrumb {
  type: string;
  category: string;
  message: string;
  level: 'fatal' | 'error' | 'warning' | 'info' | 'debug';
  timestamp: number;
  data?: Record<string, unknown>;
}

interface SentrySpan {
  op: string;
  description: string;
  start_timestamp: number;
  timestamp: number;
  status: string;
  span_id: string;
  parent_span_id?: string;
  trace_id: string;
  tags?: Record<string, string>;
  data?: Record<string, unknown>;
}

interface SentryEvent {
  event_id?: string;
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
  contexts?: {
    trace?: { trace_id: string; span_id: string; parent_span_id?: string; op: string; status: string };
    request?: { url: string; method: string; headers: Record<string, string> };
    runtime?: { name: string; version: string };
  };
  breadcrumbs?: { values: SentryBreadcrumb[] };
  spans?: SentrySpan[];
  request?: { url: string; method: string; headers: Record<string, string>; query_string?: string };
  user?: { id: string; email?: string };
  transaction?: string;
  type?: 'transaction' | 'event';
}

// ── DSN Parser ───────────────────────────────────────────────

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

// ── Trace ID Utilities ───────────────────────────────────────

/** Generate a 32-char hex trace ID */
function generateTraceId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Generate a 16-char hex span ID */
function generateSpanId(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 16);
}

/**
 * Parse the sentry-trace header from an incoming request.
 * Format: {trace_id}-{span_id}-{sampled}
 * This enables distributed tracing between frontend and backend.
 */
export function parseSentryTrace(header: string | null): {
  traceId: string;
  parentSpanId: string;
  sampled: boolean;
} | null {
  if (!header) return null;
  const parts = header.split('-');
  if (parts.length < 2) return null;
  return {
    traceId: parts[0],
    parentSpanId: parts[1],
    sampled: parts[2] !== '0',
  };
}

// ── Transaction / Span Builder ───────────────────────────────

export interface SpanContext {
  op: string;
  description: string;
  startTime: number;
  data?: Record<string, unknown>;
}

export class TransactionCollector {
  public traceId: string;
  public spanId: string;
  public parentSpanId?: string;
  public transaction: string;
  public op: string;
  public startTimestamp: number;
  public breadcrumbs: SentryBreadcrumb[] = [];
  public spans: SentrySpan[] = [];
  public tags: Record<string, string> = {};
  public extra: Record<string, unknown> = {};

  constructor(opts: {
    transaction: string;
    op: string;
    traceId?: string;
    parentSpanId?: string;
  }) {
    this.transaction = opts.transaction;
    this.op = opts.op;
    this.traceId = opts.traceId ?? generateTraceId();
    this.spanId = generateSpanId();
    this.parentSpanId = opts.parentSpanId;
    this.startTimestamp = Date.now() / 1000;
  }

  /** Start a child span. Returns a function to finish the span. */
  startSpan(ctx: SpanContext): () => void {
    const spanId = generateSpanId();
    const span: SentrySpan = {
      op: ctx.op,
      description: ctx.description,
      start_timestamp: ctx.startTime / 1000,
      timestamp: 0,
      status: 'ok',
      span_id: spanId,
      parent_span_id: this.spanId,
      trace_id: this.traceId,
      data: ctx.data,
    };
    return () => {
      span.timestamp = Date.now() / 1000;
      this.spans.push(span);
    };
  }

  /** Add a breadcrumb to the transaction */
  addBreadcrumb(category: string, message: string, level: SentryBreadcrumb['level'] = 'info', data?: Record<string, unknown>): void {
    this.breadcrumbs.push({
      type: 'default',
      category,
      message,
      level,
      timestamp: Date.now() / 1000,
      data,
    });
  }

  /** Get the sentry-trace header value for propagating to downstream services */
  toSentryTraceHeader(): string {
    return `${this.traceId}-${this.spanId}-1`;
  }
}

// ── Core API ─────────────────────────────────────────────────

async function sendToSentry(env: Env, sentryEvent: SentryEvent): Promise<void> {
  if (!env.SENTRY_DSN) return;
  const dsn = parseDsn(env.SENTRY_DSN);
  if (!dsn) return;

  try {
    await fetch(`https://${dsn.host}/api/${dsn.projectId}/store/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=project-sites/0.2.0, sentry_key=${dsn.publicKey}`,
      },
      body: JSON.stringify(sentryEvent),
    });
  } catch {
    // Sentry reporting should never break the request
  }
}

/**
 * Report an error to Sentry via HTTP API.
 * Includes distributed trace context and breadcrumbs if a transaction is active.
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
    transaction?: TransactionCollector;
    request?: { url: string; method: string; headers?: Record<string, string> };
  } = {},
): Promise<void> {
  const txn = context.transaction;

  const sentryEvent: SentryEvent = {
    event_id: generateSpanId() + generateSpanId(),
    exception: {
      values: [
        {
          type: error.name,
          value: error.message,
          stacktrace: error.stack
            ? {
                frames: error.stack
                  .split('\n')
                  .slice(1, 15)
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
      runtime: 'cloudflare-workers',
      ...context.tags,
      ...(context.requestId ? { request_id: context.requestId } : {}),
      ...(context.userId ? { user_id: context.userId } : {}),
      ...(context.orgId ? { org_id: context.orgId } : {}),
    },
    extra: {
      ...context.extra,
      ...(context.requestId ? { request_id: context.requestId } : {}),
    },
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    server_name: 'cloudflare-worker',
    // Distributed tracing context — connects frontend errors to backend
    contexts: {
      trace: txn ? {
        trace_id: txn.traceId,
        span_id: txn.spanId,
        parent_span_id: txn.parentSpanId,
        op: txn.op,
        status: 'internal_error',
      } : undefined,
      runtime: { name: 'cloudflare-workers', version: '0.0.0' },
      ...(context.request ? {
        request: {
          url: context.request.url,
          method: context.request.method,
          headers: context.request.headers ?? {},
        },
      } : {}),
    },
    breadcrumbs: txn ? { values: txn.breadcrumbs } : undefined,
    ...(context.userId ? { user: { id: context.userId } } : {}),
    ...(context.request ? {
      request: {
        url: context.request.url,
        method: context.request.method,
        headers: context.request.headers ?? {},
      },
    } : {}),
  };

  await sendToSentry(env, sentryEvent);
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

  await sendToSentry(env, sentryEvent);
}

/**
 * Send a performance transaction to Sentry with all spans and breadcrumbs.
 * Call this at the end of a request to report the full request trace.
 */
export async function sendTransaction(
  env: Env,
  txn: TransactionCollector,
  status: 'ok' | 'internal_error' | 'not_found' | 'cancelled' = 'ok',
  request?: { url: string; method: string; headers?: Record<string, string> },
  userId?: string,
): Promise<void> {
  const sentryEvent: SentryEvent = {
    event_id: generateSpanId() + generateSpanId(),
    type: 'transaction',
    transaction: txn.transaction,
    level: 'info',
    tags: {
      environment: env.ENVIRONMENT ?? 'development',
      service: 'project-sites-worker',
      ...txn.tags,
    },
    extra: txn.extra,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    server_name: 'cloudflare-worker',
    contexts: {
      trace: {
        trace_id: txn.traceId,
        span_id: txn.spanId,
        parent_span_id: txn.parentSpanId,
        op: txn.op,
        status,
      },
      runtime: { name: 'cloudflare-workers', version: '0.0.0' },
    },
    breadcrumbs: { values: txn.breadcrumbs },
    spans: txn.spans,
    ...(request ? {
      request: {
        url: request.url,
        method: request.method,
        headers: request.headers ?? {},
      },
    } : {}),
    ...(userId ? { user: { id: userId } } : {}),
  };

  await sendToSentry(env, sentryEvent);
}
