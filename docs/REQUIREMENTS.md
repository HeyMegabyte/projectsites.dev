# Project Sites — Complete Requirements Document

> This document captures every requirement from all prompts and sessions.
> It serves as the authoritative reference for what has been requested,
> what has been built, and what remains.

## Table of Contents

1. [Original Vision](#1-original-vision)
2. [Core User Flow](#2-core-user-flow)
3. [Homepage SPA Requirements](#3-homepage-spa-requirements)
4. [Authentication Requirements](#4-authentication-requirements)
5. [AI Workflow Requirements](#5-ai-workflow-requirements)
6. [Site Serving Requirements](#6-site-serving-requirements)
7. [Billing & Stripe Requirements](#7-billing--stripe-requirements)
8. [Security Requirements](#8-security-requirements)
9. [Observability Requirements](#9-observability-requirements)
10. [Testing Requirements](#10-testing-requirements)
11. [RBAC & Entitlements](#11-rbac--entitlements)
12. [Prompt Infrastructure](#12-prompt-infrastructure)
13. [Data Model Requirements](#13-data-model-requirements)
14. [Deployment Requirements](#14-deployment-requirements)
15. [Accumulated Bug Fixes](#15-accumulated-bug-fixes)
16. [Future / Not Yet Implemented](#16-future--not-yet-implemented)

---

## 1. Original Vision

**North Star**: "We don't sell websites. We deliver them."

Project Sites is a SaaS website delivery engine. A small-business owner searches for
their business, signs in, and receives a professionally built, AI-generated website
in under 15 minutes — hosted, SSL'd, and live on a stable URL.

### Key Principles (from original prompt)

1. Cloudflare Workers are the only first-party public ingress and API gateway
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

## 2. Core User Flow

```
1. User visits sites.megabyte.space
2. Searches for their business (Google Places API proxy)
3. Selects from search results dropdown
4. System checks if site already exists (lookup by place_id)
   - If published: redirect to live site
   - If building: show waiting screen
   - If new: continue to sign-in
5. User signs in via Google OAuth, Phone OTP, or Email Magic Link
6. User provides additional details + optional file uploads (logo, images)
7. User clicks "Build My Website"
8. AI workflow runs: research → generate → score → publish
9. User sees waiting screen with Lottie animation
10. Site goes live at {slug}-sites.megabyte.space
11. Optional: User pays $50/mo to remove top bar + get custom domain
```

---

## 3. Homepage SPA Requirements

### Layout & Design
- [x] Dark theme: `#0a0a1a` bg, `#64ffda` accent cyan, `#7c3aed` secondary purple
- [x] Font: Inter (Google Fonts), weights 300-700
- [x] 4-screen state machine: `search → signin → details → waiting`
- [x] Vanilla JS, no framework, CDN-only dependencies
- [x] Responsive mobile-first design

### Screen 1: Hero + Search
- [x] Logo "Project Sites" with gradient text
- [x] Tagline: "Your website — handled. Finally."
- [x] Headline: "Your business website — live in under 15 minutes."
- [x] Search input with 300ms debounce, min 2 chars
- [x] Parallel API calls: business search + pre-built site search
- [x] Dropdown results: pre-built sites first (green badge), then Google Places, then custom option
- [x] Site existence check on selection (redirect if published, waiting if building)

### Screen 2: Sign-In
- [x] Title: "Sign in to claim your website"
- [x] Google OAuth button
- [x] Phone OTP flow (input → send → verify)
- [x] Email Magic Link flow (input → send → check email message)
- [x] Session token stored in state after auth

### Screen 3: Details + Upload
- [x] Business badge showing selected name + address
- [x] Textarea for additional context
- [x] Uppy file upload widget (images + PDFs, 10MB max, 5 files)
- [x] "Build My Website" CTA button
- [x] Nested v2 payload format on submit

### Screen 4: Waiting
- [x] Lottie animation (spinning cat)
- [x] "We're building your website..." message
- [x] Shows auth identifier (email/phone)
- [x] Pulsing status dot
- [x] 10-second polling on site status
- [x] Auto-redirect when published

### Marketing Sections (scrollable below hero)
- [x] How It Works: 3-step cards
- [x] Features: 4 selling-point cards
- [x] Competitor Comparison: CSS table (vs Squarespace, Wix, WordPress)
- [x] Pricing: $50/mo card with feature list
- [x] Footer: links, social icons, copyright

### CDN Dependencies
- [x] Uppy v4.12.1 from releases.transloadit.com
- [x] Lottie Player from unpkg.com
- [x] Google Fonts: Inter

---

## 4. Authentication Requirements

### Three Sign-In Methods
- [x] **Email Magic Link**: Send → click → verify token → session
- [x] **Phone OTP**: Send SMS → enter 6-digit code → verify → session
- [x] **Google OAuth**: Redirect → consent → callback → session

### Auth Service Functions (all implemented)
- [x] `createMagicLink` — Generate token, hash, store, send email via SendGrid
- [x] `verifyMagicLink` — Validate token hash, check expiry, mark used
- [x] `createPhoneOtp` — Rate limit, generate OTP, hash, store
- [x] `verifyPhoneOtp` — Validate hash, check attempts, mark verified
- [x] `createGoogleOAuthState` — Generate state, store, return consent URL
- [x] `handleGoogleOAuthCallback` — Validate state, exchange code, fetch user info
- [x] `findOrCreateUser` — Upsert user + auto-provision org + membership
- [x] `createSession` — Generate token, hash, store, return plaintext + expiry
- [x] `getSession` — Validate, check expiry, bump last_active_at
- [x] `revokeSession` — Soft delete

### Auth Middleware
- [x] Checks `Authorization: Bearer <token>` header
- [x] Sets `userId`, `orgId`, `userRole`, `billingAdmin` on Hono context
- [x] Does NOT reject unauthenticated — routes decide individually

### Auth Constants
- [x] Magic link: 24h expiry
- [x] OTP: 5 min expiry, 3 max attempts, 6 digits
- [x] Session: 30 day expiry

---

## 5. AI Workflow Requirements

### V2 Pipeline (implemented as Cloudflare Workflow)
- [x] Phase 1: Profile research (sequential — business_type needed for all others)
- [x] Phase 2: Parallel research (social, brand, selling points, images)
- [x] Phase 3: Website HTML generation from all research data
- [x] Phase 4: Legal pages + quality scoring (parallel)
- [x] Phase 5: Upload to R2
- [x] Phase 6: Update D1 status to 'published'

### Prompt Infrastructure (all implemented)
- [x] YAML frontmatter + Markdown format (`.prompt.md` files)
- [x] Parser: extracts frontmatter, system section, user section
- [x] Renderer: template substitution with injection prevention (`<<<USER_INPUT>>>`)
- [x] Registry: version resolution, A/B variant bucketing, KV hot-patching
- [x] Observability: SHA-256 input hashing, structured call logging, cost estimation
- [x] Schemas: Zod validation for every prompt's input and output

### Generated Website Requirements
- [x] Hero section with carousel/slogans and CTAs
- [x] Footer with `/privacy` and `/terms` links
- [x] Google Maps section with business address
- [x] About section with mission statement
- [x] Top 3 selling points
- [x] Services section (if applicable)
- [x] Contact form
- [x] Social media icon links
- [x] Logo detection with fallback

### 13 Prompt Files (all created)
- [x] research_profile, research_social, research_brand, research_selling_points, research_images
- [x] generate_website, generate_legal_pages, score_website
- [x] site_copy (v3a), site_copy_v3b (variant B)
- [x] research_business (legacy v2), generate_site (legacy v2), score_quality (legacy v2)

---

## 6. Site Serving Requirements

- [x] Base domain serves marketing homepage from R2 (`marketing/index.html`)
- [x] Subdomain pattern: `{slug}-sites.megabyte.space`
- [x] R2 path: `sites/{slug}/{version}/{file}`
- [x] KV cache for host resolution (60s TTL)
- [x] Top bar injection for unpaid sites (after `<body>` tag)
- [x] PostHog API key injection into HTML `<head>`
- [x] Clean URL support (`.html` extension fallback)
- [x] Proper MIME type detection from file extension
- [x] Versioned publishes with `current_build_version` controlling active version

---

## 7. Billing & Stripe Requirements

### Pricing
- [x] Free: $0, site at subdomain, top bar visible, 0 custom domains
- [x] Paid: $50/mo, top bar hidden, up to 5 custom domains
- [x] Retention offer: $25/mo for 12 months (on cancellation)

### Stripe Integration (all implemented)
- [x] `getOrCreateStripeCustomer` — Find or create Stripe customer
- [x] `createCheckoutSession` — Stripe Checkout with Link optimization
- [x] `handleCheckoutCompleted` — Process successful checkout
- [x] `handleSubscriptionUpdated` — Sync subscription changes
- [x] `handleSubscriptionDeleted` — Handle cancellation
- [x] `handlePaymentFailed` — Increment dunning stage
- [x] `getOrgSubscription` — Get current subscription
- [x] `getOrgEntitlements` — Derive entitlements from subscription
- [x] `createBillingPortalSession` — Stripe billing portal

### Webhook Processing
- [x] HMAC-SHA256 signature verification via Web Crypto API
- [x] Idempotency via `(provider, event_id)` unique constraint
- [x] Payload hash for replay detection
- [x] Handled events: checkout.session.completed, invoice.paid, customer.subscription.updated/deleted, invoice.payment_failed
- [x] Sale webhook: external notification on purchase

### Dunning Schedule
- [x] Day 0, 7, 14, 30: email reminders
- [x] Day 60: downgrade to free

---

## 8. Security Requirements

- [x] CSP headers with `'unsafe-inline'` for homepage inline scripts
- [x] HSTS with preload directive
- [x] X-Frame-Options: DENY
- [x] X-Content-Type-Options: nosniff
- [x] Referrer-Policy: strict-origin-when-cross-origin
- [x] All request bodies validated with Zod schemas
- [x] `safeStringSchema` blocks `<script`, `javascript:`, `data:` patterns
- [x] CORS restricted to known domains + localhost
- [x] Max request payload: 256KB
- [x] Stripe webhook signature verification (timing-safe comparison)
- [x] Token hashing (SHA-256) — never store plaintext tokens
- [x] PII redaction in logs
- [x] Input sanitization (sanitizeHtml, sanitizeSlug)

---

## 9. Observability Requirements

- [x] Structured JSON logging via `console.warn`
- [x] Request ID propagation (`X-Request-ID` header)
- [x] PostHog server-side event capture (auth, site lifecycle, errors)
- [x] Sentry error tracking (Toucan SDK for Workers)
- [x] Funnel event tracking (signup → publish → payment → churn)
- [x] LLM call observability (prompt_id, version, input_hash, latency, tokens, cost)
- [x] Cloudflare observability enabled (logs, traces)

---

## 10. Testing Requirements

- [x] Jest for unit tests (`.cjs` config, @swc/jest transform)
- [x] Playwright for E2E tests (migrated from Cypress)
- [x] TDD approach: write tests first, 10+ cases per requirement
- [x] 527 worker unit tests (25 suites)
- [x] 367 shared package tests (6 suites)
- [x] E2E: golden-path, homepage, health, site-serving specs
- [x] Test business: "Vito's Mens Salon, Lake Hiawatha NJ"
- [x] `moduleNameMapper` for `.js` extension resolution in Jest

---

## 11. RBAC & Entitlements

- [x] 4 roles: owner > admin > member > viewer
- [x] Permission matrix with 14 permissions
- [x] `billing_admin` flag override for billing:write
- [x] Role hierarchy enforcement (`requireRole`)
- [x] Permission checks (`checkPermission`)
- [x] Plan-based entitlements (free vs paid)

---

## 12. Prompt Infrastructure

- [x] `.prompt.md` file format (YAML frontmatter + # System / # User sections)
- [x] Parser: `parsePromptMarkdown()` extracts spec from raw markdown
- [x] Renderer: `renderPrompt()` with `{{placeholder}}` substitution
- [x] Injection prevention: user input wrapped in `<<<USER_INPUT>>>` delimiters
- [x] Registry: version-keyed store (`id@version`), A/B variant support
- [x] KV hot-patching: `loadFromKv()` for runtime prompt updates
- [x] Observability: `withObservability()` wrapper for LLM calls
- [x] Schemas: Zod validation for every prompt's input/output contract

---

## 13. Data Model Requirements

- [x] 16+ tables with soft delete and org scoping
- [x] D1 (SQLite) as primary database
- [x] Reference Postgres schema in `supabase/migrations/`
- [x] D1 query helpers (dbQuery, dbInsert, dbUpdate, dbExecute)
- [x] Site status machine: draft → building → published | archived
- [x] Webhook idempotency via `(provider, event_id)` unique constraint
- [x] Confidence attributes for AI research data quality tracking

---

## 14. Deployment Requirements

- [x] Staging environment: `sites-staging.megabyte.space`
- [x] Production environment: `sites.megabyte.space`
- [x] Workers Routes for wildcard subdomains
- [x] Cloudflare Access bypass apps for both domains
- [x] R2 static file deployment for marketing homepage
- [x] wrangler.toml with staging + production env configs
- [x] CI/CD pipeline: lint → typecheck → test → e2e → deploy

---

## 15. Accumulated Bug Fixes (from all sessions)

| # | Bug | Fix | Session |
|---|-----|-----|---------|
| 1 | Registry KV false match (`includes` too loose) | Changed to `startsWith('prompt:${id}@')` | Mid |
| 2 | `console.log` blocked by ESLint | Use `console.warn` for structured logs | Early |
| 3 | Search dropdown read `data.results` not `data.data` | Fixed response unwrapping | Mid |
| 4 | CSS z-index overlap on search | Added `z-index: 10` to wrapper | Mid |
| 5 | Homepage served as `octet-stream` | Use `marketingPath` for MIME detection | Mid |
| 6 | CSP blocking inline JS | Added `'unsafe-inline'` to script-src | Mid |
| 7 | Magic link email never sent | Added `sendEmail()` function | Mid |
| 8 | Audit log UUID validation | Fixed test to use proper UUID format | Mid |
| 9 | TS7053 implicit `any` in db.ts | Added `Record<string, unknown>` type | Mid |
| 10 | Frontend/backend payload mismatch | Accept both v1 flat and v2 nested | Late |
| 11 | Phone OTP returns no token | Added `findOrCreateUser` + `createSession` | Late |
| 12 | Google OAuth returns JSON (should redirect) | Changed to redirect with `?token=` | Late |
| 13 | Playwright strict mode violations | Scoped selectors with `.locator()` | Late |

---

## 16. Future / Not Yet Implemented

These items were discussed but explicitly deferred:

- [ ] `?chat` overlay: Auth-gated Bolt-based editing/support chat
- [ ] Lighthouse iteration loop: AI fixes until 90+ score
- [ ] Chatwoot integration: Customer communications hub
- [ ] Novu workflow engine: Multi-channel notification orchestration
- [ ] Dub claim links: `claimyour.site` vanity URLs
- [ ] Admin dashboard: Feature flags, kill switches, stats modal
- [ ] ZIP automation: Bulk site provisioning
- [ ] Lago metering: Usage-based billing
- [ ] Registrar purchasing: Optional domain registration
- [ ] Cloudflare Turnstile: CAPTCHA on public forms
- [ ] Cloudflare AI Gateway: Mandatory routing for all LLM calls
- [ ] Post-deploy E2E gate: Automatic rollback on test failure
- [ ] Flesch Reading Ease: All copy must score 50+
- [ ] Scheduled tasks: hostname verification, dunning checks, analytics rollup
- [ ] Queue enablement: Currently commented out in wrangler.toml
