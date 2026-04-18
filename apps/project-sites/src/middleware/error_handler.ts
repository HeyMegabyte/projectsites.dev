import type { ErrorHandler } from 'hono';
import { AppError } from '@project-sites/shared';
import { ZodError } from 'zod';
import type { Env, Variables } from '../types/env.js';
import { captureError } from '../lib/sentry.js';
import * as posthog from '../lib/posthog.js';

/**
 * Generate a branded HTML error page matching the ProjectSites design system.
 * Uses Fira Code for debug info, animated gradients, and a cyber/terminal aesthetic.
 */
function brandedErrorPage(opts: {
  status: number;
  code: string;
  message: string;
  requestId: string;
  details?: string;
}): string {
  const titles: Record<number, string> = {
    400: 'Bad Request',
    401: 'Not Authorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    413: 'Too Large',
    429: 'Too Many Requests',
    500: 'Server Error',
    502: 'Bad Gateway',
    503: 'Service Unavailable',
  };
  const title = titles[opts.status] || `Error ${opts.status}`;
  const emoji: Record<number, string> = { 400: 'form', 401: 'lock', 403: 'shield', 404: 'search', 429: 'clock', 500: 'alert', 502: 'cloud', 503: 'wrench' };
  const icon = emoji[opts.status] || 'alert';
  const suggestions: Record<number, string> = {
    400: 'Check the request format and try again.',
    401: 'Please <a href="https://projectsites.dev/" class="link">sign in</a> to continue.',
    403: 'You don\'t have permission to access this resource.',
    404: 'This page doesn\'t exist. <a href="https://projectsites.dev/create" class="link">Build a site</a> instead?',
    429: 'You\'re sending too many requests. Wait a moment and try again.',
    500: 'Something went wrong on our end. We\'ve been notified.',
    502: 'Our upstream service is temporarily unavailable.',
    503: 'We\'re briefly offline for maintenance. Back shortly.',
  };
  const suggestion = suggestions[opts.status] || 'Try again or <a href="https://projectsites.dev/" class="link">go home</a>.';

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | ProjectSites</title><link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@300;400;500&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0f;color:#e0e0e0;font-family:'Space Grotesk',sans-serif;overflow:hidden}@keyframes gradient{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}@keyframes scanline{0%{top:-100%}100%{top:100%}}@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}.bg{position:fixed;inset:0;background:linear-gradient(-45deg,#0a0a0f,#0d1117,#0a1628,#0f0a1e);background-size:400% 400%;animation:gradient 8s ease infinite}.grid{position:fixed;inset:0;background-image:linear-gradient(rgba(0,255,200,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,200,.03) 1px,transparent 1px);background-size:60px 60px}.scanline{position:fixed;width:100%;height:4px;background:linear-gradient(90deg,transparent,rgba(0,255,200,.08),transparent);animation:scanline 4s linear infinite;z-index:0}.container{text-align:center;max-width:600px;padding:2rem;position:relative;z-index:1}.code{font-size:7rem;font-weight:700;background:linear-gradient(135deg,#00ffc8,#00d4ff,#7c3aed);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;animation:float 3s ease-in-out infinite;line-height:1}.title{font-size:1.8rem;color:#c8d6e5;margin:.5rem 0}.msg{font-size:1.1rem;color:#8892a4;margin:1rem 0 2rem;line-height:1.6}.link{color:#00ffc8;text-decoration:none;border-bottom:1px solid rgba(0,255,200,.3);transition:all .3s}.link:hover{border-color:#00ffc8;text-shadow:0 0 8px rgba(0,255,200,.3)}.actions{display:flex;gap:1rem;justify-content:center;flex-wrap:wrap;margin-bottom:2rem}.btn{display:inline-block;padding:12px 28px;border-radius:50px;text-decoration:none;font-weight:600;font-family:inherit;transition:all .3s}.btn-primary{background:linear-gradient(135deg,#00ffc8,#00d4ff);color:#0a0a0f}.btn-primary:hover{transform:translateY(-3px);box-shadow:0 8px 30px rgba(0,255,200,.3)}.btn-ghost{background:transparent;color:#8892a4;border:1px solid rgba(255,255,255,.1)}.btn-ghost:hover{border-color:#00ffc8;color:#00ffc8}.debug{margin-top:2rem;text-align:left;background:rgba(0,255,200,.03);border:1px solid rgba(0,255,200,.08);border-radius:12px;padding:1.5rem;font-family:'Fira Code',monospace;font-size:.72rem;color:#4a9;line-height:2}.debug-title{color:#00ffc8;font-size:.8rem;margin-bottom:.5rem;font-weight:500;display:flex;align-items:center;gap:6px}.debug-title::after{content:'_';animation:blink 1s infinite}.debug span{color:#556}</style></head><body><div class="bg"></div><div class="grid"></div><div class="scanline"></div><div class="container"><div class="code">${opts.status}</div><h1 class="title">${title}</h1><p class="msg">${suggestion}</p><div class="actions"><a class="btn btn-primary" href="https://projectsites.dev/">Go Home</a><a class="btn btn-ghost" href="https://projectsites.dev/create">Build a Site</a></div><div class="debug"><div class="debug-title">// diagnostics</div><span>status:</span> ${opts.status} ${title}<br><span>code:</span> ${opts.code}<br><span>message:</span> ${opts.message}<br><span>request_id:</span> ${opts.requestId}<br><span>timestamp:</span> ${new Date().toISOString()}${opts.details ? '<br><span>details:</span> ' + opts.details : ''}</div></div></body></html>`;
}

/**
 * Check if the request prefers HTML over JSON (browser vs API client).
 */
function prefersHtml(accept: string | undefined): boolean {
  if (!accept) return false;
  // Only return HTML if the client explicitly asks for text/html
  // Do NOT match on */* (which curl and API clients send)
  if (!accept.includes('text/html')) return false;
  const jsonIdx = accept.indexOf('application/json');
  if (jsonIdx === -1) return true;
  return accept.indexOf('text/html') < jsonIdx;
}

/**
 * Global error handler.
 *
 * Returns branded HTML error pages for browser requests (Accept: text/html)
 * and structured JSON for API clients (Accept: application/json).
 *
 * Reports errors to Sentry and PostHog for observability.
 */
export const errorHandler: ErrorHandler<{
  Bindings: Env;
  Variables: Variables;
}> = (err, c) => {
  const requestId = c.get('requestId') ?? 'unknown';
  const url = c.req.url;
  const method = c.req.method;
  const isHtml = prefersHtml(c.req.header('accept'));

  // Safely access executionCtx (not available in test environments)
  let ctx: ExecutionContext | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    // executionCtx not available outside Workers runtime
  }

  // AppError: known typed errors
  if (err instanceof AppError) {
    console.warn(
      JSON.stringify({
        level: err.statusCode >= 500 ? 'error' : 'warn',
        code: err.code,
        message: err.message,
        request_id: requestId,
        status: err.statusCode,
        url,
        method,
      }),
    );

    // Report 5xx to Sentry
    if (err.statusCode >= 500) {
      captureError(c, err, { code: err.code, url, method });
      if (ctx) {
        posthog.trackError(c.env, ctx, err.code, err.message, {
          request_id: requestId,
          status: err.statusCode,
          url,
        });
      }
    }

    if (isHtml) {
      return new Response(
        brandedErrorPage({ status: err.statusCode, code: err.code, message: err.message, requestId }),
        { status: err.statusCode, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
      );
    }
    return c.json(err.toJSON(), err.statusCode as 400);
  }

  // ZodError: validation failures
  const isZodError = err instanceof ZodError ||
    (err && typeof err === 'object' && 'issues' in err && Array.isArray((err as ZodError).issues));
  if (isZodError) {
    const zodErr = err as ZodError;
    const issues = zodErr.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));

    console.warn(
      JSON.stringify({
        level: 'warn',
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        request_id: requestId,
        url,
        method,
        issues,
      }),
    );

    if (isHtml) {
      const details = issues.map(i => `${i.path}: ${i.message}`).join('; ');
      return new Response(
        brandedErrorPage({ status: 400, code: 'VALIDATION_ERROR', message: 'Request validation failed', requestId, details }),
        { status: 400, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
      );
    }
    return c.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Request validation failed', request_id: requestId, details: { issues } } },
      400,
    );
  }

  // Unknown errors
  const errorMessage = err instanceof Error ? err.message : 'Unknown error';
  const errorStack = err instanceof Error ? err.stack : undefined;

  console.warn(
    JSON.stringify({
      level: 'error',
      code: 'INTERNAL_ERROR',
      message: errorMessage,
      request_id: requestId,
      url,
      method,
      stack: errorStack,
    }),
  );

  captureError(c, err, { url, method, request_id: requestId });
  if (ctx) {
    posthog.trackError(c.env, ctx, 'INTERNAL_ERROR', errorMessage, { request_id: requestId, url });
  }

  if (isHtml) {
    return new Response(
      brandedErrorPage({ status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong on our end', requestId }),
      { status: 500, headers: { 'Content-Type': 'text/html;charset=utf-8' } },
    );
  }
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error', request_id: requestId } },
    500,
  );
};
