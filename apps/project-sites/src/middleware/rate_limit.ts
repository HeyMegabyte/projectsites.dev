/**
 * @module middleware/rate_limit
 * @description KV-based per-IP rate limiting middleware.
 *
 * Uses Cloudflare KV with TTL-based expiry for sliding window counters.
 * Each rate limit rule specifies max requests per window (in seconds).
 *
 * @example
 * ```ts
 * // 5 requests per 60 seconds for auth endpoints
 * app.use('/api/auth/*', rateLimitMiddleware({ maxRequests: 5, windowSeconds: 60, prefix: 'rl:auth' }));
 * ```
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';

interface RateLimitOptions {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Window duration in seconds */
  windowSeconds: number;
  /** KV key prefix for this limiter */
  prefix: string;
}

/**
 * Create a rate limiting middleware using KV counters.
 *
 * @param opts - Rate limit configuration
 * @returns Hono middleware that returns 429 when limit exceeded
 */
export function rateLimitMiddleware(opts: RateLimitOptions): MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> {
  return async (c, next) => {
    // Extract client IP (Cloudflare headers)
    const ip = c.req.header('cf-connecting-ip')
      || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      || 'unknown';

    const key = `${opts.prefix}:${ip}`;

    try {
      const current = await c.env.CACHE_KV.get(key);
      const count = current ? parseInt(current, 10) : 0;

      if (count >= opts.maxRequests) {
        return c.json({
          error: {
            code: 'RATE_LIMITED',
            message: `Too many requests. Please try again in ${opts.windowSeconds} seconds.`,
            retry_after: opts.windowSeconds,
          },
        }, 429, {
          'Retry-After': String(opts.windowSeconds),
          'X-RateLimit-Limit': String(opts.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + opts.windowSeconds),
        });
      }

      // Increment counter with TTL
      await c.env.CACHE_KV.put(key, String(count + 1), { expirationTtl: opts.windowSeconds });

      // Add rate limit headers to response
      await next();

      c.header('X-RateLimit-Limit', String(opts.maxRequests));
      c.header('X-RateLimit-Remaining', String(Math.max(0, opts.maxRequests - count - 1)));
    } catch {
      // If KV fails, allow the request (fail open)
      await next();
    }
  };
}
