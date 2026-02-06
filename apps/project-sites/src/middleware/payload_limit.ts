import type { MiddlewareHandler } from 'hono';
import { DEFAULT_CAPS, payloadTooLarge } from '@project-sites/shared';
import type { Env, Variables } from '../types/env.js';

/**
 * Enforce max request payload size.
 */
export const payloadLimitMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const contentLength = c.req.header('content-length');

  if (contentLength) {
    const size = Number(contentLength);
    if (!Number.isNaN(size) && size > DEFAULT_CAPS.MAX_REQUEST_BODY_BYTES) {
      throw payloadTooLarge(
        `Request body exceeds maximum size of ${DEFAULT_CAPS.MAX_REQUEST_BODY_BYTES} bytes`,
      );
    }
  }

  await next();
};
