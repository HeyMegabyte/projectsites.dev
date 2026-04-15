/**
 * Security-headers middleware for the Project Sites Cloudflare Worker.
 *
 * Sets standard security headers (HSTS, nosniff, referrer policy) on all
 * responses. CSP is intentionally permissive — this is a SaaS platform that
 * embeds iframes, loads user-uploaded images, generates blob URLs for
 * previews, and integrates many third-party services.
 *
 * @module security_headers
 */

import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';
import { DOMAINS } from '@project-sites/shared';

export const securityHeadersMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  await next();

  const url = new URL(c.req.url);
  const hostname = url.hostname;

  const isDashboard = hostname === DOMAINS.SITES_BASE || hostname === 'localhost';
  const isBoltEditor = hostname === DOMAINS.BOLT_BASE;
  const isServedSite = !isDashboard && !isBoltEditor && !url.pathname.startsWith('/api/');

  // ── Universal headers ──────────────────────────────────────
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');

  // ── bolt.diy editor ────────────────────────────────────────
  if (isBoltEditor) {
    const isBoltEmbedded = url.searchParams.has('embedded');

    if (isBoltEmbedded) {
      // Embedded: allow framing from projectsites.dev, no COOP (breaks postMessage)
      c.header(
        'Content-Security-Policy',
        `frame-ancestors 'self' https://${DOMAINS.SITES_BASE} https://*.${DOMAINS.SITES_BASE}`,
      );
    } else {
      // Standalone: cross-origin isolation for WebContainers
      c.header('Cross-Origin-Opener-Policy', 'same-origin');
      c.header('Cross-Origin-Embedder-Policy', 'credentialless');
      c.header('Origin-Agent-Cluster', '?1');
      // No CSP — bolt.diy needs full access (WASM, eval, workers, etc.)
    }
    return;
  }

  // ── Served sites ({slug}.projectsites.dev) ─────────────────
  if (isServedSite) {
    // User-generated sites: permissive CSP, allow framing everywhere
    c.header('Cross-Origin-Embedder-Policy', 'credentialless');
    c.header('Cross-Origin-Resource-Policy', 'cross-origin');
    c.header(
      'Content-Security-Policy',
      [
        "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:",
        "img-src * data: blob:",
        "frame-ancestors *",
        "object-src 'none'",
      ].join('; '),
    );
    return;
  }

  // ── Dashboard / Marketing (projectsites.dev) ───────────────
  // Permissive CSP — the dashboard uses blob URLs for image previews,
  // embeds bolt.diy in iframes, loads images from R2/CDN, and integrates
  // Stripe, PostHog, Google Analytics, Transloadit, etc.
  c.header('X-Frame-Options', 'SAMEORIGIN');
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'self' 'unsafe-inline' 'unsafe-eval' https: data: blob:",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https: blob:",
      "style-src 'self' 'unsafe-inline' https: blob:",
      "img-src * data: blob:",
      "font-src 'self' https: data:",
      "connect-src * data: blob:",
      "media-src * data: blob:",
      "worker-src 'self' blob:",
      "child-src 'self' blob: https:",
      "frame-src *",
      "frame-ancestors 'self' https://*.projectsites.dev",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '),
  );
};
