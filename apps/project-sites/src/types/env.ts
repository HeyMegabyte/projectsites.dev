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

  /** Claude Code build container (Durable Object) */
  SITE_BUILDER?: DurableObjectNamespace;

  // ── Workers AI ────────────────────────────────────────────
  /** Cloudflare Workers AI binding for LLM inference. */
  AI: Ai;

  // ── Environment ───────────────────────────────────────────
  /** Current deployment environment (`"staging"` | `"production"`). */
  ENVIRONMENT: string;

  // ── Google Analytics & Tag Manager ────────────────────────
  /** GA4 Measurement ID (e.g., G-XXXXXXXX) injected into every served site. */
  GA4_MEASUREMENT_ID?: string;
  /** GTM Container ID (e.g., GTM-XXXXXXX) injected into every served site. */
  GTM_CONTAINER_ID?: string;
  /** Google Analytics Data API credentials (service account JSON, base64-encoded). */
  GA4_SERVICE_ACCOUNT_JSON?: string;
  /** GA4 Property ID for Data API queries (numeric, e.g., 123456789). */
  GA4_PROPERTY_ID?: string;

  // ── PostHog (Analytics) ───────────────────────────────────
  /** PostHog API key for server-side event capture (personal phx_* or project phc_*). */
  POSTHOG_API_KEY: string;
  /** PostHog public project key (phc_*) injected into served-site HTML. Required for client-side init. */
  POSTHOG_PUBLIC_KEY?: string;
  /** PostHog API host (defaults to `https://app.posthog.com`). */
  POSTHOG_HOST?: string;

  // ── Stripe (Payments) ─────────────────────────────────────
  /** Stripe secret key for server-side API calls. */
  STRIPE_SECRET_KEY: string;
  /** Stripe publishable key (passed to frontend checkout). */
  STRIPE_PUBLISHABLE_KEY: string;
  /** Stripe webhook endpoint signing secret for signature verification. */
  STRIPE_WEBHOOK_SECRET: string;

  // ── Domain & Conversion ────────────────────────────────────
  /** WhoisXML API key for domain availability checking. */
  WHOISXML_API_KEY?: string;
  /** GoDaddy API key for domain registration. */
  GODADDY_API_KEY?: string;
  /** GoDaddy API secret for domain registration. */
  GODADDY_API_SECRET?: string;

  // ── LLM Fallbacks (optional) ──────────────────────────────
  /** OpenAI API key for research pipeline and fallback LLM calls. */
  OPENAI_API_KEY?: string;
  /** Anthropic API key for Claude models in headless generation pipeline. */
  ANTHROPIC_API_KEY?: string;
  /** Model ID for the research/prompt-formulation pipeline (default: o3-mini). */
  RESEARCH_MODEL?: string;
  /** OpenRouter API key for model routing. */
  OPEN_ROUTER_API_KEY?: string;
  /** Groq API key for fast inference fallback. */
  GROQ_API_KEY?: string;

  // ── Headless Pipeline Config ────────────────────────────────
  /** A/B model split ratio (0-1). 0.5 = 50% OpenAI, 50% Anthropic. Default: 0.5. */
  AB_MODEL_SPLIT?: string;
  /** Template cache TTL in seconds. Default: 604800 (7 days). */
  TEMPLATE_CACHE_TTL?: string;

  // ── Image Generation & Discovery ──────────────────────────
  /** Google Custom Search API key for image discovery. */
  GOOGLE_CSE_KEY?: string;
  /** Google Custom Search Engine ID for image discovery. */
  GOOGLE_CSE_CX?: string;
  /** Maximum number of AI-generated images per site (default: 5). */
  MAX_GENERATED_IMAGES?: string;

  // ── Media Discovery & Generation APIs ───────────────────────
  /** YouTube Data API v3 key for video search/discovery. */
  YOUTUBE_API_KEY?: string;
  /** Pexels API key for royalty-free stock photos + video. */
  PEXELS_API_KEY?: string;
  /** Pixabay API key for royalty-free images + video + illustrations. */
  PIXABAY_API_KEY?: string;
  /** Unsplash API access key for high-quality royalty-free photos. */
  UNSPLASH_ACCESS_KEY?: string;
  /** Ideogram API key for AI image/logo generation. */
  IDEOGRAM_API_KEY?: string;
  /** Replicate API token for Stable Diffusion, image upscaling, bg removal. */
  REPLICATE_API_TOKEN?: string;
  /** Runway API key for AI video generation (Gen-2/Gen-3). */
  RUNWAY_API_KEY?: string;

  // ── Business Data APIs ────────────────────────────────────
  /** Foursquare API key for venue photos, tips, and categories. */
  FOURSQUARE_API_KEY?: string;
  /** Yelp Fusion API key for reviews, ratings, and photos. */
  YELP_API_KEY?: string;
  /** Google Maps embed API key. */
  GOOGLE_MAPS_API_KEY?: string;

  // ── Image Optimization & Maps ─────────────────────────────
  /** Cloudinary cloud name for image transformation CDN. */
  CLOUDINARY_CLOUD_NAME?: string;
  /** Cloudinary API key for upload/transform. */
  CLOUDINARY_API_KEY?: string;
  /** Cloudinary API secret for signed requests. */
  CLOUDINARY_API_SECRET?: string;
  /** Mapbox access token for custom styled interactive maps. */
  MAPBOX_ACCESS_TOKEN?: string;

  // ── Brand Discovery APIs ──────────────────────────────────
  /** Logo.dev API token for high-res company logos by domain. */
  LOGODEV_TOKEN?: string;
  /** Brandfetch API key for full brand kits (logo, colors, fonts) by domain. */
  BRANDFETCH_API_KEY?: string;

  // ── Reviews & Trust APIs ──────────────────────────────────
  /** TripAdvisor Content API key for hospitality reviews/ratings. */
  TRIPADVISOR_API_KEY?: string;
  /** Trustpilot API key for business trust scores and reviews. */
  TRUSTPILOT_API_KEY?: string;

  // ── Generative AI APIs ────────────────────────────────────
  /** ElevenLabs API key for AI voiceover generation. */
  ELEVENLABS_API_KEY?: string;
  /** Stability AI API key for Stable Diffusion image generation. */
  STABILITY_API_KEY?: string;
  /** Remove.bg API key for background removal from product/logo images. */
  REMOVEBG_API_KEY?: string;

  // ── Animation & UX ────────────────────────────────────────
  /** LottieFiles API key for animated illustrations per business category. */
  LOTTIEFILES_API_KEY?: string;

  // ── SEO & Quality Gates ───────────────────────────────────
  /** Google PageSpeed Insights API key (can reuse GOOGLE_MAPS_API_KEY). */
  PAGESPEED_API_KEY?: string;
  /** GTmetrix API key for real performance scoring. */
  GTMETRIX_API_KEY?: string;

  // ── Contact & Location ────────────────────────────────────
  /** Hunter.io API key for discovering business email patterns. */
  HUNTER_API_KEY?: string;
  /** What3Words API key for precise location addressing. */
  WHAT3WORDS_API_KEY?: string;
  /** Abstract API key for geolocation (timezone, currency). */
  ABSTRACT_GEO_API_KEY?: string;

  // ── Analytics Embeds ──────────────────────────────────────
  /** Microsoft Clarity project ID for free heatmaps/session recordings. */
  CLARITY_PROJECT_ID?: string;
  /** Plausible Analytics domain for privacy-friendly analytics. */
  PLAUSIBLE_DOMAIN?: string;

  // ── Cloudflare API ────────────────────────────────────────
  /** Cloudflare API token for Custom Hostnames (Cloudflare for SaaS). */
  CF_API_TOKEN: string;
  /** Cloudflare zone ID for `projectsites.dev`. */
  CF_ZONE_ID: string;
  /** Cloudflare Access Service Token client ID (bypasses bot protection for container builds). */
  CF_ACCESS_CLIENT_ID?: string;
  /** Cloudflare Access Service Token client secret. */
  CF_ACCESS_CLIENT_SECRET?: string;
  /** HMAC secret for container→worker build status callbacks. */
  INTERNAL_BUILD_SECRET?: string;
  /** Override callback URL (workers.dev) to bypass zone CF managed challenge. */
  INTERNAL_CALLBACK_URL?: string;

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

  // ── GitHub (OAuth) ─────────────────────────────────────────
  /** GitHub OAuth App client ID. */
  GITHUB_CLIENT_ID?: string;
  /** GitHub OAuth App client secret. */
  GITHUB_CLIENT_SECRET?: string;

  // ── Google (OAuth + Places + Sheets) ──────────────────────
  /** Google OAuth 2.0 client ID. */
  GOOGLE_CLIENT_ID: string;
  /** Google OAuth 2.0 client secret. */
  GOOGLE_CLIENT_SECRET: string;
  /** Google Places (new) API key for business search. */
  GOOGLE_PLACES_API_KEY: string;
  /** Google Sheets API key for spreadsheet data sources. Falls back to GOOGLE_PLACES_API_KEY. */
  GOOGLE_SHEETS_API_KEY?: string;

  // ── Sentry (Error Tracking) ───────────────────────────────
  /** Sentry DSN for error reporting. */
  SENTRY_DSN?: string;

  // ── Domain Registration (OpenSRS + Domainr) ─────────────────
  /** Domainr (Mashape/RapidAPI) API key for domain search & pricing. */
  DOMAINR_API_KEY?: string;
  /** OpenSRS reseller username for domain registration. */
  OPENSRS_USERNAME?: string;
  /** OpenSRS private API key for domain registration. */
  OPENSRS_API_KEY?: string;
  /** OpenSRS API environment: 'live' or 'test'. Defaults to 'test'. */
  OPENSRS_ENV?: string;

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
