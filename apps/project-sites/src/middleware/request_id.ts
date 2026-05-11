/**
 * @module middleware/request_id
 *
 * @description
 * Assigns a stable correlation ID to every incoming request and propagates
 * it through context + response headers. This ID is the primary join key
 * between logs (Sentry breadcrumbs, PostHog events, D1 `audit_logs`) and
 * client-side error reports surfaced via the Problem Details envelope
 * (see {@link module:middleware/error_handler}).
 *
 * Behavior:
 * - If the caller already supplied `X-Request-ID` (e.g., an upstream gateway
 *   or a retry from the SPA), that value is reused so traces survive client
 *   retries.
 * - Otherwise, a fresh RFC 4122 UUIDv4 is minted via the platform `crypto`
 *   global available in Workers and modern Node.
 * - The ID is stored on the Hono context under `requestId` and echoed back
 *   to the client in the `X-Request-ID` response header.
 *
 * @example
 * ```ts
 * import { requestIdMiddleware } from './middleware/request_id.js';
 * app.use('*', requestIdMiddleware);
 * // downstream handler
 * app.get('/api/example', (c) => c.json({ requestId: c.get('requestId') }));
 * ```
 *
 * @see {@link https://www.rfc-editor.org/rfc/rfc4122 RFC 4122 — UUID}
 * @see module:middleware/error_handler
 */
import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';

/**
 * Hono middleware that ensures every request carries an `X-Request-ID`.
 *
 * @remarks
 * Must be registered **first** in the middleware chain so all downstream
 * middleware (auth, error_handler, audit) can correlate against the same ID.
 *
 * @throws Never — this middleware is non-failing by design. If `crypto.randomUUID`
 *   ever throws (it does not in supported runtimes), the request will surface
 *   the error through the centralized `errorHandler` further down the chain.
 */
export const requestIdMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const requestId = c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);
  await next();
};
