/**
 * Cloudflare Worker environment bindings.
 * All secrets and bindings defined here.
 */
export interface Env {
  // KV
  CACHE_KV: KVNamespace;
  PROMPT_STORE: KVNamespace;

  // D1
  DB: D1Database;

  // R2
  SITES_BUCKET: R2Bucket;

  // Queue
  WORKFLOW_QUEUE: Queue;

  // Workers AI
  AI: Ai;

  // Environment
  ENVIRONMENT: string;

  // PostHog
  POSTHOG_API_KEY: string;
  POSTHOG_HOST?: string;

  // Supabase
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  // Stripe
  STRIPE_SECRET_KEY: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;

  // AI
  OPENAI_API_KEY?: string;
  OPEN_ROUTER_API_KEY?: string;
  GROQ_API_KEY?: string;

  // Cloudflare
  CF_API_TOKEN: string;
  CF_ZONE_ID: string;

  // SendGrid
  SENDGRID_API_KEY: string;

  // Chatwoot
  CHATWOOT_API_URL?: string;
  CHATWOOT_API_KEY?: string;

  // Novu
  NOVU_API_KEY?: string;

  // Google
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_PLACES_API_KEY: string;

  // Sentry
  SENTRY_DSN: string;

  // Sale webhook
  SALE_WEBHOOK_URL?: string;
  SALE_WEBHOOK_SECRET?: string;

  // Metering
  METERING_PROVIDER?: string;
}

/**
 * Hono context variables.
 */
export interface Variables {
  requestId: string;
  userId?: string;
  orgId?: string;
  userRole?: string;
  billingAdmin?: boolean;
}
