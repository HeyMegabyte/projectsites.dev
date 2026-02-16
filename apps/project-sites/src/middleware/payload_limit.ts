import type { MiddlewareHandler } from 'hono';
import { DEFAULT_CAPS, payloadTooLarge } from '@project-sites/shared';
import type { Env, Variables } from '../types/env.js';

/** 25 MB limit for the bolt publish endpoint (dist/ uploads). */
const PUBLISH_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Enforce max request payload size.
 * The `/api/publish/bolt` endpoint gets a larger limit (25 MB)
 * since it uploads entire site bundles.
 */
export const payloadLimitMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const contentLength = c.req.header('content-length');

  if (contentLength) {
    const size = Number(contentLength);
    const url = new URL(c.req.url);
    const maxBytes = url.pathname === '/api/publish/bolt'
      ? PUBLISH_MAX_BYTES
      : DEFAULT_CAPS.MAX_REQUEST_BODY_BYTES;

    if (!Number.isNaN(size) && size > maxBytes) {
      throw payloadTooLarge(
        `Request body exceeds maximum size of ${maxBytes} bytes`,
      );
    }
  }

  await next();
};
