import { z } from 'zod';

/** Environment names */
export const environmentSchema = z.enum(['development', 'test', 'staging', 'production']);
export type Environment = z.infer<typeof environmentSchema>;

/** Stripe mode derived from environment */
export const stripeModeSchema = z.enum(['test', 'live']);

/**
 * Full environment config validated at Worker boot.
 * Fail fast if required vars are missing.
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

    // SendGrid
    SENDGRID_API_KEY: z.string().min(1),

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

export type EnvConfig = z.infer<typeof envConfigSchema>;

/**
 * Validate env config at boot. Throws on invalid config.
 */
export function validateEnvConfig(raw: Record<string, unknown>): EnvConfig {
  return envConfigSchema.parse(raw);
}
