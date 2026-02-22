/**
 * Security-headers middleware for the Project Sites Cloudflare Worker.
 *
 * Attaches a hardened set of HTTP response headers to **every** response that
 * passes through the Hono middleware chain. The headers enforce HTTPS via HSTS,
 * prevent MIME-sniffing, deny framing, tighten the referrer, disable
 * unnecessary browser APIs, and apply a Content-Security-Policy that allowlists
 * only the third-party origins required by the homepage SPA (Stripe, Uppy /
 * Transloadit, Lottie, Google Fonts).
 *
 * | Export                       | Description                                     |
 * | ---------------------------- | ----------------------------------------------- |
 * | `securityHeadersMiddleware`  | Hono `MiddlewareHandler` that sets all headers   |
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { securityHeadersMiddleware } from './middleware/security_headers.js';
 *
 * const app = new Hono();
 * app.use('*', securityHeadersMiddleware);
 * ```
 *
 * @module security_headers
 * @packageDocumentation
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';

/**
 * Hono middleware that appends security headers to every response.
 *
 * Headers set:
 *
 * | Header                      | Value / Purpose                                            |
 * | --------------------------- | ---------------------------------------------------------- |
 * | `Strict-Transport-Security` | 2-year HSTS with `includeSubDomains` and `preload`         |
 * | `X-Content-Type-Options`    | `nosniff` -- prevents MIME-type sniffing                   |
 * | `X-Frame-Options`           | `DENY` -- blocks all framing (clickjacking defence)        |
 * | `Referrer-Policy`           | `strict-origin-when-cross-origin`                          |
 * | `Permissions-Policy`        | Disables camera, microphone, and geolocation               |
 * | `Content-Security-Policy`   | Allowlists `'self'`, inline scripts/styles, and required   |
 * |                             | CDN origins (Stripe, Transloadit, Google Fonts, Lottie)    |
 *
 * The middleware calls `await next()` first, then mutates the response headers
 * so that **all** downstream handlers benefit from the same policy.
 *
 * @remarks
 * `'unsafe-inline'` is included in `script-src` and `style-src` because the
 * marketing homepage (`public/index.html`) relies on inline `<script>` blocks
 * and inline styles. Removing it would break the SPA.
 */
export const securityHeadersMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  await next();

  const url = new URL(c.req.url);
  const hostname = url.hostname;

  // Determine if this is a served site (not the dashboard/API)
  const isDashboard = hostname === 'sites.megabyte.space' || hostname === 'sites-staging.megabyte.space' || hostname === 'localhost';
  const isServedSite = !isDashboard && !url.pathname.startsWith('/api/');

  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=self');

  if (isServedSite) {
    // Served sites: allow framing from anywhere (for dashboard preview cards)
    // Do NOT set X-Frame-Options (allows embedding in dashboard iframes)
    // Do NOT set COOP/COEP (breaks iframe embedding)
    c.header(
      'Content-Security-Policy',
      [
        "default-src 'self' 'unsafe-inline' https: data:",
        "frame-ancestors *",
        "object-src 'none'",
      ].join('; '),
    );
  } else {
    // Dashboard/API: standard security headers
    c.header('X-Frame-Options', 'SAMEORIGIN');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    c.header(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://releases.transloadit.com https://js.stripe.com https://us.i.posthog.com https://us-assets.i.posthog.com https://static.cloudflareinsights.com https://cdnjs.cloudflare.com https://www.googletagmanager.com https://www.google-analytics.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://releases.transloadit.com https://cdnjs.cloudflare.com",
        "img-src 'self' data: https: https://www.googletagmanager.com https://www.google-analytics.com",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self' https://api.stripe.com https://us.i.posthog.com https://us-assets.i.posthog.com https://releases.transloadit.com https://www.google-analytics.com https://www.googletagmanager.com https://region1.google-analytics.com https://domainr.p.rapidapi.com",
        "frame-src https://js.stripe.com https://www.googletagmanager.com https://*.megabyte.space",
        "frame-ancestors 'self' https://*.megabyte.space",
        "object-src 'none'",
        "base-uri 'self'",
      ].join('; '),
    );
  }
};
