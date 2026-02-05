/**
 * Environment-aware configuration management
 * Handles Stripe key selection based on environment mode
 */

import type { CloudflareBindings } from '../types';

// ============================================================================
// TYPES
// ============================================================================

export type Environment = 'development' | 'staging' | 'production';
export type StripeMode = 'test' | 'live';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppConfig {
  environment: Environment;
  stripeMode: StripeMode;
  logLevel: LogLevel;
  siteBaseDomain: string;
  apiBaseUrl: string;
  isProduction: boolean;
  isStaging: boolean;
  isDevelopment: boolean;
  isTest: boolean;
}

export interface StripeConfig {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  mode: StripeMode;
}

// ============================================================================
// CONFIG LOADER
// ============================================================================

/**
 * Load application configuration from environment bindings
 * Uses sensible defaults for missing values
 */
export function loadConfig(env: CloudflareBindings): AppConfig {
  const environment = validateEnvironment(env.ENVIRONMENT);
  const stripeMode = validateStripeMode(env.STRIPE_MODE, environment);
  const logLevel = validateLogLevel(env.LOG_LEVEL, environment);

  return {
    environment,
    stripeMode,
    logLevel,
    siteBaseDomain: env.SITE_BASE_DOMAIN ?? getDefaultSiteBaseDomain(environment),
    apiBaseUrl: env.API_BASE_URL ?? getDefaultApiBaseUrl(environment),
    isProduction: environment === 'production',
    isStaging: environment === 'staging',
    isDevelopment: environment === 'development',
    isTest: stripeMode === 'test',
  };
}

/**
 * Load Stripe configuration with environment-aware key selection
 * In test mode, always uses test keys regardless of what's configured
 */
export function loadStripeConfig(env: CloudflareBindings, config: AppConfig): StripeConfig {
  const mode = config.stripeMode;

  // Validate that required keys exist
  if (!env.STRIPE_SECRET_KEY) {
    throw new ConfigurationError('STRIPE_SECRET_KEY is required but not set');
  }
  if (!env.STRIPE_PUBLISHABLE_KEY) {
    throw new ConfigurationError('STRIPE_PUBLISHABLE_KEY is required but not set');
  }

  // Validate key format matches mode
  validateStripeKeyFormat(env.STRIPE_SECRET_KEY, mode, 'secret');
  validateStripeKeyFormat(env.STRIPE_PUBLISHABLE_KEY, mode, 'publishable');

  return {
    secretKey: env.STRIPE_SECRET_KEY,
    publishableKey: env.STRIPE_PUBLISHABLE_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    mode,
  };
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

function validateEnvironment(value: string | undefined): Environment {
  const validEnvironments: Environment[] = ['development', 'staging', 'production'];

  if (!value) {
    return 'development';
  }

  const normalized = value.toLowerCase() as Environment;
  if (!validEnvironments.includes(normalized)) {
    console.warn(`Invalid ENVIRONMENT value "${value}", defaulting to "development"`);
    return 'development';
  }

  return normalized;
}

function validateStripeMode(value: string | undefined, environment: Environment): StripeMode {
  // In production, always use live mode
  if (environment === 'production') {
    if (value === 'test') {
      console.warn('STRIPE_MODE=test is not allowed in production, using live mode');
    }
    return 'live';
  }

  // In development and staging, default to test mode
  if (!value) {
    return 'test';
  }

  const normalized = value.toLowerCase() as StripeMode;
  if (normalized !== 'test' && normalized !== 'live') {
    console.warn(`Invalid STRIPE_MODE value "${value}", defaulting to "test"`);
    return 'test';
  }

  return normalized;
}

function validateLogLevel(value: string | undefined, environment: Environment): LogLevel {
  const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

  if (!value) {
    return environment === 'production' ? 'info' : 'debug';
  }

  const normalized = value.toLowerCase() as LogLevel;
  if (!validLevels.includes(normalized)) {
    console.warn(`Invalid LOG_LEVEL value "${value}", defaulting based on environment`);
    return environment === 'production' ? 'info' : 'debug';
  }

  return normalized;
}

function validateStripeKeyFormat(key: string, mode: StripeMode, type: 'secret' | 'publishable'): void {
  const prefix = type === 'secret' ? 'sk_' : 'pk_';
  const expectedPrefix = mode === 'test' ? `${prefix}test_` : `${prefix}live_`;

  if (!key.startsWith(expectedPrefix)) {
    throw new ConfigurationError(
      `Stripe ${type} key does not match expected mode. ` +
      `Expected prefix "${expectedPrefix}" for ${mode} mode, but key starts with "${key.substring(0, 8)}..."`
    );
  }
}

function getDefaultSiteBaseDomain(environment: Environment): string {
  switch (environment) {
    case 'production':
      return 'sites.megabyte.space';
    case 'staging':
      return 'sites-staging.megabyte.space';
    default:
      return 'localhost:8787';
  }
}

function getDefaultApiBaseUrl(environment: Environment): string {
  switch (environment) {
    case 'production':
      return 'https://api.sites.megabyte.space';
    case 'staging':
      return 'https://api.sites-staging.megabyte.space';
    default:
      return 'http://localhost:8787';
  }
}

// ============================================================================
// CONFIGURATION ERROR
// ============================================================================

export class ConfigurationError extends Error {
  public readonly code = 'CONFIGURATION_ERROR';
  public readonly isOperational = true;

  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

// ============================================================================
// REQUIRED SECRETS VALIDATION
// ============================================================================

export interface SecretValidationResult {
  valid: boolean;
  missing: string[];
  warnings: string[];
}

/**
 * Validate that all required secrets are present
 */
export function validateRequiredSecrets(env: CloudflareBindings): SecretValidationResult {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'STRIPE_SECRET_KEY',
    'STRIPE_PUBLISHABLE_KEY',
  ];

  const recommended = [
    'STRIPE_WEBHOOK_SECRET',
    'CF_API_TOKEN',
    'CF_ZONE_ID',
    'SENDGRID_API_KEY',
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
  ];

  const missing: string[] = [];
  const warnings: string[] = [];

  for (const key of required) {
    if (!env[key as keyof CloudflareBindings]) {
      missing.push(key);
    }
  }

  for (const key of recommended) {
    if (!env[key as keyof CloudflareBindings]) {
      warnings.push(`Recommended secret "${key}" is not set - some features may not work`);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
    warnings,
  };
}
