import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';

/**
 * Assigns a unique request ID to every request for tracing.
 * Propagates through all downstream services.
 */
export const requestIdMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const requestId =
    c.req.header('x-request-id') ?? crypto.randomUUID();
  c.set('requestId', requestId);
  c.header('x-request-id', requestId);
  await next();
};
