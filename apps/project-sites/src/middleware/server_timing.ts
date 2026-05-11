/**
 * @module middleware/server_timing
 * @description Emits a per-skill `Server-Timing` response header (1337 LAYER #7).
 *
 * Exposes a `timings` Map on the Hono context so any route/skill can record a
 * named duration. After the handler returns, the middleware flushes the
 * accumulated entries into a standards-compliant `Server-Timing` header so
 * Chrome DevTools → Network → Timing renders each phase visually.
 *
 * Per the 1337 LAYER #7 contract: emits one entry per skill phase
 * (research, brand, asset, generation, validation, deploy, total) plus
 * arbitrary `c.set('timings', ...)` entries added by inner handlers.
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';

type TimingEntry = { dur: number; desc?: string };

/**
 * Sanitizes a token for safe inclusion in a Server-Timing header value.
 * Per RFC 7230 token rule — strip CR/LF/double-quote/comma/semicolon.
 */
function sanitizeToken(value: string): string {
  return value.replace(/[\r\n",;]/g, '').slice(0, 64);
}

/**
 * Hono middleware factory: provisions `c.get('timings')` as a Map and
 * flushes it to the `Server-Timing` response header after the handler runs.
 *
 * Use inside any handler:
 * ```ts
 * const t = c.get('timings');
 * const start = performance.now();
 * await runSkill();
 * t.set('skill.brand', { dur: performance.now() - start, desc: 'brand research' });
 * ```
 */
export function serverTimingMiddleware(): MiddlewareHandler<{ Bindings: Env; Variables: Variables }> {
  return async (c, next) => {
    const timings = new Map<string, TimingEntry>();
    const start = performance.now();
    c.set('timings', timings);

    await next();

    timings.set('total', { dur: performance.now() - start, desc: 'request total' });

    const parts: string[] = [];
    for (const [name, entry] of timings.entries()) {
      const token = sanitizeToken(name);
      if (!token) continue;
      const dur = Number.isFinite(entry.dur) ? Math.max(0, entry.dur).toFixed(2) : '0';
      let part = `${token};dur=${dur}`;
      if (entry.desc) part += `;desc="${sanitizeToken(entry.desc)}"`;
      parts.push(part);
    }

    if (parts.length > 0) {
      c.res.headers.set('Server-Timing', parts.join(', '));
    }
  };
}
