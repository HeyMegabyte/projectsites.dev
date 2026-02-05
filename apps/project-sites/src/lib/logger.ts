/**
 * Structured logging utility with log levels, context, and PII redaction
 * Designed for Cloudflare Workers environment
 */

import { redactPii } from '@project-sites/shared';
import type { LogLevel, AppConfig } from './config';

// ============================================================================
// TYPES
// ============================================================================

export interface LogContext {
  request_id?: string;
  trace_id?: string;
  org_id?: string;
  user_id?: string;
  method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: ErrorInfo;
}

export interface ErrorInfo {
  name: string;
  message: string;
  stack?: string;
  code?: string;
  cause?: string;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: Error | unknown, context?: LogContext): void;
  child(context: LogContext): Logger;
}

// ============================================================================
// LOG LEVEL PRIORITY
// ============================================================================

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// ============================================================================
// LOGGER IMPLEMENTATION
// ============================================================================

export class StructuredLogger implements Logger {
  private readonly level: LogLevel;
  private readonly baseContext: LogContext;
  private readonly environment: string;
  private readonly redactPiiEnabled: boolean;

  constructor(config: Pick<AppConfig, 'logLevel' | 'environment'>, baseContext: LogContext = {}) {
    this.level = config.logLevel;
    this.environment = config.environment;
    this.baseContext = baseContext;
    // Always redact PII in production and staging
    this.redactPiiEnabled = config.environment !== 'development';
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorInfo = error ? this.formatError(error) : undefined;
    this.log('error', message, context, errorInfo);
  }

  child(context: LogContext): Logger {
    return new StructuredLogger(
      { logLevel: this.level, environment: this.environment as AppConfig['environment'] },
      { ...this.baseContext, ...context }
    );
  }

  private log(level: LogLevel, message: string, context?: LogContext, error?: ErrorInfo): void {
    // Check if this log level should be emitted
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[this.level]) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message: this.redactPiiEnabled ? redactPii(message) : message,
      context: this.buildContext(context),
      error,
    };

    // Output based on level
    const output = JSON.stringify(entry);
    switch (level) {
      case 'debug':
        console.debug(output);
        break;
      case 'info':
        console.info(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
        console.error(output);
        break;
    }
  }

  private buildContext(context?: LogContext): LogContext | undefined {
    const merged = { ...this.baseContext, ...context };

    if (Object.keys(merged).length === 0) {
      return undefined;
    }

    // Redact sensitive values in context
    if (this.redactPiiEnabled) {
      return this.redactContextValues(merged);
    }

    return merged;
  }

  private redactContextValues(context: LogContext): LogContext {
    const sensitiveKeys = ['email', 'phone', 'ip_address', 'user_agent', 'authorization', 'cookie'];
    const redacted: LogContext = {};

    for (const [key, value] of Object.entries(context)) {
      if (value === undefined || value === null) {
        continue;
      }

      const lowerKey = key.toLowerCase();
      if (sensitiveKeys.some((sk) => lowerKey.includes(sk))) {
        redacted[key] = typeof value === 'string' ? redactPii(value) : '[REDACTED]';
      } else if (typeof value === 'string') {
        redacted[key] = redactPii(value);
      } else {
        redacted[key] = value;
      }
    }

    return redacted;
  }

  private formatError(error: Error | unknown): ErrorInfo {
    if (error instanceof Error) {
      const info: ErrorInfo = {
        name: error.name,
        message: this.redactPiiEnabled ? redactPii(error.message) : error.message,
      };

      // Include stack trace only in non-production environments
      if (this.environment !== 'production' && error.stack) {
        info.stack = error.stack;
      }

      // Include error code if present
      if ('code' in error && typeof error.code === 'string') {
        info.code = error.code;
      }

      // Include cause if present
      if (error.cause instanceof Error) {
        info.cause = error.cause.message;
      }

      return info;
    }

    // Handle non-Error objects
    return {
      name: 'UnknownError',
      message: String(error),
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a new logger instance
 */
export function createLogger(
  config: Pick<AppConfig, 'logLevel' | 'environment'>,
  context?: LogContext
): Logger {
  return new StructuredLogger(config, context);
}

// ============================================================================
// REQUEST LOGGER MIDDLEWARE HELPER
// ============================================================================

export interface RequestLogData {
  request_id: string;
  method: string;
  path: string;
  status_code: number;
  duration_ms: number;
  ip_address?: string;
  user_agent?: string;
  content_length?: number;
  org_id?: string;
  user_id?: string;
}

/**
 * Format request completion log
 */
export function logRequestCompletion(logger: Logger, data: RequestLogData): void {
  const emoji = data.status_code >= 500 ? '❌' : data.status_code >= 400 ? '⚠️' : '✅';
  const message = `${emoji} ${data.method} ${data.path} ${data.status_code} ${data.duration_ms}ms`;

  if (data.status_code >= 500) {
    logger.error(message, undefined, data);
  } else if (data.status_code >= 400) {
    logger.warn(message, data);
  } else {
    logger.info(message, data);
  }
}
