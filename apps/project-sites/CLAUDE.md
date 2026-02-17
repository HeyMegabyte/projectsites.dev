# Project Sites Worker — AI Context Guide

> Cloudflare Worker powering the SaaS website delivery engine at `sites.megabyte.space`.
> Built with Hono framework, Cloudflare D1/KV/R2/Workflows/AI.

## Quick Start

```bash
cd apps/project-sites
npm install --legacy-peer-deps   # NOT pnpm (electron-builder breaks it)
npm test                         # 527 unit tests across 25 suites
npm run typecheck                # tsc --noEmit
npm run lint                     # eslint
npx wrangler dev                 # local dev server (port 8787)
```

## Product Vision

**"We don't sell websites. We deliver them."**

A small-business owner searches for their business, signs in, and receives a professionally
built AI-generated website in under 15 minutes — hosted, SSL'd, and live.

### Golden Path
```
Search → Select business → Sign In → Provide details + upload → AI builds → Live site
```

## Source Layout

```
src/
├── index.ts                    # Hono app: middleware stack, route mounts, queue/scheduled handlers
├── types/env.ts                # Env bindings (D1, KV, R2, AI, Queue, Workflow) + Variables
├── middleware/
│   ├── auth.ts                 # Bearer token → session → userId/orgId (does NOT reject unauthed)
│   ├── error_handler.ts        # AppError → JSON, ZodError → 400, unknown → 500 + Sentry
│   ├── payload_limit.ts        # 256KB max request body
│   ├── request_id.ts           # X-Request-ID header generation/propagation
│   └── security_headers.ts     # CSP, HSTS, X-Frame-Options, Permissions-Policy
├── routes/
│   ├── health.ts               # GET /health (checks KV + R2 latency)
│   ├── search.ts               # Business search, site lookup, create-from-search
│   ├── api.ts                  # Auth, sites CRUD, billing, hostnames, audit logs
│   └── webhooks.ts             # POST /webhooks/stripe (signature verification + idempotency)
├── services/
│   ├── ai_workflows.ts         # V2 multi-phase AI pipeline + prompt registration
│   ├── analytics.ts            # PostHog server-side event capture
│   ├── audit.ts                # Append-only audit log writes
│   ├── auth.ts                 # Magic link, phone OTP, Google OAuth, sessions
│   ├── billing.ts              # Stripe checkout, subscriptions, entitlements
│   ├── db.ts                   # D1 query helpers (dbQuery, dbInsert, dbUpdate, dbExecute)
│   ├── domains.ts              # CF for SaaS custom hostname provisioning
│   ├── sentry.ts               # Error tracking (Toucan SDK)
│   ├── site_serving.ts         # R2 static file serving + top bar injection for unpaid
│   └── webhook.ts              # Stripe signature verification, idempotency
├── prompts/
│   ├── index.ts                # Registry initialization (registerAllPrompts)
│   ├── types.ts                # PromptSpec interface, PromptKey type
│   ├── parser.ts               # YAML frontmatter + # System/# User section parser
│   ├── renderer.ts             # Template rendering with injection prevention
│   ├── schemas.ts              # Zod I/O schemas per prompt (validatePromptInput/Output)
│   ├── registry.ts             # Version resolution, A/B variants, KV hot-patching
│   └── observability.ts        # LLM call logging, cost estimation, SHA-256 hashing
├── workflows/
│   └── site-generation.ts      # Cloudflare Workflow: 6-step durable AI pipeline
└── lib/
    ├── posthog.ts              # PostHog capture helper (fire-and-forget)
    └── sentry.ts               # Sentry client factory (Toucan)
```

## API Surface

### Public Endpoints (no auth required)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health check (KV + R2 probe) |
| GET | `/api/search/businesses?q=...` | Google Places proxy (max 10) |
| GET | `/api/sites/search?q=...` | Pre-built site search (LIKE) |
| GET | `/api/sites/lookup?place_id=...&slug=...` | Check if site exists |
| GET | `/api/auth/google` | Start Google OAuth flow |
| GET | `/api/auth/google/callback` | Google OAuth callback |
| GET | `/api/auth/magic-link/verify?token=...` | Email click verification |
| POST | `/webhooks/stripe` | Stripe webhook (signature verified) |

### Authenticated Endpoints (Bearer token required)
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/sites/create-from-search` | Create site + start AI workflow |
| POST | `/api/auth/magic-link` | Request magic link email |
| POST | `/api/auth/magic-link/verify` | Verify magic link (programmatic) |
| POST | `/api/auth/phone/otp` | Request phone OTP |
| POST | `/api/auth/phone/verify` | Verify phone OTP |
| POST | `/api/sites` | Create site (manual) |
| GET | `/api/sites` | List user's sites |
| GET | `/api/sites/:id` | Get single site |
| GET | `/api/sites/:id/workflow` | Get workflow status |
| POST | `/api/billing/checkout` | Create Stripe checkout session |
| GET | `/api/billing/subscription` | Get subscription status |
| GET | `/api/billing/entitlements` | Get plan entitlements |
| GET | `/api/sites/:siteId/hostnames` | List hostnames |
| POST | `/api/sites/:siteId/hostnames` | Provision hostname |
| GET | `/api/audit-logs` | List audit logs |

### Error Response Format
```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Site not found",
    "request_id": "uuid"
  }
}
```

Error codes: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
`PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `VALIDATION_ERROR`, `INTERNAL_ERROR`,
`WEBHOOK_SIGNATURE_INVALID`, `WEBHOOK_DUPLICATE`, `STRIPE_ERROR`,
`DOMAIN_PROVISIONING_ERROR`, `AI_GENERATION_ERROR`

## Middleware Stack (execution order)
1. `requestId` — Generate/propagate `X-Request-ID`
2. `payloadLimit` — Reject bodies > 256KB
3. `securityHeaders` — CSP, HSTS, X-Frame-Options
4. `cors` (API only) — Allow bolt/sites domains + localhost
5. `auth` (API only) — Bearer token → session → userId/orgId
6. `errorHandler` — Catch all, format as JSON

## AI Workflow Pipeline (site-generation.ts)

```
Step 1 (sequential):  research-profile        → business_type needed for others
Step 2 (parallel):    research-social          → social links
                      research-brand           → logo, colors, fonts
                      research-selling-points  → USPs, hero content
                      research-images          → image strategies
Step 3 (sequential):  generate-website         → full HTML from all research
Step 4 (parallel):    generate-privacy-page    → privacy policy HTML
                      generate-terms-page      → terms of service HTML
                      score-website            → 8-dimension quality scoring
Step 5:               upload-to-r2             → sites/{slug}/{version}/*
Step 6:               update-site-status       → D1: status='published'
```

Each step has automatic retry (3x) with exponential backoff.

## Prompt Files (prompts/*.prompt.md)

13 prompt files in YAML frontmatter + Markdown format:

| File | Purpose |
|------|---------|
| `research_profile.prompt.md` | Deep business profile research |
| `research_social.prompt.md` | Social media + website discovery |
| `research_brand.prompt.md` | Logo, colors, fonts, personality |
| `research_selling_points.prompt.md` | 3 USPs + hero slogans |
| `research_images.prompt.md` | Image needs + search strategies |
| `generate_website.prompt.md` | Full website HTML from research data |
| `generate_legal_pages.prompt.md` | Privacy/terms pages |
| `score_website.prompt.md` | 8-dimension quality scoring |
| `site_copy.prompt.md` | Marketing copy (variant A) |
| `site_copy_v3b.prompt.md` | Marketing copy (variant B) |
| `research_business.prompt.md` | Legacy business research (v2) |
| `generate_site.prompt.md` | Legacy generation (v2) |
| `score_quality.prompt.md` | Legacy scoring (v2) |

## D1 Database (16 tables)

All tables have: `id` (UUID), `created_at`, `updated_at`, `deleted_at` (soft delete).
Org-scoped tables include `org_id`.

**Core**: `orgs`, `users`, `memberships`, `sites`, `hostnames`
**Auth**: `sessions`, `magic_links`, `phone_otps`, `oauth_states`
**Billing**: `subscriptions`
**Infra**: `webhook_events`, `audit_logs`, `workflow_jobs`
**AI**: `research_data`, `confidence_attributes`
**Analytics**: `analytics_daily`, `funnel_events`, `usage_events`

Site status machine: `draft → building → published | archived`

## D1 Query Helpers (services/db.ts)
```typescript
dbQuery<T>(db, sql, params)      // SELECT multiple → { data: T[] }
dbQueryOne<T>(db, sql, params)   // SELECT one → T | null
dbInsert(db, table, record)      // INSERT + auto timestamps
dbUpdate(db, table, updates, where, params) // UPDATE + auto updated_at
dbExecute(db, sql, params)       // Raw execute
```

## Site Serving Flow
1. Base domain (`sites.megabyte.space`) → serve `marketing/index.html` from R2
2. Subdomain (`{slug}-sites.megabyte.space`) → resolve from D1 → serve from R2
3. Unpaid sites → inject top bar after `<body>` tag
4. KV cache: `host:{hostname}` → site record (60s TTL)

## Env Bindings (wrangler.toml)
- `CACHE_KV`: KV namespace for caching
- `PROMPT_STORE`: KV namespace for prompt hot-patching
- `DB`: D1 database
- `SITES_BUCKET`: R2 bucket for static sites
- `QUEUE`: Queue (optional, commented out — not yet enabled on account)
- `SITE_WORKFLOW`: Cloudflare Workflow binding
- `AI`: Workers AI binding

## Testing
```bash
npm test                    # 527 unit tests
npm run test:coverage       # with coverage
npx playwright test         # E2E tests (needs Chromium)
```

### E2E Test Files
- `e2e/golden-path.spec.ts` — Full user journey (10 tests)
- `e2e/homepage.spec.ts` — Homepage sections + auth screens (28 tests)
- `e2e/health.spec.ts` — Health, CORS, auth gates (15 tests)
- `e2e/site-serving.spec.ts` — Serving, security, webhooks (13 tests)

### Test Business for E2E
**Vito's Mens Salon** — 74 N Beverwyck Rd, Lake Hiawatha, NJ 07034

## Known Issues & Gotchas

1. **CSP**: Homepage uses inline `<script>` — CSP MUST include `'unsafe-inline'` in script-src
2. **MIME bug**: Use `marketingPath` not `path` for content-type detection (path='/' has no extension)
3. **console.log blocked**: Use `console.warn` for structured JSON logs
4. **Payload format**: Frontend sends nested v2 format, backend accepts both v1 (flat) and v2 (nested)
5. **Queues**: Not yet enabled on CF account — binding is optional, code falls back to Workflows
6. **Jest config**: Must be `.cjs` not `.js` (ESM module type)
7. **Registry KV match**: Uses `startsWith('prompt:${id}@')` to avoid false partial matches

## Homepage SPA (public/index.html)

4-screen state machine: `search → signin → details → waiting`
- Vanilla JS, no framework
- CDN deps: Uppy (file upload), Lottie (animations), Google Fonts (Inter)
- 300ms debounced search, min 2 chars
- Parallel API calls on search: `/api/search/businesses` + `/api/sites/search`
