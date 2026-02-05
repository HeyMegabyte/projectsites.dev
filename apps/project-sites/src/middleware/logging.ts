/**
 * Logging middleware
 * Structured JSON logs with request/response info
 */
import type { MiddlewareHandler } from 'hono';
import { redactSensitive } from '@project-sites/shared';
import type { AppContext } from '../types.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(configuredLevel: LogLevel, messageLevel: LogLevel): boolean {
  return LOG_LEVELS[messageLevel] >= LOG_LEVELS[configuredLevel];
}

export const loggingMiddleware: MiddlewareHandler<AppContext> = async (c, next) => {
  const requestContext = c.get('requestContext');
  const startTime = c.get('startTime');
  const logLevel = (c.env.LOG_LEVEL ?? 'info') as LogLevel;

  // Log incoming request (debug level)
  if (shouldLog(logLevel, 'debug')) {
    const requestLog = {
      level: 'debug',
      type: 'request',
      timestamp: requestContext?.timestamp,
      request_id: requestContext?.request_id,
      trace_id: requestContext?.trace_id,
      method: c.req.method,
      path: c.req.path,
      query: Object.fromEntries(new URL(c.req.url).searchParams),
      ip: requestContext?.ip,
      user_agent: requestContext?.user_agent,
      country: requestContext?.country,
    };
    console.log(JSON.stringify(redactSensitive(requestLog)));
  }

  await next();

  // Log response (info level)
  if (shouldLog(logLevel, 'info')) {
    const duration = Date.now() - (startTime ?? Date.now());
    const status = c.res.status;

    const responseLog = {
      level: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
      type: 'response',
      timestamp: new Date().toISOString(),
      request_id: requestContext?.request_id,
      trace_id: requestContext?.trace_id,
      method: c.req.method,
      path: c.req.path,
      status,
      duration_ms: duration,
      user_id: c.get('auth')?.user_id,
      org_id: c.get('org')?.org_id,
    };

    console.log(JSON.stringify(redactSensitive(responseLog)));
  }
};
