import type { MiddlewareHandler } from 'hono';
import type { Env, Variables } from '../types/env.js';

/**
 * Set security headers on all responses.
 * Conservative CSP baseline with HSTS.
 */
export const securityHeadersMiddleware: MiddlewareHandler<{
  Bindings: Env;
  Variables: Variables;
}> = async (c, next) => {
  await next();

  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://unpkg.com https://releases.transloadit.com https://js.stripe.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://releases.transloadit.com",
      "img-src 'self' data: https:",
      "font-src 'self' https://fonts.gstatic.com",
      "connect-src 'self' https://api.stripe.com https://lottie.host",
      'frame-src https://js.stripe.com',
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; '),
  );
};
