/**
 * @module services/sentry
 *
 * @description
 * Zero-dependency Sentry client tailored for Cloudflare Workers.
 * Talks directly to the Sentry Store API (`POST /api/{project}/store/`)
 * over `fetch`, bypassing the official SDK whose top-level
 * `process.on('uncaughtException')` listener crashes Workers at
 * isolate boot. The wire format here is the same JSON envelope the
 * SDK would have sent — Sentry's ingest can't tell the difference.
 *
 * ## What ships per request
 *
 * | Surface       | What it captures                                          |
 * |---------------|-----------------------------------------------------------|
 * | Exception     | `error.name`, `error.message`, parsed stack (≤14 frames)  |
 * | Transaction   | trace + spans + breadcrumbs + tags + extra + request      |
 * | Message       | Plain string with `level` + tags + extra                  |
 * | Distributed   | `sentry-trace` header parsed in, emitted on egress        |
 *
 * ## Distributed tracing flow
 *
 * 1. Browser SDK emits `sentry-trace: {traceId}-{spanId}-{sampled}` on
 *    every fetch to the Worker.
 * 2. {@link parseSentryTrace} reads the header.
 * 3. {@link TransactionCollector} adopts that `traceId` + uses the
 *    incoming `spanId` as `parentSpanId`.
 * 4. {@link TransactionCollector.toSentryTraceHeader} emits a fresh
 *    header for any downstream `fetch()` the Worker makes (D1 calls
 *    don't count — only outbound HTTPS).
 * 5. {@link sendTransaction} ships the whole tree to Sentry at request
 *    end so the frontend trace + Worker spans + downstream calls all
 *    render as a single waterfall in the Sentry UI.
 *
 * ## Failure model
 *
 * Sentry is observability infra — its outage MUST NOT take down the
 * request. Every send wraps `fetch` in `try/catch` and swallows
 * errors silently. Missing `SENTRY_DSN` or malformed DSN both result
 * in a silent no-op. `captureException` and `sendTransaction` ALWAYS
 * resolve.
 *
 * @example
 * ```ts
 * const txn = new TransactionCollector({
 *   transaction: 'POST /api/sites',
 *   op: 'http.server',
 *   ...(parseSentryTrace(req.headers.get('sentry-trace')) ?? {}),
 * });
 * const finishDb = txn.startSpan({ op: 'db.query', description: 'INSERT site', startTime: Date.now() });
 * await dbInsert(env.DB, 'sites', row);
 * finishDb();
 * try {
 *   await maybeThrow();
 *   await sendTransaction(env, txn, 'ok', { url, method }, userId);
 * } catch (err) {
 *   await captureException(env, err as Error, { transaction: txn, userId });
 *   await sendTransaction(env, txn, 'internal_error', { url, method }, userId);
 *   throw err;
 * }
 * ```
 *
 * @see {@link https://develop.sentry.dev/sdk/data-model/envelopes/ Sentry Envelope spec}
 * @see {@link module:middleware/error_handler} — calls `captureException` on all unhandled errors
 */

import type { Env } from '../types/env.js';

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
 * Parse an incoming `sentry-trace` header into trace context.
 *
 * @param header - Raw header value (`{traceId}-{spanId}-{sampled}`)
 *   or `null` when not present. Pass `req.headers.get('sentry-trace')`.
 * @returns `{ traceId, parentSpanId, sampled }` for hydrating a
 *   {@link TransactionCollector}, or `null` if the header is missing
 *   / malformed (fewer than two `-`-separated segments).
 *
 * @remarks
 * Format per Sentry spec: `<32-hex-trace-id>-<16-hex-span-id>-<1|0>`.
 * The third segment is optional in the spec; this parser treats any
 * value other than literal `'0'` as sampled. Caller decides what to
 * do when `null` is returned — typically: mint a fresh `traceId` so
 * Worker-only requests still record a transaction.
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

/**
 * Accumulator for a single Sentry performance transaction.
 *
 * @remarks
 * Construct once at the entry of a request handler, attach spans
 * with {@link startSpan} as work happens, drop breadcrumbs at
 * decision points with {@link addBreadcrumb}, then ship with
 * {@link sendTransaction} at the end of the request. The class is
 * a pure in-memory accumulator — nothing hits the network until
 * `sendTransaction` is called, so wrapping random code in spans is
 * free even when `SENTRY_DSN` is unset.
 *
 * @example
 * ```ts
 * const incoming = parseSentryTrace(req.headers.get('sentry-trace'));
 * const txn = new TransactionCollector({
 *   transaction: 'POST /api/sites',
 *   op: 'http.server',
 *   traceId: incoming?.traceId,
 *   parentSpanId: incoming?.parentSpanId,
 * });
 * ```
 */
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

  /**
   * Open a child span. Returns a `finish()` thunk.
   *
   * @param ctx - Span metadata:
   *   - `op`: operation type (`db.query` / `http.client` / `cache.get`)
   *   - `description`: short human-readable label
   *   - `startTime`: caller-provided `Date.now()` (ms since epoch) at
   *     span open — converted to seconds internally
   *   - `data`: arbitrary structured payload (request shape, params)
   * @returns Closure that, when called, stamps `timestamp = now` on
   *   the span and pushes it onto `this.spans`. Idempotency NOT
   *   guaranteed — calling twice records a duplicate span.
   */
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

  /**
   * Append a breadcrumb to the transaction's audit trail.
   *
   * @param category - Coarse grouping (`auth` / `db` / `cache` / `http`).
   *   Sentry UI uses this for icon + color.
   * @param message - One-line human description ("session lookup hit",
   *   "checkout webhook fired").
   * @param level - Severity (`info` default). Use `warning` for
   *   recoverable hiccups, `error` for "we'll capture an exception
   *   right after this".
   * @param data - Optional structured payload (IDs, latency, key names).
   *   Avoid raw secrets — breadcrumbs ship verbatim to Sentry.
   */
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

  /**
   * Render this transaction as a `sentry-trace` header value.
   *
   * @returns String formatted `{traceId}-{spanId}-1` ready to set on
   *   any outbound `fetch()` so downstream services join this trace.
   *
   * @remarks
   * Always emits `sampled=1` — downstream services decide independently
   * whether to record. If the upstream caller emitted `sampled=0` you
   * are propagating that, but at the moment this Worker never honors
   * upstream sampling decisions (we always ship to Sentry when DSN is
   * set). Adjust here if cost becomes a concern.
   */
  toSentryTraceHeader(): string {
    return `${this.traceId}-${this.spanId}-1`;
  }
}

// ── Core API ─────────────────────────────────────────────────

/**
 * POST a fully-formed event envelope to Sentry's Store API.
 *
 * @param env - Worker bindings; reads `SENTRY_DSN`.
 * @param sentryEvent - Envelope conforming to the Sentry data model
 *   (`event` for errors, `transaction` for performance).
 * @returns Resolves regardless of network outcome. Errors are
 *   swallowed by design — observability MUST NOT break user requests.
 *
 * @remarks
 * No-ops silently when `SENTRY_DSN` is unset or unparseable. Uses the
 * `Sentry sentry_version=7` auth header format (still the only
 * supported version on store.sentry.io). `sentry_client` is set to
 * `project-sites/0.2.0` so we can grep Sentry ingest logs for our
 * traffic separately from any official SDK shipping events.
 */
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
 * Capture a thrown `Error` to Sentry.
 *
 * @param env - Worker bindings; reads `SENTRY_DSN` + `ENVIRONMENT`.
 * @param error - The thrown error. `name` / `message` / `stack` are
 *   extracted; missing `stack` becomes `undefined` (Sentry handles
 *   gracefully).
 * @param context - Optional enrichment:
 *   - `requestId`: from `X-Request-ID` middleware (used as both tag
 *     and `extra` for grepability)
 *   - `userId` / `orgId`: tenant attribution (also written to
 *     `user.id` when `userId` set)
 *   - `tags`: arbitrary low-cardinality string→string pairs
 *   - `extra`: arbitrary high-cardinality structured payload
 *   - `transaction`: a {@link TransactionCollector} — copies its
 *     `traceId`/`spanId`/`parentSpanId` into the event's `trace`
 *     context AND attaches its breadcrumbs
 *   - `request`: URL/method/headers for the inbound request panel
 * @returns Resolves regardless of network outcome — see
 *   {@link sendToSentry}.
 *
 * @remarks
 * Stack-frame parser handles V8-formatted `at name (file:line:col)`
 * lines; lines that don't match fall back to `<anonymous>` /
 * `<unknown>` / `0`. Limited to the first 14 frames (after slicing
 * off the `Error:` header line) to keep the payload small.
 *
 * `event_id` is concatenated from two 16-char span IDs to produce
 * the 32-char hex Sentry expects — the `crypto.randomUUID()` call
 * inside is collision-safe at our volume.
 *
 * @throws Never — observability surface, all failures swallowed.
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
 * Capture a non-error message to Sentry.
 *
 * @param env - Worker bindings; reads `SENTRY_DSN` + `ENVIRONMENT`.
 * @param message - Free-form string. Keep it short — Sentry indexes
 *   the first ~1000 chars; longer payloads go in `extra`.
 * @param level - Severity (`info` default). Choose `warning` for
 *   recoverable hiccups worth alerting on, `error` only for genuine
 *   failures that don't have an `Error` to throw.
 * @param extra - Structured payload for context. Unlike
 *   `captureException`, there is no auto-attached trace/breadcrumb
 *   context here — use `captureException` when you need a transaction
 *   link.
 * @returns Resolves regardless of network outcome.
 *
 * @throws Never.
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
 * Ship a {@link TransactionCollector} as a Sentry transaction event.
 *
 * @param env - Worker bindings; reads `SENTRY_DSN` + `ENVIRONMENT`.
 * @param txn - Fully populated transaction collector (all spans
 *   finished, all breadcrumbs added).
 * @param status - Final outcome (`ok` / `internal_error` / `not_found`
 *   / `cancelled`). Sentry renders this as the transaction-level
 *   status badge.
 * @param request - Optional inbound request descriptor for the
 *   request panel in the Sentry UI.
 * @param userId - Optional tenant attribution (mirrored to `user.id`).
 * @returns Resolves regardless of network outcome.
 *
 * @remarks
 * Call EXACTLY once per transaction, at request end. Calling twice
 * creates two duplicate transactions in Sentry (no dedup on
 * `event_id` for `type=transaction`). Spans whose `finish()` was
 * never called won't appear (they stay with `timestamp=0` and Sentry
 * rejects them at validation).
 *
 * @throws Never.
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
