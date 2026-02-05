/**
 * Worker environment and context types
 */
import type { Context as HonoContext, Env as HonoEnv } from 'hono';
import type { SupabaseClient } from '@supabase/supabase-js';
import type Stripe from 'stripe';
import type { AuthContext } from '@project-sites/shared';

// ============================================================================
// CLOUDFLARE BINDINGS
// ============================================================================

export interface CloudflareBindings {
  // KV Namespaces
  CACHE_KV: KVNamespace;

  // R2 Buckets
  SITES_BUCKET: R2Bucket;

  // Queues
  WORKFLOW_QUEUE: Queue;

  // Environment Variables (Secrets)
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;
  STRIPE_PUBLISHABLE_KEY: string;
  OPENAI_API_KEY: string;
  CF_API_TOKEN: string;
  CF_ZONE_ID: string;
  CF_ACCOUNT_ID: string;
  SENDGRID_API_KEY: string;
  CHATWOOT_API_URL: string;
  CHATWOOT_API_KEY: string;
  NOVU_API_KEY: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_PLACES_API_KEY: string;
  SENTRY_DSN: string;

  // Optional
  LAGO_API_URL?: string;
  LAGO_API_KEY?: string;
  SALE_WEBHOOK_URL?: string;
  SALE_WEBHOOK_SECRET?: string;

  // Environment
  ENVIRONMENT?: 'development' | 'staging' | 'production';
  LOG_LEVEL?: 'debug' | 'info' | 'warn' | 'error';
  SITE_BASE_DOMAIN?: string;
  API_BASE_URL?: string;
  STRIPE_MODE?: 'test' | 'live';
}

// ============================================================================
// HONO CONTEXT
// ============================================================================

export interface Variables {
  request_id: string;
  trace_id: string;
  auth?: AuthContext;
  org_id?: string;
  db: SupabaseClient;
  stripe: Stripe;
  start_time: number;
}

export type Bindings = CloudflareBindings;

export interface AppEnv extends HonoEnv {
  Bindings: Bindings;
  Variables: Variables;
}

export type AppContext = HonoContext<AppEnv>;

// ============================================================================
// REQUEST/RESPONSE TYPES
// ============================================================================

export interface RequestMeta {
  request_id: string;
  trace_id: string;
  ip_address?: string;
  user_agent?: string;
  path: string;
  method: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta?: Record<string, unknown>;
  request_id?: string;
}

// ============================================================================
// QUEUE MESSAGE TYPES
// ============================================================================

export interface QueueMessage {
  type: string;
  payload: Record<string, unknown>;
  metadata: {
    request_id: string;
    trace_id: string;
    org_id?: string;
    attempt: number;
    max_attempts: number;
    scheduled_at: string;
  };
}

// ============================================================================
// CRON HANDLER TYPES
// ============================================================================

export interface CronContext {
  env: CloudflareBindings;
  ctx: ExecutionContext;
  cron: string;
}
