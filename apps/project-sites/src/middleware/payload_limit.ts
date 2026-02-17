import type { MiddlewareHandler } from 'hono';
import { DEFAULT_CAPS, payloadTooLarge } from '@project-sites/shared';
import type { Env, Variables } from '../types/env.js';

/** 100 MB limit for upload endpoints (ZIP deploys, bolt publish). */
const UPLOAD_MAX_BYTES = 100 * 1024 * 1024;

/** Paths that allow the larger upload limit. */
const UPLOAD_PATHS = ['/api/publish/bolt', '/api/sites/'];

/**
 * Enforce max request payload size.
 * Upload endpoints (`/api/publish/bolt`, `/api/sites/:id/deploy`) get a
 * larger limit (100 MB) to support ZIP file uploads. All other endpoints
 * use the default cap.
 */
export const payloadLimitMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  const contentLength = c.req.header('content-length');

  if (contentLength) {
    const size = Number(contentLength);
    const url = new URL(c.req.url);
    const isUpload = UPLOAD_PATHS.some((p) => url.pathname.startsWith(p)) &&
      (url.pathname.endsWith('/deploy') || url.pathname === '/api/publish/bolt');
    const maxBytes = isUpload
      ? UPLOAD_MAX_BYTES
      : DEFAULT_CAPS.MAX_REQUEST_BODY_BYTES;

    if (!Number.isNaN(size) && size > maxBytes) {
      throw payloadTooLarge(
        `Request body exceeds maximum size of ${maxBytes} bytes`,
      );
    }
  }

  await next();
};
