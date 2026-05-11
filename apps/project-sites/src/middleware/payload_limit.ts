/**
 * @module middleware/payload_limit
 *
 * @description
 * Defense-in-depth gate that rejects oversized request bodies before they
 * reach route handlers, parsers, or downstream services. Pairs with
 * Cloudflare's edge limits — this middleware enforces our application-level
 * policy (per-endpoint) on top of the platform's hard limit.
 *
 * Two tiers:
 * - **Default:** `DEFAULT_CAPS.MAX_REQUEST_BODY_BYTES` (256 KB at time of
 *   writing) — covers JSON APIs, form posts, magic-link verifies, etc.
 * - **Upload tier:** 100 MB — applied only to known asset/deploy paths
 *   (`/api/publish/bolt`, `/api/sites/:id/deploy`, `/api/sites/:slug/publish-bolt`,
 *   `/api/assets/upload`). These accept ZIP/binary payloads from the editor
 *   and snapshot pipeline.
 *
 * @remarks
 * The bolt editor host (`editor.projectsites.dev`) is bypassed entirely —
 * its requests are proxied to Cloudflare Pages, which owns its own limits
 * and would otherwise double-reject large editor saves at this layer.
 *
 * @throws {@link AppError} `PAYLOAD_TOO_LARGE` (HTTP 413) when
 *   `Content-Length` exceeds the resolved tier for the path. Requests
 *   without a `Content-Length` header pass through; the downstream parser
 *   is the final size guard.
 *
 * @example
 * ```ts
 * import { payloadLimitMiddleware } from './middleware/payload_limit.js';
 * app.use('*', payloadLimitMiddleware);
 * ```
 */
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
    const hostname = url.hostname;

    // Skip payload limit for bolt editor (editor.projectsites.dev) — proxied to Pages
    if (hostname === 'editor.projectsites.dev' || hostname.endsWith('.bolt-diy-8jf.pages.dev')) {
      await next();
      return;
    }

    const isUpload = (UPLOAD_PATHS.some((p) => url.pathname.startsWith(p)) &&
      (url.pathname.endsWith('/deploy') || url.pathname === '/api/publish/bolt')) ||
      url.pathname === '/api/assets/upload' ||
      url.pathname.endsWith('/publish-bolt');
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
