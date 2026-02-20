/**
 * @module env
 * @description Cloudflare Worker environment bindings and Hono context variables.
 *
 * This module defines every secret, binding, and request-scoped variable used
 * by the Project Sites worker. Bindings are configured in `wrangler.toml`;
 * secrets are set via `wrangler secret put`.
 *
 * ## Binding Categories
 *
 * | Category    | Bindings                                  |
 * | ----------- | ----------------------------------------- |
 * | Storage     | `DB` (D1), `SITES_BUCKET` (R2)            |
 * | Cache       | `CACHE_KV`, `PROMPT_STORE` (KV)           |
 * | Compute     | `AI` (Workers AI), `QUEUE` (optional)     |
 * | Auth        | Google OAuth, Stripe, SendGrid            |
 * | Observ.     | PostHog, Sentry                           |
 * | Infra       | Cloudflare API (CF_API_TOKEN, CF_ZONE_ID) |
 *
 * @packageDocumentation
 */

/**
 * Cloudflare Worker environment bindings.
 *
 * All secrets and platform bindings injected by the Workers runtime.
 * Required bindings will cause a deploy-time error if missing;
 * optional ones (marked with `?`) degrade gracefully.
 *
 * @example
 * ```ts
 * // In a Hono route handler:
 * app.get('/api/example', async (c) => {
 *   const db = c.env.DB;        // D1Database
 *   const kv = c.env.CACHE_KV;  // KVNamespace
 *   const ai = c.env.AI;        // Ai
 * });
 * ```
 */
export interface Env {
  // ── KV Namespaces ──────────────────────────────────────────
  /** General-purpose cache (host→site resolution, etc.). TTL: 60 s. */
  CACHE_KV: KVNamespace;
  /** Prompt definition hot-fix store (overrides file-based prompts). */
  PROMPT_STORE: KVNamespace;

  // ── D1 Database ────────────────────────────────────────────
  /** Primary relational store (SQLite via Cloudflare D1). */
  DB: D1Database;

  // ── R2 Object Storage ─────────────────────────────────────
  /** Static site output bucket (`sites/{slug}/{version}/`, `marketing/`). */
  SITES_BUCKET: R2Bucket;

  // ── Queue (optional) ──────────────────────────────────────
  /** Background job queue. Optional until Queues is enabled on the account. */
  QUEUE?: Queue;

  // ── Workflow ─────────────────────────────────────────────
  /** Cloudflare Workflow binding for AI site generation. */
  SITE_WORKFLOW: Workflow;

  // ── Workers AI ────────────────────────────────────────────
  /** Cloudflare Workers AI binding for LLM inference. */
  AI: Ai;

  // ── Environment ───────────────────────────────────────────
  /** Current deployment environment (`"staging"` | `"production"`). */
  ENVIRONMENT: string;

  // ── PostHog (Analytics) ───────────────────────────────────
  /** PostHog project API key for server-side event capture. */
  POSTHOG_API_KEY: string;
  /** PostHog API host (defaults to `https://app.posthog.com`). */
  POSTHOG_HOST?: string;

  // ── Stripe (Payments) ─────────────────────────────────────
  /** Stripe secret key for server-side API calls. */
  STRIPE_SECRET_KEY: string;
  /** Stripe publishable key (passed to frontend checkout). */
  STRIPE_PUBLISHABLE_KEY: string;
  /** Stripe webhook endpoint signing secret for signature verification. */
  STRIPE_WEBHOOK_SECRET: string;

  // ── LLM Fallbacks (optional) ──────────────────────────────
  /** OpenAI API key for fallback LLM calls. */
  OPENAI_API_KEY?: string;
  /** OpenRouter API key for model routing. */
  OPEN_ROUTER_API_KEY?: string;
  /** Groq API key for fast inference fallback. */
  GROQ_API_KEY?: string;

  // ── Cloudflare API ────────────────────────────────────────
  /** Cloudflare API token for Custom Hostnames (Cloudflare for SaaS). */
  CF_API_TOKEN: string;
  /** Cloudflare zone ID for `megabyte.space`. */
  CF_ZONE_ID: string;

  // ── Email (Resend / SendGrid) ────────────────────────────
  /** Resend API key for transactional email. Preferred provider. */
  RESEND_API_KEY?: string;
  /** SendGrid v3 API key for transactional email. Fallback provider. */
  SENDGRID_API_KEY?: string;

  // ── Chatwoot (Support Chat) ───────────────────────────────
  /** Chatwoot instance API URL. */
  CHATWOOT_API_URL?: string;
  /** Chatwoot API key. */
  CHATWOOT_API_KEY?: string;

  // ── Novu (Notifications) ──────────────────────────────────
  /** Novu API key for multi-channel notifications. */
  NOVU_API_KEY?: string;

  // ── Google (OAuth + Places) ───────────────────────────────
  /** Google OAuth 2.0 client ID. */
  GOOGLE_CLIENT_ID: string;
  /** Google OAuth 2.0 client secret. */
  GOOGLE_CLIENT_SECRET: string;
  /** Google Places (new) API key for business search. */
  GOOGLE_PLACES_API_KEY: string;

  // ── Sentry (Error Tracking) ───────────────────────────────
  /** Sentry DSN for error reporting. */
  SENTRY_DSN?: string;

  // ── Sale Webhook ──────────────────────────────────────────
  /** External webhook URL called on successful subscription purchase. */
  SALE_WEBHOOK_URL?: string;
  /** HMAC secret for signing sale webhook payloads. */
  SALE_WEBHOOK_SECRET?: string;

  // ── Metering ──────────────────────────────────────────────
  /** Metering provider identifier (e.g. `"lago"`, `"stripe"`). */
  METERING_PROVIDER?: string;

  // ── Feature Flags ──────────────────────────────────────────
  /** When "true", research.json is publicly accessible at /api/sites/by-slug/:slug/research.json */
  RESEARCH_JSON_PUBLIC?: string;
}

/**
 * Hono context variables set by middleware and consumed by route handlers.
 *
 * These are request-scoped values attached via `c.set()` / `c.get()`.
 *
 * @example
 * ```ts
 * // In middleware:
 * c.set('requestId', crypto.randomUUID());
 *
 * // In route handler:
 * const rid = c.get('requestId');
 * ```
 */
export interface Variables {
  /** Unique request ID for distributed tracing (`X-Request-ID` header). */
  requestId: string;
  /** Authenticated user ID (set after session validation). */
  userId?: string;
  /** Organization ID the user belongs to. */
  orgId?: string;
  /** User's role within the org (`owner` | `admin` | `member` | `viewer`). */
  userRole?: string;
  /** Whether the user is a billing admin for their org. */
  billingAdmin?: boolean;
}
