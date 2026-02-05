/**
 * Type definitions for the Project Sites Worker
 */
import type { Context as HonoContext } from 'hono';
import type { AuthContext, OrgContext, RequestContext } from '@project-sites/shared';

// =============================================================================
// Environment Bindings
// =============================================================================

export interface Bindings {
  // KV Namespaces
  CACHE_KV: KVNamespace;

  // R2 Buckets
  SITES_BUCKET: R2Bucket;

  // Queues
  WORKFLOW_QUEUE: Queue;

  // Workflows
  SITE_GENERATION_WORKFLOW: Workflow;

  // Durable Objects
  RATE_LIMITER: DurableObjectNamespace;

  // Environment
  ENVIRONMENT: 'development' | 'test' | 'staging' | 'production';
  LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error';

  // Supabase
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;

  // Stripe
  STRIPE_SECRET_KEY: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;

  // Cloudflare
  CF_API_TOKEN: string;
  CF_ZONE_ID: string;
  CF_ACCOUNT_ID: string;

  // AI Providers
  OPENAI_API_KEY?: string;
  OPEN_ROUTER_API_KEY?: string;
  GROQ_API_KEY?: string;

  // Google
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_PLACES_API_KEY: string;

  // External Services
  SENDGRID_API_KEY: string;
  CHATWOOT_API_URL?: string;
  CHATWOOT_API_KEY?: string;
  NOVU_API_KEY?: string;

  // Observability
  SENTRY_DSN: string;

  // Sale Webhook
  SALE_WEBHOOK_URL?: string;
  SALE_WEBHOOK_SECRET?: string;

  // Feature Flags
  METERING_PROVIDER?: 'lago' | 'internal';
  ENABLE_POSTCARDS?: string;
}

// =============================================================================
// Variables (set by middleware)
// =============================================================================

export interface Variables {
  // Request context (always set)
  requestContext: RequestContext;

  // Auth context (set after authentication)
  auth?: AuthContext;

  // Org context (set after org resolution)
  org?: OrgContext;

  // For logging
  startTime: number;
}

// =============================================================================
// App Context
// =============================================================================

export interface AppContext {
  Bindings: Bindings;
  Variables: Variables;
}

// =============================================================================
// Context Type
// =============================================================================

export type Context = HonoContext<AppContext>;

// =============================================================================
// Workflow Types
// =============================================================================

interface Workflow {
  create(options: { id: string; params: unknown }): Promise<WorkflowInstance>;
  get(id: string): Promise<WorkflowInstance | null>;
}

interface WorkflowInstance {
  id: string;
  status: () => Promise<WorkflowStatus>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  terminate: () => Promise<void>;
  restart: () => Promise<void>;
}

interface WorkflowStatus {
  status: 'running' | 'paused' | 'complete' | 'errored' | 'terminated';
  output?: unknown;
  error?: string;
}

// =============================================================================
// API Response Types
// =============================================================================

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: {
    request_id: string;
    timestamp: string;
  };
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id?: string;
    trace_id?: string;
  };
}

// =============================================================================
// Site Lookup (for KV cache)
// =============================================================================

export interface SiteLookup {
  site_id: string;
  slug: string;
  r2_prefix: string;
  current_build_version: string | null;
  is_paid: boolean;
  org_id: string;
  ttl: number;
}
