# Project Sites — Converged Build Guide

> **Purpose**: This document is a single-prompt reconstruction guide for the entire
> Project Sites product. It merges every requirement, architectural decision, and
> technical specification from all prior sessions into one authoritative reference.
> An AI agent given only this file should be able to rebuild the project from scratch.

---

## Table of Contents

1. [Vision & North Star](#1-vision--north-star)
2. [Architecture Overview](#2-architecture-overview)
3. [Monorepo Structure](#3-monorepo-structure)
4. [Data Model & D1 Schema](#4-data-model--d1-schema)
5. [Authentication](#5-authentication)
6. [Homepage SPA](#6-homepage-spa)
7. [Search & Site Lookup API](#7-search--site-lookup-api)
8. [AI Workflow & Prompt Infrastructure](#8-ai-workflow--prompt-infrastructure)
9. [Site Serving & Domain Routing](#9-site-serving--domain-routing)
10. [Billing & Stripe Integration](#10-billing--stripe-integration)
11. [Security & CSP](#11-security--csp)
12. [Observability & Analytics](#12-observability--analytics)
13. [RBAC & Entitlements](#13-rbac--entitlements)
14. [Testing Strategy](#14-testing-strategy)
15. [Deployment & CI/CD](#15-deployment--cicd)
16. [Brand, Copy & Design](#16-brand-copy--design)
17. [Constants, Caps & Limits](#17-constants-caps--limits)
18. [Credentials & Environment Variables](#18-credentials--environment-variables)
19. [Known Bugs & Fixes](#19-known-bugs--fixes)
20. [Future / Not Yet Implemented](#20-future--not-yet-implemented)

---

## 1. Vision & North Star

**We don't sell websites. We deliver them.**

Project Sites is a SaaS website delivery engine. A small-business owner searches
for their business, signs in, and receives a professionally built, AI-generated
website in under 15 minutes — hosted, SSL'd, and live on a stable URL.

### Golden Path (Single User Flow)

```
Search for business → Select from Google Places → Sign In (Google / Phone / Email)
→ Provide additional details + upload logo/images → Click "Build My Website"
→ AI researches business online → AI generates full website → Site published to R2
→ Live at {slug}-sites.megabyte.space → Optional: pay $50/mo to remove top bar + custom domain
```

### Key Principles

1. **Cloudflare Workers are the only first-party public ingress and API gateway**
2. Write the data model first — every table has `org_id`, `created_at`, `updated_at`, `deleted_at`
3. Every mutation is idempotent (webhooks, publish jobs, domain provisioning)
4. One event source per thing — webhook OR queue job OR DB row change, never two
5. Job state machine: `queued → running → success | failed` with bounded retries
6. Rollback story — versioned publishes, `sites.current_build_version` controls serving
7. Instrumentation from day 1 — structured logs + request IDs propagated everywhere
8. Treat all user/web/LLM data as hostile — Zod validate everything
9. Test-Driven Development — write tests first, 10+ cases per requirement
10. Implement one vertical slice end-to-end before branching out

---

## 2. Architecture Overview

### Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Ingress / API** | Cloudflare Workers + Hono | Public API gateway, HTML injection, routing |
| **Database** | Cloudflare D1 (SQLite) | System-of-record (migrated from Supabase Postgres) |
| **Cache** | Cloudflare KV | `host:<hostname>` resolution (60s TTL), prompt hot-patching |
| **Object Storage** | Cloudflare R2 | Static site output (`sites/{slug}/{version}/`), marketing assets |
| **Background Jobs** | Cloudflare Queues | AI research, generation, builds, provisioning, retries |
| **AI Inference** | Cloudflare Workers AI | LLM calls (`@cf/meta/llama-3.1-8b-instruct`, `@cf/meta/llama-3.1-70b-instruct`) |
| **Payments** | Stripe | Checkout (Link-optimized), subscriptions, webhooks |
| **Email** | SendGrid v3 API | Magic links, transactional email |
| **Analytics** | PostHog (server-side) | Funnel events, user identification |
| **Error Tracking** | Sentry (HTTP API, no SDK) | Exception capture with request_id correlation |
| **Framework** | Hono | Typed middleware, routing, context variables |

### Request Flow

```
Client → Cloudflare Edge → Worker
  ├── requestIdMiddleware (X-Request-ID)
  ├── payloadLimitMiddleware (256KB max)
  ├── securityHeadersMiddleware (CSP, HSTS, X-Frame-Options)
  ├── CORS (API routes only)
  ├── authMiddleware (Bearer token → session → userId/orgId)
  ├── errorHandler (catch + format as JSON)
  ├── /health → health check
  ├── /api/* → authenticated API routes
  ├── /api/search/* → search routes (some public)
  ├── /webhooks/* → Stripe webhooks
  └── * → site serving (marketing homepage or subdomain sites)
```

### Key Architecture Decisions

- **No Supabase JS client** — D1 via parameterized SQL for Workers compatibility
- **Dash-based subdomains** — `{slug}-sites.megabyte.space` (not nested wildcards)
- **R2 paths** — `sites/{slug}/{version}/{file}`, marketing at `marketing/index.html`
- **Top bar injection** — injected after `<body>` tag for unpaid sites
- **Vanilla JS homepage** — no framework, state machine, CDN-only dependencies
- **Queues optional** — `QUEUE` binding is `Queue | undefined` in Env type

---

## 3. Monorepo Structure

```
bolt.diy/                          # Root (Cloudflare Pages → bolt.megabyte.space)
├── apps/
│   └── project-sites/             # Cloudflare Worker → sites.megabyte.space
│       ├── src/
│       │   ├── index.ts           # Hono app, middleware stack, route mounts
│       │   ├── types/env.ts       # Env bindings + Variables interface
│       │   ├── middleware/
│       │   │   ├── auth.ts        # Bearer token → session → userId/orgId
│       │   │   ├── error_handler.ts
│       │   │   ├── payload_limit.ts
│       │   │   ├── request_id.ts
│       │   │   └── security_headers.ts
│       │   ├── routes/
│       │   │   ├── api.ts         # Auth, sites, billing, hostnames, audit
│       │   │   ├── health.ts      # /health endpoint
│       │   │   ├── search.ts      # Business search, site lookup, create-from-search
│       │   │   └── webhooks.ts    # Stripe webhook handler
│       │   ├── services/
│       │   │   ├── ai_workflows.ts # V2 multi-phase AI pipeline
│       │   │   ├── analytics.ts   # PostHog event capture
│       │   │   ├── audit.ts       # Append-only audit logging
│       │   │   ├── auth.ts        # Magic link, phone OTP, Google OAuth, sessions
│       │   │   ├── billing.ts     # Stripe checkout, subscriptions, entitlements
│       │   │   ├── db.ts          # D1 query helpers (dbQuery, dbInsert, etc.)
│       │   │   ├── domains.ts     # CF for SaaS custom hostnames
│       │   │   ├── sentry.ts      # Error tracking via HTTP API
│       │   │   ├── site_serving.ts # R2 static file serving + top bar injection
│       │   │   └── webhook.ts     # Signature verification, idempotency
│       │   └── prompts/
│       │       ├── index.ts       # Registry initialization
│       │       ├── types.ts       # PromptSpec, PromptKey, etc.
│       │       ├── parser.ts      # YAML frontmatter + section parser
│       │       ├── renderer.ts    # Template rendering with injection prevention
│       │       ├── schemas.ts     # Zod schemas for prompt I/O
│       │       ├── observability.ts # SHA-256 hashing, logging, cost estimation
│       │       └── registry.ts    # Version resolution, A/B variants, KV hot-patching
│       ├── prompts/               # .prompt.md files (Git source of truth)
│       ├── public/
│       │   └── index.html         # Marketing homepage SPA (vanilla JS)
│       ├── e2e/                   # Playwright E2E tests
│       │   ├── golden-path.spec.ts # Full user journey (10 tests)
│       │   ├── homepage.spec.ts   # Homepage sections + auth screens (28 tests)
│       │   ├── health.spec.ts     # Health, CORS, auth gates (15 tests)
│       │   └── site-serving.spec.ts # Serving, security, webhooks (13 tests)
│       ├── scripts/
│       │   └── e2e_server.cjs     # Local Playwright test server
│       ├── wrangler.toml          # Worker config (dev/staging/production)
│       ├── playwright.config.ts
│       ├── jest.config.cjs
│       └── tsconfig.json
├── packages/
│   └── shared/                    # @project-sites/shared
│       └── src/
│           ├── schemas/           # Zod schemas (org, site, billing, auth, etc.)
│           ├── middleware/         # RBAC + entitlements
│           ├── utils/             # errors, crypto, sanitize, redact
│           └── constants/         # DOMAINS, AUTH, PRICING, CAPS, ENTITLEMENTS
├── supabase/
│   └── migrations/
│       └── 00001_initial_schema.sql  # Reference Postgres schema (D1 equivalent)
└── .github/
    └── workflows/
        └── project-sites.yaml    # CI/CD pipeline
```

---

## 4. Data Model & D1 Schema

### Tables (16 total)

Every table has `id` (UUID text), `created_at`, `updated_at`, `deleted_at` (soft delete).
Org-scoped tables include `org_id` for multi-tenant isolation.

| Table | Key Columns | Purpose |
|-------|------------|---------|
| `orgs` | name, slug | Multi-tenant organizations |
| `users` | email, phone, display_name, avatar_url | User accounts |
| `memberships` | org_id, user_id, role, billing_admin | Org↔User mapping |
| `sites` | org_id, slug, business_name, business_phone, business_email, business_address, google_place_id, bolt_chat_id, current_build_version, status | Website records |
| `hostnames` | org_id, site_id, hostname, type, status, cf_custom_hostname_id, ssl_status | Domain mapping |
| `subscriptions` | org_id, stripe_customer_id, stripe_subscription_id, plan, status, cancel_at_period_end, dunning_stage | Billing state |
| `sessions` | user_id, token_hash, device_info, ip_address, expires_at, last_active_at | Auth sessions |
| `magic_links` | email, token_hash, redirect_url, expires_at, used | Email auth |
| `phone_otps` | phone, otp_hash, attempts, expires_at, verified | Phone auth |
| `oauth_states` | state, provider, redirect_url, expires_at | OAuth CSRF |
| `webhook_events` | org_id, provider, event_id, event_type, status, payload_pointer, payload_hash | Webhook dedup |
| `audit_logs` | org_id, actor_id, action, target_type, target_id, metadata_json | Append-only audit |
| `workflow_jobs` | org_id, site_id, job_name, dedupe_key, status, attempt, max_attempts | Background jobs |
| `research_data` | org_id, site_id, task_name, raw_output, parsed_output, confidence | AI research cache |
| `confidence_attributes` | org_id, site_id, attribute_name, attribute_value, confidence, source | AI confidence |
| `analytics_daily` | org_id, site_id, date, page_views, unique_visitors, bandwidth_bytes | Daily rollups |

### Site Status Values

`draft` → `building` → `published` | `archived`

### D1 Query Helpers (`src/services/db.ts`)

```typescript
dbQuery<T>(db, sql, params)     // SELECT multiple rows → { data: T[] }
dbQueryOne<T>(db, sql, params)  // SELECT single row → T | null
dbInsert(db, table, record)     // INSERT with auto timestamps → { error }
dbUpdate(db, table, updates, where, params) // UPDATE with auto updated_at → { error, changes }
dbExecute(db, sql, params)      // Raw execute → { error, changes }
```

### D1 SQLite Differences from Postgres

- `TEXT` instead of `UUID`, `TIMESTAMPTZ`
- `INTEGER` 0/1 instead of `BOOLEAN`
- `TEXT` instead of `JSONB` (stored as JSON strings)
- No `gen_random_uuid()` — use `crypto.randomUUID()` in JS
- No `now()` — use `new Date().toISOString()` in JS
- `?` parameter placeholders (not `$1, $2`)

---

## 5. Authentication

### Three Sign-In Methods

| Method | Flow | Table |
|--------|------|-------|
| **Magic Link** | Email → click link → verify token hash → session | `magic_links` |
| **Phone OTP** | SMS → enter 6-digit code → verify OTP hash → session | `phone_otps` |
| **Google OAuth** | Redirect → consent → exchange code → user info → session | `oauth_states` |

### Auth Constants

```typescript
export const AUTH = {
  MAGIC_LINK_EXPIRY_HOURS: 24,
  OTP_EXPIRY_MINUTES: 5,
  OTP_LENGTH: 6,
  OTP_MAX_ATTEMPTS: 3,
  SESSION_EXPIRY_DAYS: 30,
} as const;
```

### Auth Functions (`src/services/auth.ts`)

| Function | Purpose |
|----------|---------|
| `createMagicLink(db, env, { email })` | Generate token, store hash, send email via SendGrid |
| `verifyMagicLink(db, { token })` | Hash token, look up, check expiry, mark used, return email |
| `createPhoneOtp(db, env, { phone })` | Rate-limit, generate 6-digit OTP, store hash |
| `verifyPhoneOtp(db, { phone, otp })` | Hash OTP, find matching record, check attempts, verify |
| `createGoogleOAuthState(db, env, redirectUrl?)` | Generate state token, store in DB, return Google consent URL |
| `handleGoogleOAuthCallback(db, env, code, state)` | Validate state, exchange code for tokens, fetch user info |
| `findOrCreateUser(db, { email?, phone?, display_name?, avatar_url? })` | Upsert user + auto-provision org + membership |
| `createSession(db, userId)` | Generate token, store hash, return plaintext token + expiry |
| `getSession(db, token)` | Validate token, check expiry, bump last_active_at |
| `revokeSession(db, sessionId)` | Soft-delete session |
| `getUserSessions(db, userId)` | List active sessions |

### Auth Middleware (`src/middleware/auth.ts`)

- Checks `Authorization: Bearer <token>` header
- If valid, sets `c.set('userId')` and `c.set('orgId')` via membership lookup
- Does NOT reject unauthenticated requests — routes decide individually
- Mounted on `/api/*` routes

### Route Behavior After Auth

- **Phone OTP verify**: Creates user/org via `findOrCreateUser`, creates session, returns `{ token, user_id, org_id }`
- **Magic link verify**: Creates user/org, creates session, redirects to `redirect_url?token=xxx&email=xxx`
- **Google OAuth callback**: Creates user/org, creates session, redirects to homepage with `?token=xxx&email=xxx`

---

## 6. Homepage SPA

### Overview

Single-page application at `sites.megabyte.space` (`public/index.html`).
Vanilla JavaScript with CSS custom properties. No framework.
Served from R2 at `marketing/index.html`.

### 4 Screens (State Machine)

```
search → signin → details → waiting
```

### Screen 1: Hero + Search

- Dark theme: `#0a0a1a` background, `#64ffda` accent cyan, `#7c3aed` secondary purple
- Logo: "Project Sites" with gradient text
- Tagline: "Your website — handled. Finally."
- Search input: `placeholder="Search for your business..."`, `max-width: 640px`
- 300ms debounced search, minimum 2 characters
- Parallel API calls: `GET /api/search/businesses?q=...` + `GET /api/sites/search?q=...`
- Dropdown results:
  - Pre-built sites first (green checkmark, "PRE-BUILT" badge)
  - Google Places results (**Business Name** bold, *address* gray italic)
  - "Custom Website" option at bottom (paintbrush icon)
- On business select: `GET /api/sites/lookup?place_id=...` to check existence
  - If published: redirect to `https://{slug}-sites.megabyte.space`
  - If building/queued: show waiting screen
  - If new: show sign-in screen

### Screen 2: Sign-In

- Title: "Sign in to claim your website"
- Three buttons:
  1. **Continue with Google** → `GET /api/auth/google?redirect_url=currentUrl`
  2. **Sign in with Phone** → phone input → `POST /api/auth/phone/otp` → OTP input → `POST /api/auth/phone/verify`
  3. **Sign in with Email** → email input → `POST /api/auth/magic-link` → "Check your email" message
- After successful auth, store `{ token, identifier }` in `state.session`
- Transition to details screen

### Screen 3: Details + File Upload

- Title: "Tell us more about your business" (or "Describe your custom website" for custom mode)
- Business badge showing selected business name + address
- Large textarea for additional context / special instructions
- **Uppy file upload widget** (CDN: `https://releases.transloadit.com/uppy/v4.12.1/`)
  - Accept: images (jpg, png, svg, webp) + PDFs
  - Max file size: 10MB each
  - Max files: 5
- "Build My Website" button
- On submit: `POST /api/sites/create-from-search` with `Authorization: Bearer <token>`
- Payload format (nested v2):
  ```json
  {
    "mode": "business",
    "additional_context": "...",
    "business": {
      "name": "Vito's Mens Salon",
      "address": "74 N Beverwyck Rd, Lake Hiawatha, NJ 07034",
      "place_id": "ChIJ_xxx",
      "phone": "+19735551234",
      "types": ["hair_care", "beauty_salon"]
    }
  }
  ```

### Screen 4: Waiting

- Lottie animation: `https://lottie.host/2df87dd4-2471-465b-a31e-149686ec3bf6/wIvr2K9MtC.lottie`
- "We're building your website..." (large)
- "Give us a few minutes... We'll notify you." (smaller)
- Shows email/phone used to sign in
- Status dot animation (pulsing green) + "Build in progress" text
- Polls `GET /api/sites/{site_id}` every 10 seconds
- When status = `published`: redirect to `https://{slug}-sites.megabyte.space`

### Marketing Sections (below hero, scrollable)

1. **How It Works** — 3 step cards:
   - Step 1: "Tell Us About Your Business" (search icon)
   - Step 2: "AI Builds Your Site" (wand icon)
   - Step 3: "Go Live" (rocket icon)

2. **Features** — 4 selling-point cards (3-column grid, last card centered):
   - AI-Generated Content
   - Custom Domains
   - Mobile-First Design
   - Built-in Analytics

3. **Competitor Comparison** — CSS table:
   | Feature | Project Sites | Squarespace | Wix | WordPress |
   |---------|:---:|:---:|:---:|:---:|
   | Price | $50/mo | $16-49/mo | $17-159/mo | $4-45/mo |
   | Setup Time | ~15 min | Hours-Days | Hours-Days | Days-Weeks |
   | AI Content | Full | Partial | Partial | No |
   | Custom Domain | Included | Included | Included | Extra |
   | SSL | Included | Included | Included | Manual |
   | Maintenance | Handled | Self | Self | Self |

4. **Pricing** — `$50/mo` card with features:
   - AI-generated website
   - Custom domain included
   - SSL certificate
   - Monthly updates
   - Priority support
   - Cancel anytime
   - CTA button: "Get Started"

### Footer

- **Links**: Privacy Policy → `https://megabyte.space/privacy`, Terms of Service → `https://megabyte.space/terms`, Contact → `mailto:hey@megabyte.space`
- **Social icons** (SVG): GitHub (@HeyMegabyte), X (@HeyMegabyte), LinkedIn (blzalewski), YouTube (@HeyMegabyte), Instagram (heymegabyteofficial), Facebook (HeyMegabyte)
- **Copyright**: © 2025 Megabyte LLC
- **Attribution**: Powered by Cloudflare

### CDN Dependencies

- Uppy: `https://releases.transloadit.com/uppy/v4.12.1/uppy.min.mjs` + CSS
- Lottie Player: `https://unpkg.com/@dotlottie/player-component@2.7.12/dist/dotlottie-player.mjs`
- Google Fonts: Inter (300, 400, 500, 600, 700)

---

## 7. Search & Site Lookup API

### Endpoints (`src/routes/search.ts`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/search/businesses?q=...` | Public | Google Places Text Search proxy (max 10 results) |
| `GET` | `/api/sites/search?q=...` | Public | Pre-built site search (LIKE on business_name) |
| `GET` | `/api/sites/lookup?place_id=...&slug=...` | Public | Check if site exists, return status |
| `POST` | `/api/sites/create-from-search` | Required | Create site + enqueue AI workflow |

### Google Places Integration

```typescript
// Proxy to Google Places Text Search (New) API
const placesResponse = await fetch('https://places.googleapis.com/v1/places:searchText', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.types',
  },
  body: JSON.stringify({ textQuery: query, maxResultCount: 10 }),
});
```

### Create-from-Search Payload (Dual Format)

Accepts both flat (v1) and nested (v2) payloads:

```typescript
// v1 (flat): { business_name, business_address, google_place_id, additional_context }
// v2 (nested): { mode, business: { name, address, place_id, phone }, additional_context }
const businessName = body.business?.name || body.business_name;
const googlePlaceId = body.business?.place_id || body.google_place_id;
```

Creates site with `status: 'building'`, enqueues to `QUEUE` (if enabled), writes audit log.

---

## 8. AI Workflow & Prompt Infrastructure

### Prompt File Format (`.prompt.md`)

```markdown
---
id: research_profile
version: 1
model: "@cf/meta/llama-3.1-70b-instruct"
max_tokens: 4096
temperature: 0.3
input_schema: ResearchProfileInput
output_schema: ResearchProfileOutput
---

# System
You are a business research analyst...

# User
Research the following business: <<<USER_INPUT>>>{{businessName}}<<<END_USER_INPUT>>>
```

### Prompt Registry

- Key format: `promptId@version` (e.g., `research_profile@1`)
- A/B variants: `configureVariants("site_copy", 3, { a: 80, b: 20 })`
- Deterministic bucketing: `simpleHash(seed + id + version) % 100`
- KV hot-patching: `loadFromKv()` reads `prompt:{id}@{version}` from PROMPT_STORE

### AI Workflow V2 Pipeline (`src/services/ai_workflows.ts`)

```
Phase 1 (Sequential):  runResearchProfile()        → business_type needed for other phases
Phase 2 (Parallel):    runResearchSocial()          → social media links + confidence
                       runResearchBrand()           → logo, colors, fonts, personality
                       runResearchSellingPoints()   → top 3 USPs + hero content
                       runResearchImages()          → image needs + search strategies
Phase 3 (Sequential):  runGenerateWebsite()         → full HTML from all research data
Phase 4 (Parallel):    runGenerateLegalPage('privacy') → privacy policy HTML
                       runGenerateLegalPage('terms')   → terms of service HTML
                       runScoreWebsite()              → 8-dimension quality scoring
```

### 13 Prompt Files

| File | Version | Purpose |
|------|---------|---------|
| `research_business.prompt.md` | v2 | Legacy business research |
| `generate_site.prompt.md` | v2 | Legacy site generation |
| `score_quality.prompt.md` | v2 | Legacy quality scoring |
| `site_copy.prompt.md` | v3a | Marketing copy (variant A: features-led) |
| `site_copy_v3b.prompt.md` | v3b | Marketing copy (variant B: benefit-led) |
| `research_profile.prompt.md` | v1 | Deep business profile research |
| `research_social.prompt.md` | v1 | Social media discovery with confidence |
| `research_brand.prompt.md` | v1 | Logo, colors, fonts, personality |
| `research_selling_points.prompt.md` | v1 | 3 USPs + hero slogans |
| `research_images.prompt.md` | v1 | Image needs and strategies |
| `generate_website.prompt.md` | v1 | Full website from research data |
| `generate_legal_pages.prompt.md` | v1 | Privacy/terms from templates |
| `score_website.prompt.md` | v1 | 8-dimension quality scoring |

### Generated Website Requirements

1. Hero image carousel with clever copy/slogans and CTAs
2. Footer with `/privacy` and `/terms` links (from install.doctor templates)
3. Google Maps full-width section with marker at business address
4. About section with mission statement from online research
5. Top 3 selling points with icons/images
6. Services section if applicable
7. Contact form / message submission form
8. Social media icon links
9. Logo detection (90%+ confidence) with fallback generation
10. Public image discovery (90%+ confidence)

### Queue Consumer (`index.ts`)

- Processes `generate_site` jobs from QUEUE
- Runs `runSiteGenerationWorkflowV2()`
- Uploads to R2: `sites/{slug}/{version}/index.html`, `privacy.html`, `terms.html`, `research.json`
- Updates site: `status: 'published'`, `current_build_version: version`

### Sample Business for Testing

**Vito's Mens Salon** — 74 N Beverwyck Rd, Lake Hiawatha, NJ 07034

---

## 9. Site Serving & Domain Routing

### Subdomain Pattern

```
{slug}-sites.megabyte.space        # Production customer sites
{slug}-sites-staging.megabyte.space # Staging customer sites
sites.megabyte.space               # Marketing homepage
sites-staging.megabyte.space       # Staging marketing homepage
```

### Domain Constants

```typescript
export const DOMAINS = {
  SITES_BASE: 'sites.megabyte.space',
  SITES_STAGING: 'sites-staging.megabyte.space',
  SITES_SUFFIX: '-sites.megabyte.space',
  SITES_STAGING_SUFFIX: '-sites-staging.megabyte.space',
  BOLT_BASE: 'bolt.megabyte.space',
  BOLT_STAGING: 'bolt-staging.megabyte.space',
  CLAIM_BASE: 'claimyour.site',
} as const;
```

### Resolution Flow (`src/services/site_serving.ts`)

```
1. Is hostname the base domain? → Serve marketing/index.html from R2
2. Extract slug from hostname (e.g., "vitos-salon" from "vitos-salon-sites.megabyte.space")
3. Check KV cache: `host:{hostname}` → site record (60s TTL)
4. If cache miss: query D1 hostnames table → sites table → subscription
5. Build site context: { slug, version, orgId, isPaid }
6. Serve from R2: sites/{slug}/{version}/{path}
7. If unpaid: inject top bar after <body> tag
```

### R2 Bucket Layout

```
project-sites-production/
├── marketing/
│   └── index.html              # Homepage SPA
└── sites/
    └── {slug}/
        └── {version}/
            ├── index.html      # Main site page
            ├── privacy.html    # Privacy policy
            ├── terms.html      # Terms of service
            └── research.json   # AI research data (for rebuilds)
```

---

## 10. Billing & Stripe Integration

### Pricing

| Tier | Price | Features |
|------|-------|----------|
| **Free** | $0 | Site at `{slug}-sites.megabyte.space`, top bar visible, 0 custom domains |
| **Paid** | $50/mo | Top bar hidden, up to 5 custom domains, priority support |
| **Retention** | $25/mo (12mo) | Same as paid, offered on cancellation |

### Dunning Schedule

| Days Past Due | Action |
|--------------|--------|
| 7 | Email reminder |
| 14 | Email reminder |
| 30 | Email reminder |
| 60 | Downgrade to free (top bar returns) |

### Stripe Functions (`src/services/billing.ts`)

| Function | Purpose |
|----------|---------|
| `getOrCreateStripeCustomer(db, env, orgId, email)` | Find or create Stripe customer |
| `createCheckoutSession(db, env, opts)` | Stripe Checkout (Link-optimized) |
| `handleCheckoutCompleted(db, event)` | Process successful checkout |
| `handleSubscriptionUpdated(db, event)` | Sync subscription changes |
| `handleSubscriptionDeleted(db, event)` | Handle cancellation |
| `handlePaymentFailed(db, event)` | Increment dunning stage |
| `getOrgSubscription(db, orgId)` | Get current subscription |
| `getOrgEntitlements(db, orgId)` | Derive entitlements from subscription |
| `createBillingPortalSession(db, env, orgId)` | Stripe billing portal |

### Entitlements

```typescript
// Derived from subscription status
{
  topBarHidden: boolean,     // true if plan === 'paid' && status === 'active'
  customDomains: number,     // 0 (free) or 5 (paid)
  prioritySupport: boolean,
}
```

### Webhook Processing (`src/routes/webhooks.ts`)

- Signature verification via Web Crypto API (`hmacSha256`)
- Idempotency: check `webhook_events` table by `(provider, event_id)` before processing
- Handled events: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- Sale webhook: external notification on successful purchase

---

## 11. Security & CSP

### Content Security Policy

```
default-src 'self';
script-src 'self' 'unsafe-inline' https://js.stripe.com;
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://releases.transloadit.com;
font-src 'self' https://fonts.gstatic.com;
img-src 'self' data: https: blob:;
connect-src 'self' https://releases.transloadit.com https://lottie.host https://*.posthog.com;
frame-src https://js.stripe.com;
worker-src 'self' blob:;
```

Note: `'unsafe-inline'` is required because the homepage uses inline `<script>` tags.

### Other Security Headers

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=()
```

### Input Validation

- All request bodies validated with Zod schemas
- `safeStringSchema` blocks `<script`, `javascript:`, `data:` patterns
- `slugSchema`: 3-63 chars, `[a-z0-9][a-z0-9-]*[a-z0-9]`
- `emailSchema`: max 254 chars, `toLowerCase()` normalization
- `phoneSchema`: E.164 format (`^\+[1-9]\d{1,14}$`)
- `httpsUrlSchema`: HTTPS only, max 2048 chars
- Max request payload: 256KB

### Webhook Security

- HMAC-SHA256 signature verification for Stripe
- Timestamp tolerance (5 minute window)
- Idempotency via `(provider, event_id)` unique constraint
- Payload hash stored for replay detection

---

## 12. Observability & Analytics

### Structured Logging

```typescript
console.warn(JSON.stringify({
  level: 'info' | 'warn' | 'error' | 'debug',
  service: 'auth' | 'billing' | 'queue' | 'search' | ...,
  message: 'Human-readable description',
  request_id: 'uuid',
  // ... additional context
}));
```

Note: `console.log` is blocked by ESLint — always use `console.warn`.

### PostHog Integration (`src/services/analytics.ts`)

- Key: `phx_gcMZl7NNiopayxo6i2mvKuzwCiWNdubhesffl3NxR35zpxa`
- Host: `https://us.i.posthog.com`
- Functions: `captureEvent`, `capturePageView`, `identifyUser`, `captureFunnelEvent`

### Sentry Integration (`src/services/sentry.ts`)

- HTTP API only (no SDK, Workers-compatible)
- `captureException(env, error, context)`
- `captureMessage(env, message, level, context)`
- Includes `request_id`, `server_name: 'cloudflare-worker'`

### Funnel Events

```
signup_started → signup_completed → site_created → first_publish →
first_payment → invite_sent → invite_accepted → churned
```

### Prompt Observability

- SHA-256 input hashing for reproducibility
- `withObservability()` wrapper: logs prompt_id, version, input_hash, latency, tokens, outcome
- Cost estimation by model tier

---

## 13. RBAC & Entitlements

### Roles

| Role | Permissions |
|------|------------|
| `owner` | Full access, can delete org, manage billing |
| `admin` | Manage sites, members, hostnames |
| `member` | Create/edit own sites |
| `viewer` | Read-only access |

### Middleware (`packages/shared/src/middleware/rbac.ts`)

```typescript
requireAuth       // Reject if no userId
optionalAuth      // Continue without auth
requireOrg        // Reject if no orgId
requireRole(role) // Check minimum role level
requirePermission(p) // Check specific permission
requireBillingAdmin  // Check billing_admin flag
requireSiteAccess(p) // Check site-level access
requireAdmin      // Owner-only routes
```

### Entitlements (`packages/shared/src/middleware/entitlements.ts`)

Derived from `subscriptions` table:
- `topBarHidden`: plan === 'paid' && status === 'active'
- `customDomains`: 0 (free) or 5 (paid)
- `prioritySupport`: plan === 'paid'

---

## 14. Testing Strategy

### Framework

- **Unit tests**: Jest with @swc/jest transform
- **E2E tests**: Playwright (migrated from Cypress)
- **Test-Driven Development**: Write tests first, then implement

### Test Counts (Final)

| Suite | Count |
|-------|-------|
| Worker unit tests | 546 (25 suites) |
| Shared package tests | 366 (6 suites) |
| E2E Playwright tests | 66 (4 spec files) |
| **Total** | **978** |

### E2E Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `golden-path.spec.ts` | 10 | Full user journey: search → auth (Google/Phone/Email) → details → build → waiting |
| `homepage.spec.ts` | 28 | Homepage sections, search, business selection, sign-in, marketing, footer |
| `health.spec.ts` | 15 | Health endpoint, marketing site, auth gates, tracing, CORS, errors |
| `site-serving.spec.ts` | 13 | Site serving, security headers, auth endpoints, webhooks, billing |

### Golden Path E2E Test

Tests the complete flow with "Vito's Mens Salon Lake Hiawatha":
1. Search → Select → Sign-In screen appears
2. Google OAuth: Search → Sign-In → Details → Build → Waiting
3. Phone OTP: Search → Phone → OTP → Details → Build → Waiting
4. Email Magic Link: Search → Email → Callback → Details → Build → Waiting
5. Waiting screen shows build-in-progress
6. Waiting screen redirects on completion
7. Build button disabled while submitting
8. Custom mode title
9. Phone validation
10. Email validation

### Configuration Notes

- Jest config must be `.cjs` (not `.js`/`.ts`) — packages use `"type": "module"`
- Jest `moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }` for TS import resolution
- Playwright Chromium path: `/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome`
- E2E server: `node scripts/e2e_server.cjs` on port 8787

---

## 15. Deployment & CI/CD

### Environments

| Environment | Worker | Pages | D1 |
|------------|--------|-------|-----|
| **Production** | `project-sites` at `sites.megabyte.space` | `bolt.megabyte.space` (main) | `project-sites-db-production` |
| **Staging** | `project-sites-staging` at `sites-staging.megabyte.space` | `bolt-staging.megabyte.space` | `project-sites-db-staging` |
| **Dev** | Local (`wrangler dev`) | Local | `project-sites-db-dev` |

### Workers Routes

```
*-sites.megabyte.space/*           → project-sites
*-sites-staging.megabyte.space/*   → project-sites-staging
```

### Cloudflare Access

Bypass apps configured for:
- `sites.megabyte.space`
- `sites-staging.megabyte.space`
- `bolt.megabyte.space`
- `bolt-staging.megabyte.space`

### Deploy Commands

```bash
# Workers
CLOUDFLARE_API_KEY=xxx CLOUDFLARE_EMAIL=xxx npx wrangler deploy --env staging
CLOUDFLARE_API_KEY=xxx CLOUDFLARE_EMAIL=xxx npx wrangler deploy --env production

# R2 Homepage Upload
npx wrangler r2 object put project-sites-production/marketing/index.html \
  --file public/index.html --content-type text/html --remote
npx wrangler r2 object put project-sites-staging/marketing/index.html \
  --file public/index.html --content-type text/html --remote
```

### CI/CD Pipeline (`.github/workflows/project-sites.yaml`)

```
Trigger: push/PR to main or staging
Jobs:
  1. lint (eslint)
  2. typecheck (tsc --noEmit)
  3. unit tests (jest)
  4. E2E tests (playwright)
  5. deploy (wrangler deploy + r2 sync)
```

### Cloudflare Resource IDs

| Resource | ID |
|----------|-----|
| Account | `84fa0d1b16ff8086dd958c468ce7fd59` |
| Zone (megabyte.space) | `75a6f8d5e441cd7124552976ba894f83` |
| Pages project (bolt-diy) | `76c34b4f-1bd1-410c-af32-74fd8ee3b23f` |
| D1 dev | `f5b59818-c785-4807-8aca-282c9037c58c` |
| D1 staging | `7bdf6256-7b5d-417f-9b29-c7466ec78508` |
| D1 production | `ea3e839a-c641-4861-ae30-dfc63bff8032` |

---

## 16. Brand, Copy & Design

### Color Palette

| Token | Value | Usage |
|-------|-------|-------|
| `--bg-dark` | `#0a0a1a` | Page background |
| `--accent` | `#64ffda` | Primary accent (cyan/teal) |
| `--secondary` | `#7c3aed` | Secondary accent (purple) |
| `--text-primary` | `#ffffff` | Headings, primary text |
| `--text-secondary` | `#94a3b8` | Body text, descriptions |
| `--text-muted` | `#64748b` | Captions, disclaimers |
| `--card-bg` | `#161635` | Card backgrounds |
| `--border` | `rgba(100,255,218,0.1)` | Subtle borders |

### Typography

- Font: **Inter** (Google Fonts) — weights 300, 400, 500, 600, 700
- Monospace: `'JetBrains Mono', monospace`

### Copy

| Element | Text |
|---------|------|
| Tagline | "Your website — handled. Finally." |
| Headline | "Your business website — live in under 15 minutes." |
| Primary CTA | "Launch My Site Now" |
| Secondary CTA | "See a Demo" |
| Microcopy | "Domain included • Updates included • Cancel anytime" |
| Contact | `hey@megabyte.space` |
| North Star | "We don't sell websites. We deliver them." |

### Social Links

| Platform | URL |
|----------|-----|
| GitHub | `https://github.com/HeyMegabyte` |
| X/Twitter | `https://x.com/HeyMegabyte` |
| LinkedIn | `https://linkedin.com/in/blzalewski` |
| YouTube | `https://youtube.com/@HeyMegabyte` |
| Instagram | `https://instagram.com/heymegabyteofficial` |
| Facebook | `https://facebook.com/HeyMegabyte` |

### Lottie Animations

| Animation | URL | Usage |
|-----------|-----|-------|
| Loader (spinning cat) | `https://lottie.host/2df87dd4-2471-465b-a31e-149686ec3bf6/wIvr2K9MtC.lottie` | Waiting screen |
| Hero peek cat | `https://lottie.host/ab6b65de-5b59-4b96-9dd9-9de0aee96613/cvsCu9G7IC.lottie` | Hero accent |

---

## 17. Constants, Caps & Limits

### System Caps

| Cap | Value |
|-----|-------|
| LLM daily spend | $20/day |
| Sites per day | 20 |
| Emails per day | 25 |
| Max request payload | 256KB |
| Max AI output | 64KB |
| P95 site HTML response | ≤ 300ms edge |
| P95 API latency | ≤ 500ms |
| KV cache TTL | 60 seconds |

### Auth Limits

| Limit | Value |
|-------|-------|
| Magic link expiry | 24 hours |
| OTP expiry | 5 minutes |
| OTP max attempts | 3 |
| Session expiry | 30 days |
| OTP rate limit | 1 per 60 seconds per phone |

### Billing Limits

| Limit | Value |
|-------|-------|
| Free custom domains | 0 |
| Paid custom domains | 5 |
| Dunning max stage | 60 days |
| Retention offer | $25/mo for 12 months |

---

## 18. Credentials & Environment Variables

### Env Interface (`src/types/env.ts`)

```typescript
interface Env {
  // Storage
  CACHE_KV: KVNamespace;
  PROMPT_STORE: KVNamespace;
  DB: D1Database;
  SITES_BUCKET: R2Bucket;
  QUEUE?: Queue;
  AI: Ai;

  // Config
  ENVIRONMENT: string;  // "staging" | "production"

  // Stripe
  STRIPE_SECRET_KEY: string;
  STRIPE_PUBLISHABLE_KEY: string;
  STRIPE_WEBHOOK_SECRET: string;

  // Google
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_PLACES_API_KEY: string;

  // Email
  SENDGRID_API_KEY?: string;

  // Analytics
  POSTHOG_API_KEY: string;
  POSTHOG_HOST?: string;

  // Error Tracking
  SENTRY_DSN: string;

  // Cloudflare API
  CF_API_TOKEN: string;
  CF_ZONE_ID: string;

  // LLM Fallbacks (optional)
  OPENAI_API_KEY?: string;
  OPEN_ROUTER_API_KEY?: string;
  GROQ_API_KEY?: string;

  // Integrations (optional)
  CHATWOOT_API_URL?: string;
  CHATWOOT_API_KEY?: string;
  NOVU_API_KEY?: string;
  SALE_WEBHOOK_URL?: string;
  SALE_WEBHOOK_SECRET?: string;
  METERING_PROVIDER?: string;
}
```

### Wrangler Auth

Uses Global API Key + email (not API token):
```bash
export CLOUDFLARE_API_KEY=<key>
export CLOUDFLARE_EMAIL=blzalewski@gmail.com
```

---

## 19. Known Bugs & Fixes

| Bug | Root Cause | Fix |
|-----|-----------|-----|
| Registry KV false match | `.includes(id)` too loose | Changed to `.startsWith('prompt:${id}@')` |
| `console.log` blocked | ESLint rule | Use `console.warn` for structured logs |
| Search results not rendering | JS read `data.results` but API returns `data.data` | Fixed unwrapping |
| CSS z-index overlap | `.search-wrapper` under dropdown | Added `z-index: 10` |
| Cross-origin redirect hanging | Playwright strict mode | Added `redirectTo()` helper |
| Homepage served as octet-stream | `path='/'` has no extension | Use `marketingPath` for MIME detection |
| CSP blocking inline JS | Missing `'unsafe-inline'` | Added to `script-src` |
| Playwright strict mode violations | `getByText()` matching multiple elements | Scoped with `.locator()` |
| Magic link email never sent | No SendGrid call | Added `sendEmail()` function |
| Audit log UUID validation | Test used `'org-123'` | Use proper UUID format |
| TS7053 in db.ts | Implicit `any` on indexed access | Added `Record<string, unknown>` type |
| Frontend/backend payload mismatch | Frontend sends nested, backend expects flat | Accept both formats |
| Phone OTP returns no token | Missing session creation | Added `findOrCreateUser` + `createSession` |
| Google OAuth returns JSON | Missing redirect | Changed to redirect with `?token=` |

---

## 20. Future / Not Yet Implemented

### Planned but Deferred

- `?chat` overlay: Auth-gated Bolt-based editing/support chat
- Lighthouse iteration loop: AI fixes until 90+ score
- Chatwoot integration: Customer communications hub
- Novu workflow engine: Multi-channel notification orchestration
- Dub claim links: `claimyour.site` vanity URLs
- Admin dashboard: Feature flags, kill switches, stats modal
- ZIP automation: Bulk site provisioning (default OFF)
- Lago metering: Feature-flagged usage tracking
- Registrar purchasing: Optional domain registration
- Advanced A/B experimentation: Beyond simple variant bucketing
- Cloudflare Turnstile: CAPTCHA on public forms
- Cloudflare AI Gateway: Mandatory for all LLM calls (not yet wired)
- Post-deploy E2E gate: Automatic rollback on Cypress/Playwright failure
- Flesch Reading Ease: All copy must score 50+ (not yet tested)

---

## Appendix: Definition of Done (Per Feature)

Each feature must be:

- [ ] **Shipped** — Merged to main + deployed to staging + production
- [ ] **Tested** — Jest unit tests (10+ cases) + Playwright E2E
- [ ] **Logged** — Structured JSON events + audit entries
- [ ] **Secured** — Zod validation, RBAC checks, rate limits, input sanitization
- [ ] **Documented** — TypeDoc comments (module + function level, tables, examples)
- [ ] **Instrumented** — PostHog events + Sentry error tracking + request_id propagation
