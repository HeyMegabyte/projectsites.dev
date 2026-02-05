/**
 * Configuration and environment validation schemas
 * Fail-fast validation at boot time
 */
import { z } from 'zod';

// =============================================================================
// ENVIRONMENT ENUM
// =============================================================================

export const environmentSchema = z.enum(['development', 'test', 'staging', 'production']);

export type Environment = z.infer<typeof environmentSchema>;

// =============================================================================
// STRIPE MODE VALIDATION
// =============================================================================

export const stripeModeSchema = z.enum(['test', 'live']);

export type StripeMode = z.infer<typeof stripeModeSchema>;

/** Validate Stripe key matches expected mode */
export function validateStripeKey(key: string, expectedMode: StripeMode): boolean {
  if (expectedMode === 'test') {
    return key.startsWith('sk_test_') || key.startsWith('pk_test_');
  }
  return key.startsWith('sk_live_') || key.startsWith('pk_live_');
}

// =============================================================================
// BASE CONFIG SCHEMA (required for all environments)
// =============================================================================

export const baseConfigSchema = z.object({
  // Environment
  ENVIRONMENT: environmentSchema,

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

  // Stripe
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),

  // Cloudflare
  CF_API_TOKEN: z.string().min(1),
  CF_ZONE_ID: z.string().min(1),
  CF_ACCOUNT_ID: z.string().min(1),

  // External services
  SENDGRID_API_KEY: z.string().min(1),
  GOOGLE_PLACES_API_KEY: z.string().min(1),

  // Observability
  SENTRY_DSN: z.string().url(),
});

export type BaseConfig = z.infer<typeof baseConfigSchema>;

// =============================================================================
// OPTIONAL CONFIG (with defaults or optional in some envs)
// =============================================================================

export const optionalConfigSchema = z.object({
  // AI Providers
  OPENAI_API_KEY: z.string().optional(),
  OPEN_ROUTER_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),

  // OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  // Communications
  CHATWOOT_API_URL: z.string().url().optional(),
  CHATWOOT_API_KEY: z.string().optional(),
  NOVU_API_KEY: z.string().optional(),

  // Sale webhook
  SALE_WEBHOOK_URL: z.string().url().optional(),
  SALE_WEBHOOK_SECRET: z.string().optional(),

  // Feature flags
  METERING_PROVIDER: z.enum(['lago', 'internal']).default('internal'),
  ENABLE_POSTCARDS: z.boolean().default(false),
});

export type OptionalConfig = z.infer<typeof optionalConfigSchema>;

// =============================================================================
// FULL CONFIG SCHEMA
// =============================================================================

export const fullConfigSchema = baseConfigSchema.merge(optionalConfigSchema);

export type FullConfig = z.infer<typeof fullConfigSchema>;

// =============================================================================
// ENVIRONMENT-SPECIFIC GUARDS
// =============================================================================

/**
 * Validate configuration for the given environment
 * Throws on invalid configuration (fail-fast)
 */
export function validateConfig(config: Record<string, unknown>, env: Environment): FullConfig {
  // First, validate basic structure
  const parsed = fullConfigSchema.parse(config);

  // Environment-specific guards
  if (env === 'production') {
    // Production must have Sentry
    if (!parsed.SENTRY_DSN) {
      throw new Error('SENTRY_DSN required in production');
    }

    // Production must use live Stripe keys
    if (
      parsed.STRIPE_SECRET_KEY.startsWith('sk_test_') ||
      parsed.STRIPE_PUBLISHABLE_KEY.startsWith('pk_test_')
    ) {
      throw new Error('Production cannot use Stripe test keys');
    }

    // Production must have webhook secrets
    if (!parsed.STRIPE_WEBHOOK_SECRET) {
      throw new Error('STRIPE_WEBHOOK_SECRET required in production');
    }
  } else {
    // Non-production must NOT use live Stripe keys
    if (
      parsed.STRIPE_SECRET_KEY.startsWith('sk_live_') ||
      parsed.STRIPE_PUBLISHABLE_KEY.startsWith('pk_live_')
    ) {
      throw new Error(`${env} environment cannot use Stripe live keys`);
    }
  }

  return parsed;
}

/**
 * Get Stripe mode for environment
 */
export function getStripeMode(env: Environment): StripeMode {
  return env === 'production' ? 'live' : 'test';
}

// =============================================================================
// WRANGLER BINDINGS SCHEMA
// =============================================================================

export const wranglerBindingsSchema = z.object({
  // KV Namespaces
  CACHE_KV: z.custom<KVNamespace>(),

  // R2 Buckets
  SITES_BUCKET: z.custom<R2Bucket>(),

  // Queues
  WORKFLOW_QUEUE: z.custom<Queue>(),

  // Environment variables (from secrets/vars)
  ...fullConfigSchema.shape,
});

// For runtime, we need a simpler check
export function hasRequiredBindings(env: unknown): env is z.infer<typeof wranglerBindingsSchema> {
  if (!env || typeof env !== 'object') return false;
  const e = env as Record<string, unknown>;
  return (
    typeof e.CACHE_KV === 'object' &&
    typeof e.SITES_BUCKET === 'object' &&
    typeof e.SUPABASE_URL === 'string' &&
    typeof e.STRIPE_SECRET_KEY === 'string'
  );
}
