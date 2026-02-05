/**
 * Request ID middleware
 * Generates unique request IDs for tracing and logging
 */
import type { MiddlewareHandler } from 'hono';
import { generateRequestId, generateTraceId, nowISO } from '@project-sites/shared';
import type { AppContext } from '../types.js';

export const requestIdMiddleware: MiddlewareHandler<AppContext> = async (c, next) => {
  // Check for existing request ID from upstream (e.g., load balancer)
  const existingRequestId = c.req.header('X-Request-ID');
  const existingTraceId = c.req.header('X-Trace-ID');

  // Generate or use existing IDs
  const requestId = existingRequestId ?? generateRequestId();
  const traceId = existingTraceId ?? generateTraceId();

  // Get client info
  const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? undefined;
  const userAgent = c.req.header('User-Agent') ?? undefined;
  const country = c.req.header('CF-IPCountry') ?? undefined;

  // Set request context
  c.set('requestContext', {
    request_id: requestId,
    trace_id: traceId,
    timestamp: nowISO(),
    ip,
    user_agent: userAgent,
    country,
  });

  // Set start time for timing
  c.set('startTime', Date.now());

  // Add headers to response
  c.header('X-Request-ID', requestId);
  c.header('X-Trace-ID', traceId);

  await next();
};
