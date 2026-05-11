/**
 * @module routes/live_stream
 * @description Live SSE build stream for `/build/:slug/live` (1337 LAYER #2).
 *
 * Polls D1 `build_stream_state` + recent `audit_logs` every 750ms inside a
 * ReadableStream, emitting `event: build_progress\ndata: {...}\n\n` frames.
 * Connection auto-closes on terminal status (`published|error|archived`) or
 * after a 10-minute hard cap. Designed to feel like an Apple-keynote build
 * console — every skill firing in real-time.
 *
 * Contract (skill 15 build-breaking-rules.md, 1337 LAYER #2):
 * - Public read endpoint, no auth required.
 * - Polls D1 every 750ms.
 * - Emits one `event: build_progress` frame per poll when state changes.
 * - Emits keep-alive comment (`: ping`) every 15s to prevent proxies dropping.
 * - Closes on terminal status OR 10-minute hard cap.
 * - Heartbeat `Cache-Control: no-store, X-Accel-Buffering: no`.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { dbQueryOne, dbQuery } from '../services/db.js';

const liveStream = new Hono<{ Bindings: Env; Variables: Variables }>();

interface BuildStreamRow {
  site_id: string;
  build_id: string;
  phase: string;
  step: string | null;
  percent: number;
  current_subagent: string | null;
  current_skill_id: string | null;
  log_tail: string | null;
  delight_count: number;
  started_at: string;
  updated_at: string;
  terminal_at: string | null;
  terminal_status: string | null;
}

interface SiteRow {
  id: string;
  slug: string;
  status: string;
  business_name: string;
}

interface AuditRow {
  id: string;
  action: string;
  metadata: string | null;
  created_at: string;
}

const TERMINAL_SITE_STATUSES = new Set(['published', 'error', 'archived']);
const POLL_INTERVAL_MS = 750;
const KEEPALIVE_INTERVAL_MS = 15000;
const HARD_CAP_MS = 10 * 60 * 1000;

function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

liveStream.get('/build/:slug/live', async (c) => {
  const slug = c.req.param('slug');
  if (!slug) return c.json({ error: 'missing slug' }, 400);

  const site = await dbQueryOne<SiteRow>(
    c.env.DB,
    'SELECT id, slug, status, business_name FROM sites WHERE slug = ? AND deleted_at IS NULL',
    [slug],
  );
  if (!site) return c.json({ error: 'site not found' }, 404);

  const encoder = new TextEncoder();
  const startedAt = Date.now();
  let lastSerialized = '';
  let lastAuditId: string | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      // Initial frame — flush immediately so the client renders "connected"
      controller.enqueue(
        encoder.encode(
          sseFrame('connected', {
            site_id: site.id,
            slug: site.slug,
            status: site.status,
            ts: new Date().toISOString(),
          }),
        ),
      );

      let lastKeepalive = Date.now();
      let closed = false;

      const close = (reason: string) => {
        if (closed) return;
        closed = true;
        try {
          controller.enqueue(encoder.encode(sseFrame('done', { reason, ts: new Date().toISOString() })));
          controller.close();
        } catch {
          // already closed
        }
      };

      const tick = async () => {
        if (closed) return;
        if (Date.now() - startedAt > HARD_CAP_MS) {
          close('hard_cap_10min');
          return;
        }

        try {
          const state = await dbQueryOne<BuildStreamRow>(
            c.env.DB,
            'SELECT * FROM build_stream_state WHERE site_id = ?',
            [site.id],
          );

          const currentSite = await dbQueryOne<{ status: string }>(
            c.env.DB,
            'SELECT status FROM sites WHERE id = ?',
            [site.id],
          );

          const auditTail = await dbQuery<AuditRow>(
            c.env.DB,
            `SELECT id, action, metadata, created_at FROM audit_logs
             WHERE site_id = ? ${lastAuditId ? 'AND id > ?' : ''}
             ORDER BY created_at ASC LIMIT 5`,
            lastAuditId ? [site.id, lastAuditId] : [site.id],
          );

          const payload = {
            site_id: site.id,
            slug: site.slug,
            site_status: currentSite?.status ?? site.status,
            phase: state?.phase ?? null,
            step: state?.step ?? null,
            percent: state?.percent ?? 0,
            subagent: state?.current_subagent ?? null,
            skill_id: state?.current_skill_id ?? null,
            log_tail: state?.log_tail ?? null,
            delight_count: state?.delight_count ?? 0,
            audit: auditTail.data.map((a) => ({
              action: a.action,
              created_at: a.created_at,
              metadata: a.metadata ? safeParse(a.metadata) : null,
            })),
            ts: new Date().toISOString(),
          };

          if (auditTail.data.length > 0) {
            lastAuditId = auditTail.data[auditTail.data.length - 1].id;
          }

          const serialized = JSON.stringify(payload);
          if (serialized !== lastSerialized) {
            controller.enqueue(encoder.encode(sseFrame('build_progress', payload)));
            lastSerialized = serialized;
          } else if (Date.now() - lastKeepalive > KEEPALIVE_INTERVAL_MS) {
            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
            lastKeepalive = Date.now();
          }

          const siteStatus = currentSite?.status ?? site.status;
          if (TERMINAL_SITE_STATUSES.has(siteStatus) || state?.terminal_status) {
            controller.enqueue(
              encoder.encode(
                sseFrame('terminal', {
                  site_status: siteStatus,
                  terminal_status: state?.terminal_status ?? siteStatus,
                  ts: new Date().toISOString(),
                }),
              ),
            );
            close('terminal_status');
            return;
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(
              sseFrame('error', { message: err instanceof Error ? err.message : 'poll_failed' }),
            ),
          );
        }

        setTimeout(tick, POLL_INTERVAL_MS);
      };

      setTimeout(tick, POLL_INTERVAL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
});

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export { liveStream };
