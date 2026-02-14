# Project Sites — Architecture Document

> Detailed technical architecture for the Project Sites SaaS website delivery engine.

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Cloudflare Edge Network                       │
│                                                                   │
│  ┌─────────────────┐    ┌──────────────────────────────────────┐│
│  │  Pages (bolt.diy) │    │  Worker (project-sites)              ││
│  │  bolt.megabyte.   │    │  sites.megabyte.space                ││
│  │  space            │    │  *-sites.megabyte.space              ││
│  │                   │    │                                      ││
│  │  Remix + Vite     │    │  Hono Framework                     ││
│  │  AI Code Editor   │    │  ├── Middleware Stack                ││
│  │                   │    │  ├── API Routes                     ││
│  │                   │    │  ├── Site Serving                   ││
│  │                   │    │  └── Queue Consumer                 ││
│  └─────────────────┘    └──────────┬───────────────────────────┘│
│                                     │                             │
│  ┌──────────┐  ┌─────┐  ┌────────┐ │ ┌──────────┐  ┌──────────┐│
│  │    D1    │  │ KV  │  │   R2   │ │ │Workflows │  │Workers AI││
│  │ (SQLite) │  │Cache│  │Storage │ │ │ (Durable)│  │  (LLM)   ││
│  └──────────┘  └─────┘  └────────┘ │ └──────────┘  └──────────┘│
└─────────────────────────────────────┼───────────────────────────┘
                                      │
         ┌────────────────────────────┼──────────────────────┐
         │                            │                      │
    ┌────┴────┐  ┌─────────┐  ┌──────┴───┐  ┌───────────┐  │
    │ Stripe  │  │SendGrid │  │Google    │  │ PostHog   │  │
    │Payments │  │ Email   │  │OAuth+API │  │ Analytics │  │
    └─────────┘  └─────────┘  └──────────┘  └───────────┘  │
                                                            │
                                                    ┌───────┴──┐
                                                    │  Sentry  │
                                                    │  Errors  │
                                                    └──────────┘
```

## Request Flow

### 1. Incoming Request Classification

```
Request → Worker
  │
  ├─ hostname = sites.megabyte.space OR sites-staging.megabyte.space
  │   └─ Marketing site (serve from R2: marketing/*)
  │
  ├─ path starts with /health
  │   └─ Health check (probe KV + R2)
  │
  ├─ path starts with /api/search/* OR /api/sites/lookup OR /api/sites/search
  │   └─ Search routes (public, no auth required)
  │
  ├─ path starts with /api/*
  │   └─ API routes (auth middleware extracts session)
  │
  ├─ path starts with /webhooks/*
  │   └─ Webhook routes (signature verification)
  │
  └─ hostname = {slug}-sites.megabyte.space
      └─ Site serving (resolve slug → D1 → R2)
```

### 2. Middleware Stack (every request)

```
Request
  │
  ├─ 1. requestIdMiddleware
  │     Generate crypto.randomUUID() or use X-Request-ID header
  │     Set on Hono context: c.set('requestId', id)
  │
  ├─ 2. payloadLimitMiddleware
  │     Check Content-Length vs DEFAULT_CAPS.MAX_REQUEST_BODY_BYTES (256KB)
  │     Throw AppError(413) if exceeded
  │
  ├─ 3. securityHeadersMiddleware
  │     Set: HSTS, X-Frame-Options, X-Content-Type-Options,
  │           Referrer-Policy, Permissions-Policy, CSP
  │
  ├─ 4. cors (API routes only)
  │     Allow: sites domains, bolt domains, localhost:3000/5173
  │     Methods: GET, POST, PATCH, DELETE, OPTIONS
  │     Credentials: true
  │
  ├─ 5. authMiddleware (API routes only)
  │     Extract Bearer token → SHA-256 hash → D1 sessions lookup
  │     Set: userId, orgId, userRole, billingAdmin (or leave unset)
  │
  └─ 6. errorHandler (onError)
        AppError → JSON { error: { code, message, request_id } }
        ZodError → 400 { error: { code: 'VALIDATION_ERROR', details: issues } }
        Unknown → 500, report to Sentry + PostHog
```

## Data Architecture

### D1 Schema (16 tables)

```
orgs ─────────┐
              ├── memberships ──── users
              ├── sites ──────┬── hostnames
              │               ├── confidence_attributes
              │               ├── research_data
              │               └── analytics_daily
              ├── subscriptions
              ├── audit_logs
              ├── workflow_jobs
              ├── webhook_events
              ├── funnel_events
              └── usage_events

users ────┬── sessions
          ├── magic_links (by email)
          └── phone_otps (by phone)

oauth_states (standalone, ephemeral)
feature_flags (standalone, org-scoped)
admin_settings (standalone, global)
lighthouse_runs (site-scoped)
```

### Multi-Tenancy Pattern

Every data table is scoped to `org_id`:
1. Auth middleware extracts `userId` from session
2. Membership lookup: `SELECT org_id FROM memberships WHERE user_id = ?`
3. All queries filter by `org_id` (enforced in route handlers)
4. Reference schema has RLS policies for Postgres (D1 doesn't support RLS natively)

### Soft Delete Pattern

Every table has `deleted_at TIMESTAMPTZ`:
- Active records: `WHERE deleted_at IS NULL`
- "Delete" = `UPDATE SET deleted_at = now()`
- Queries always filter `deleted_at IS NULL`
- Indexes use `WHERE deleted_at IS NULL` partial indexes

### D1 vs Postgres Differences

| Postgres | D1 (SQLite) |
|----------|-------------|
| `UUID` type | `TEXT` (store UUID strings) |
| `TIMESTAMPTZ` | `TEXT` (store ISO-8601 strings) |
| `BOOLEAN` | `INTEGER` (0/1) |
| `JSONB` | `TEXT` (store JSON strings) |
| `gen_random_uuid()` | `crypto.randomUUID()` in JS |
| `now()` | `new Date().toISOString()` in JS |
| `$1, $2` params | `?` placeholders |
| RLS policies | Enforced in application code |

## AI Workflow Architecture

### Cloudflare Workflow (site-generation.ts)

The AI site generation uses Cloudflare Workflows for durability and automatic retries:

```
┌────────────────────────────────────────────────────────────────┐
│                   SiteGenerationWorkflow                        │
│                                                                 │
│  Step 1: research-profile (sequential)                         │
│    → Extracts business_type needed for all subsequent steps     │
│    → Retry: 3x, 10s backoff, 2min timeout                     │
│                                                                 │
│  Step 2: Parallel research                                      │
│    ├── research-social      → social links + website URL        │
│    ├── research-brand       → logo, colors, fonts              │
│    ├── research-selling-points → 3 USPs + hero slogans         │
│    └── research-images      → image strategies                  │
│    → All: Retry 3x, 10s backoff, 2min timeout                 │
│                                                                 │
│  Step 3: generate-website (sequential)                          │
│    → Full HTML from all research data                           │
│    → Retry: 3x, 15s backoff, 5min timeout                     │
│                                                                 │
│  Step 4: Parallel finalization                                  │
│    ├── generate-privacy-page  → privacy policy HTML             │
│    ├── generate-terms-page    → terms of service HTML           │
│    └── score-website          → 8-dimension quality score       │
│    → Legal: Retry 3x, 10s backoff, 3min timeout               │
│    → Scoring: Retry 2x, 10s backoff, 2min timeout             │
│                                                                 │
│  Step 5: upload-to-r2                                          │
│    → sites/{slug}/{version}/index.html                         │
│    → sites/{slug}/{version}/privacy.html                       │
│    → sites/{slug}/{version}/terms.html                         │
│    → sites/{slug}/{version}/research.json                      │
│    → Retry: 3x, 5s backoff, 1min timeout                      │
│                                                                 │
│  Step 6: update-site-status                                    │
│    → D1: SET status='published', current_build_version=ver     │
│    → Retry: 3x, 5s backoff, 30s timeout                       │
└────────────────────────────────────────────────────────────────┘
```

### LLM Call Pattern

Every AI call follows this pattern:
1. Resolve prompt from registry (`resolve(id, version)`)
2. Validate inputs against Zod schema (`validatePromptInput`)
3. Render prompt templates (`renderPrompt`)
4. Call Workers AI via `env.AI.run(model, messages)`
5. Parse output (JSON or HTML)
6. Validate output against Zod schema (`validatePromptOutput`)
7. Log call metrics via observability wrapper

### Injection Prevention

User-provided inputs in prompts are wrapped in delimiters:
```
<<<USER_INPUT>>>
Vito's Mens Salon, Lake Hiawatha NJ
<<<END_USER_INPUT>>>
```

This prevents prompt injection by clearly delineating untrusted content.

## Caching Architecture

### KV Cache (60s TTL)

```
Key: host:{hostname}
Value: JSON { siteId, slug, version, orgId, isPaid }
TTL: 60 seconds

Purpose: Avoid D1 query on every page view for customer sites
Write: On cache miss during site serving
Invalidate: TTL-based (no explicit invalidation)
```

### Prompt KV Store (no TTL)

```
Key: prompt:{id}@{version}
Value: Raw .prompt.md content (YAML + markdown)

Purpose: Runtime hot-patching of prompts without deploy
Read: On worker startup via loadFromKv()
Write: Manual via wrangler kv:put
```

## Site Serving Architecture

### R2 Bucket Layout

```
project-sites-{env}/
├── marketing/
│   ├── index.html          # Homepage SPA
│   ├── privacy.html        # Privacy policy
│   ├── terms.html          # Terms of service
│   ├── favicon.ico
│   ├── site.webmanifest
│   └── *.svg/*.png         # Static assets
└── sites/
    └── {slug}/
        └── {version}/
            ├── index.html      # Generated site
            ├── privacy.html    # Generated privacy page
            ├── terms.html      # Generated terms page
            └── research.json   # AI research data
```

### Serving Decision Tree

```
hostname == base_domain?
  ├─ YES: path == '/' ? marketing/index.html : marketing/{path}
  │        ├─ Found: Serve (inject PostHog key for HTML)
  │        ├─ Not found + no extension: Try marketing/{path}.html
  │        └─ Still not found: Return JSON info
  └─ NO (subdomain):
       ├─ Resolve site (KV cache → D1 hostnames → D1 sites → D1 subscriptions)
       ├─ Not found → 404 JSON
       ├─ Found: Serve from R2 sites/{slug}/{version}/{path}
       └─ Unpaid: Inject top bar after <body> tag
```

### Top Bar Injection (unpaid sites)

For sites on the free plan, a branding top bar is injected:
```html
<div style="background:#7c3aed;color:white;text-align:center;padding:8px;font-family:Inter,sans-serif;font-size:14px;">
  Powered by <a href="https://sites.megabyte.space" style="color:white;text-decoration:underline;">Project Sites</a>
  — <a href="https://sites.megabyte.space" style="color:white;text-decoration:underline;">Remove this bar</a>
</div>
```

## Authentication Architecture

### Session Flow

```
Sign In → findOrCreateUser() → createSession()
  │
  ├─ Hash plaintext token with SHA-256
  ├─ Store hash in sessions table (never store plaintext)
  ├─ Return plaintext token to client
  └─ Client sends: Authorization: Bearer {plaintext_token}

Subsequent requests:
  │
  ├─ Auth middleware extracts Bearer token
  ├─ SHA-256 hash the token
  ├─ Look up hash in sessions table
  ├─ Check expiry (30 days)
  ├─ Bump last_active_at
  └─ Set userId, orgId on Hono context
```

### User Provisioning (findOrCreateUser)

```
1. Look up user by email or phone
2. If not found:
   a. Create user record
   b. Create org record (name = display_name or email prefix)
   c. Create membership (role = 'owner')
3. If found: return existing user
4. Lookup membership to get org_id
5. Return { userId, orgId }
```

## Billing Architecture

### Stripe Integration Pattern

```
Customer Journey:
  Free Site → Click Upgrade → Stripe Checkout → Webhook → Paid

Checkout:
  1. getOrCreateStripeCustomer(orgId, email)
  2. stripe.checkout.sessions.create({ mode: 'subscription', ... })
  3. Return checkout_url to frontend
  4. User completes payment in Stripe-hosted page

Webhook Processing:
  1. Verify signature (HMAC-SHA256, timing-safe compare)
  2. Check idempotency (webhook_events table)
  3. Store event (status: 'processing')
  4. Dispatch to handler by event.type
  5. Update subscription record
  6. Write audit log
  7. Mark event processed
```

### Entitlement Derivation

```
subscription.plan == 'paid' && subscription.status == 'active'
  → topBarHidden: true
  → maxCustomDomains: 5
  → analyticsEnabled: true

subscription.plan == 'free' OR status != 'active'
  → topBarHidden: false
  → maxCustomDomains: 0
  → analyticsEnabled: false
```

## Error Handling Architecture

### Error Type Hierarchy

```
AppError (extends Error)
  ├── code: ApiErrorCode       # Machine-readable code
  ├── statusCode: number       # HTTP status
  ├── message: string          # Human-readable message
  ├── details?: object         # Validation details, extra context
  ├── requestId?: string       # Correlation ID
  └── toJSON()                 # Standard error envelope

Error Flow:
  Route Handler → throw AppError → errorHandler middleware → JSON response
  Route Handler → throw ZodError → errorHandler middleware → 400 + issues
  Route Handler → throw unknown  → errorHandler → 500 + Sentry report
```

### Error Response Contract

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "request_id": "550e8400-e29b-41d4-a716-446655440000",
    "details": {
      "issues": [
        { "path": ["email"], "message": "Invalid email format" }
      ]
    }
  }
}
```
