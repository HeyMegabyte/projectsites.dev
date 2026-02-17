/**
 * @module config
 * @packageDocumentation
 *
 * Zod schemas for validating the Cloudflare Worker environment configuration.
 *
 * The Worker calls {@link validateEnvConfig} at boot to parse all required
 * and optional environment variables. Validation fails fast so that
 * misconfigured deployments surface immediately rather than at request time.
 *
 * A `superRefine` rule additionally ensures that Stripe **live** keys are
 * never used outside production and **test** keys are never used in
 * production, preventing accidental real charges during development.
 *
 * ## Schemas and Types
 *
 * | Export                | Kind          | Inferred Type | Description                                 |
 * | --------------------- | ------------- | ------------- | ------------------------------------------- |
 * | `environmentSchema`   | `ZodEnum`     | `Environment` | Allowed deployment environments             |
 * | `stripeModeSchema`    | `ZodEnum`     | -             | `'test'` or `'live'` Stripe key mode        |
 * | `envConfigSchema`     | `ZodObject`   | `EnvConfig`   | Full Worker environment variable validation |
 *
 * ## Usage
 *
 * ```ts
 * import { validateEnvConfig } from '@shared/schemas/config.js';
 *
 * // Typically called once inside the Worker's `fetch` handler:
 * const config = validateEnvConfig(env);
 * ```
 */
import { z } from 'zod';

/**
 * Validates the deployment environment name.
 *
 * Allowed values: `'development'`, `'test'`, `'staging'`, `'production'`.
 */
export const environmentSchema = z.enum(['development', 'test', 'staging', 'production']);

/** Inferred union type of valid environment names. */
export type Environment = z.infer<typeof environmentSchema>;

/**
 * Validates the Stripe key mode.
 *
 * Derived from the key prefix (`sk_test_` / `sk_live_`). Used to assert
 * that the correct key mode is active for the current environment.
 */
export const stripeModeSchema = z.enum(['test', 'live']);

/**
 * Full environment configuration schema validated at Worker boot time.
 *
 * Every required binding is validated for presence and basic format.
 * Optional bindings (AI providers, Chatwoot, Novu, sale webhook) gracefully
 * default to `undefined` when absent.
 *
 * ### Cross-field validation (superRefine)
 *
 * - **Production** environments **must** use Stripe **live** keys (`sk_live_` / `pk_live_`).
 * - **Non-production** environments **must** use Stripe **test** keys (`sk_test_` / `pk_test_`).
 *
 * Parsing throws a `ZodError` on any violation, crashing the Worker during
 * cold-start so the issue is surfaced immediately.
 */
export const envConfigSchema = z
  .object({
    ENVIRONMENT: environmentSchema,

    // Stripe
    STRIPE_SECRET_KEY: z.string().min(1),
    STRIPE_PUBLISHABLE_KEY: z.string().min(1),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),

    // OpenAI / AI
    OPENAI_API_KEY: z.string().min(1).optional(),
    OPEN_ROUTER_API_KEY: z.string().min(1).optional(),
    GROQ_API_KEY: z.string().min(1).optional(),

    // Cloudflare
    CF_API_TOKEN: z.string().min(1),
    CF_ZONE_ID: z.string().min(1),

    // Email (Resend primary, SendGrid fallback — at least one should be set)
    RESEND_API_KEY: z.string().min(1).optional(),
    SENDGRID_API_KEY: z.string().min(1).optional(),

    // Chatwoot
    CHATWOOT_API_URL: z.string().url().optional(),
    CHATWOOT_API_KEY: z.string().min(1).optional(),

    // Novu
    NOVU_API_KEY: z.string().min(1).optional(),

    // Google
    GOOGLE_CLIENT_ID: z.string().min(1),
    GOOGLE_CLIENT_SECRET: z.string().min(1),
    GOOGLE_PLACES_API_KEY: z.string().min(1),

    // Sentry
    SENTRY_DSN: z.string().url(),

    // Sale webhook
    SALE_WEBHOOK_URL: z.string().url().optional(),
    SALE_WEBHOOK_SECRET: z.string().min(1).optional(),

    // Metering
    METERING_PROVIDER: z.enum(['lago', 'internal']).default('internal'),
  })
  .superRefine((val, ctx) => {
    const isProduction = val.ENVIRONMENT === 'production';
    const stripeKey = val.STRIPE_SECRET_KEY;
    const pubKey = val.STRIPE_PUBLISHABLE_KEY;

    // Production must use live keys
    if (isProduction && (stripeKey.startsWith('sk_test_') || pubKey.startsWith('pk_test_'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Production environment cannot use Stripe test keys',
        path: ['STRIPE_SECRET_KEY'],
      });
    }

    // Non-production must use test keys
    if (!isProduction && (stripeKey.startsWith('sk_live_') || pubKey.startsWith('pk_live_'))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Non-production environment cannot use Stripe live keys',
        path: ['STRIPE_SECRET_KEY'],
      });
    }
  });

/** Inferred TypeScript type for the fully validated Worker environment config. */
export type EnvConfig = z.infer<typeof envConfigSchema>;

/**
 * Parses and validates the raw Worker environment bindings at boot time.
 *
 * Call this once during cold-start (typically in the Hono app factory).
 * If any required variable is missing or a cross-field constraint is
 * violated, a `ZodError` is thrown causing the Worker to fail fast.
 *
 * @param raw - The untyped `env` record provided by the Cloudflare runtime.
 * @returns A fully typed and validated {@link EnvConfig} object.
 * @throws {z.ZodError} When one or more environment variables are invalid.
 */
export function validateEnvConfig(raw: Record<string, unknown>): EnvConfig {
  return envConfigSchema.parse(raw);
}
