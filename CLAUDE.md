# bolt.diy Monorepo — AI Context Guide

> **Purpose**: This file is the primary AI onboarding document for the bolt.diy monorepo.
> A new Claude Code session reading only this file should understand the project structure,
> development patterns, and how to get productive immediately.

---

# PART 0 — How to use this document

## 0.1 The workflow
1. Read this file to understand the project purpose, architecture, and standards
2. Follow the **Task Protocol** and **Hard Gates** before claiming any task complete
3. Every task produces: **code changes** with tests + docs, and a **Verification Log**

## 0.2 The two outputs every task must produce
- **Code changes** with tests + docs updates
- A **Verification Log** containing exact commands and pass/fail results

---

# PART 1 — Mission and non-negotiables

## 1.1 Mission
Build an **AI-native**, **gorgeous**, **easy-to-use**, **Cloudflare-optimized** application suite where correctness is proven by:
- **E2E-TDD Playwright** (primary verification)
- **100% feature coverage** (enforced via `e2e/FEATURES.md` inventory)
- **100% unit test coverage** (enforced by test thresholds)
- **strict linting** and **quantitative quality gates**

## 1.2 Non-negotiables
- AI is the primary developer — the system must be **self-explaining** and **self-diagnosing**
- Prefer **Cloudflare-only** primitives; only use **Neon/Upstash** when the Cloudflare stack cannot meet requirements
- Use **Zod everywhere** at boundaries; error messages must be **human-readable**
- Implement "distinguished engineer" error handling everywhere (taxonomy + envelopes + idempotency + retries + fallbacks)
- Every major system is instrumented: logs, traces, events, notifications are **enriched and correlated**
- Documentation is first-class: JSDoc/TypeDoc on exports + docs with tables/examples/references

---

# PART 2 — Project Purpose Summary

**bolt.diy** is an open-source, AI-powered full-stack web development IDE that runs in the browser. It lets developers chat with AI models to generate, edit, and deploy web applications — all within an integrated environment featuring a code editor, terminal, file manager, and live preview.

- **Primary users**: Web developers, indie hackers, and learners who want AI-assisted code generation
- **First value**: User types a prompt, AI generates a working web app they can preview and deploy
- **Primary entities**: Chats, Files/Projects, Providers/Models, Deployments, Settings

The monorepo also includes:
- **Project Sites** (`apps/project-sites/`): A SaaS website builder powered by AI, serving generated business websites on Cloudflare Workers
- **Shared Package** (`packages/shared/`): Zod schemas, constants, RBAC middleware, utilities shared between packages

---

# PART 3 — Quick Orientation

This is a monorepo containing:

1. **Root app** (`/app`): A Remix + Vite web app for bolt.diy (AI code editor), deployed to Cloudflare Pages at `bolt.megabyte.space`
2. **Project Sites Worker** (`/apps/project-sites`): A Cloudflare Worker (Hono) that powers the SaaS website delivery engine at `sites.megabyte.space`
3. **Shared Package** (`/packages/shared`): Zod schemas, constants, RBAC middleware, utilities shared between packages
4. **Database Schema** (`/supabase/migrations/`): Reference Postgres schema (D1 SQLite equivalent used in production)

The **primary development focus** in recent sessions has been on `apps/project-sites/` and `packages/shared/`.

## Repository Structure

```
bolt.diy/
├── app/                          # Remix frontend (bolt.diy AI code editor)
├── apps/
│   └── project-sites/            # Cloudflare Worker → sites.megabyte.space
│       ├── src/
│       │   ├── index.ts          # Hono app entry point
│       │   ├── types/env.ts      # Env bindings + Variables
│       │   ├── middleware/       # auth, error_handler, payload_limit, request_id, security_headers
│       │   ├── routes/           # api.ts, health.ts, search.ts, webhooks.ts
│       │   ├── services/         # ai_workflows, analytics, audit, auth, billing, db, domains, sentry, site_serving, webhook
│       │   ├── prompts/          # TS infra: parser, renderer, registry, schemas, observability, types
│       │   ├── workflows/        # site-generation.ts (Cloudflare Workflow)
│       │   ├── lib/              # posthog.ts, sentry.ts
│       │   └── __tests__/        # 25 test suites
│       ├── prompts/              # .prompt.md files (YAML frontmatter + # System/# User)
│       ├── public/               # index.html (marketing SPA), static assets
│       ├── e2e/                  # Playwright E2E specs
│       ├── wrangler.toml         # Worker config (dev/staging/production)
│       ├── jest.config.cjs
│       └── playwright.config.ts
├── packages/
│   └── shared/                   # @project-sites/shared
│       └── src/
│           ├── schemas/          # Zod: org, site, billing, auth, audit, webhook, workflow, config, analytics, hostname, api
│           ├── middleware/        # RBAC + entitlements
│           ├── utils/            # errors, crypto, sanitize, redact
│           └── constants/        # DOMAINS, AUTH, PRICING, CAPS, ENTITLEMENTS, ROLES
├── e2e/                          # Root-level E2E tests for bolt.diy main app
│   ├── FEATURES.md               # Authoritative feature inventory
│   ├── COVERAGE.yml              # Feature → spec mapping
│   ├── fixtures.ts               # Shared Playwright fixtures
│   ├── playwright.config.ts      # Playwright config for main app
│   └── specs/                    # 14 spec files, 96+ tests
├── supabase/migrations/          # Reference Postgres schema (D1 SQLite used in prod)
├── docs/                         # MkDocs documentation site
├── electron/                     # Electron desktop wrapper
└── .github/workflows/            # CI/CD pipelines
```

---

# PART 4 — Cloudflare-first architecture (fallback only when necessary)

## 4.1 Default Cloudflare primitives (use first)
Use these unless there is a concrete reason not to:

**Compute / routing**
- Workers (Hono) for APIs and SSR functions
- Pages for front-end hosting when suitable

**Storage**
- R2 for uploads/assets
- KV for small config, cache snapshots, feature flag snapshots
- Durable Objects for stateful flows, collaboration, presence, progress, per-tenant state
- Queues for async jobs; Cron Triggers for scheduled tasks
- D1 for simple relational needs (when Postgres features not required)

**Edge**
- Caching with explicit rules (SWR for safe content, never cache auth/billing/permissions)
- Turnstile for abuse prevention

## 4.2 Fallback decision tree: Neon + Upstash (only if required)
**Neon Postgres (fallback)** — use only if you need:
- Postgres semantics (advanced SQL, joins, concurrency, extensions)
- Strong relational modeling beyond D1 scope
- **RLS** as the primary tenant isolation guarantee
- Heavy analytics queries / OLAP-like needs

When using Neon with Workers, prefer **Cloudflare Hyperdrive** to stabilize connections.

**Upstash Redis (fallback)** — use only if you need:
- Redis-specific primitives: sorted sets, streams, locks, atomic counters at scale
- Global rate limiting beyond what KV/DO can reasonably do
- High-throughput cache invalidation patterns

## 4.3 Project Sites Worker Stack
| Layer | Technology | Purpose |
|-------|-----------|---------|
| Ingress/API | Cloudflare Workers + Hono | API gateway, site serving |
| Database | Cloudflare D1 (SQLite) | System of record |
| Cache | Cloudflare KV | Host resolution (60s TTL), prompt hot-patching |
| Storage | Cloudflare R2 | Static sites, marketing assets |
| Background | Cloudflare Workflows | AI site generation pipeline |
| AI | Cloudflare Workers AI | LLM inference (Llama 3.1) |
| Payments | Stripe | Checkout, subscriptions, webhooks |
| Email | Resend / SendGrid | Magic links, transactional |
| Analytics | PostHog (server-side) | Funnel events |
| Errors | Sentry (HTTP API) | Exception tracking |

### Key Design Decisions
- **No Supabase JS client** — D1 via parameterized SQL for Workers compat
- **Dash-based subdomains**: `{slug}-sites.megabyte.space` (not nested wildcards)
- **R2 paths**: `sites/{slug}/{version}/{file}`, marketing at `marketing/index.html`
- **Queues NOT yet enabled** — `QUEUE` binding is optional in Env type
- **CSP must include `'unsafe-inline'`** — homepage uses inline `<script>` tags
- **Content-type detection bug**: use `marketingPath` not `path` (path='/' has no extension)

---

# PART 5 — Required toolchain

## 5.1 Current monorepo tools
- **pnpm** workspace (but `pnpm install` fails due to electron-builder SSH dep)
- **npm install --legacy-peer-deps** in sub-packages (`apps/project-sites/`, `packages/shared/`)
- Worker dep: `@project-sites/shared` linked via `"file:../../packages/shared"`

## 5.2 Target toolchain (for new apps and migrations)
- **Nx** monorepo with **Nx Cloud** for remote caching and distributed CI execution
- **Angular** (SSR where applicable) for new UI apps
- **PrimeNG** as the primary component library
- **Ionic** (only if building mobile/PWA shells)
- **Storybook** for shared UI components, tokens, and UX regression checks

## 5.3 Testing
- **Vitest** for unit tests in the root app (required)
- **Jest** for unit tests in `apps/project-sites/` and `packages/shared/` (existing)
- **Playwright** for E2E (required, homepage-first)
- **ng-mocks** only when Angular DI/component isolation requires it (use sparingly)

## 5.4 API contracts and docs
- **Redocly CLI** for linting OpenAPI definitions, bundling multi-file specs, and building static HTML docs

## 5.5 Linting and formatting
Required:
- **ESLint** (TypeScript rules; Angular rules for Angular apps)
- **Prettier** (formatting)
- **`console.log` is blocked by eslint** — use `console.warn` for structured logs
- Local `eslint.config.mjs` in each sub-package (root `@blitz/eslint-plugin` not available)

Recommended:
- **Stylelint** (CSS/SCSS)
- **CSpell** (spellcheck for docs + copy + identifiers)
- **Markdownlint** (docs hygiene)
- **Knip** (unused exports/deps/files)

## 5.6 TypeScript / Build
- All packages use `"type": "module"` in package.json
- `moduleResolution: "Bundler"` in tsconfig
- `.js` extensions in imports (TypeScript resolves them)
- Typecheck: `npx tsc --noEmit` in each package

---

# PART 6 — AI-native product requirements (AI everywhere)

If AI can make the product easier, faster, safer, clearer, or reduce user effort, implement it.

## 6.1 Minimum AI surfaces
- Onboarding copilot: step-by-step "next action" guidance
- Natural-language search and filtering (permission-aware)
- Form assistants: autofill, validation explanations, suggested defaults
- "Explain this screen" contextual help
- Summarization for long content (logs, notifications, user content)
- Command palette with AI actions + navigation
- AI-driven support workflows (draft replies, triage tickets, suggest fixes)

## 6.2 AI operations and cost discipline
Every AI feature must:
- Be tenant-scoped and permission-aware
- Be behind server-enforced feature flags and kill switches
- Log prompt template versions + model config safely
- Have timeouts, budgets, truncation rules, and fallback behaviors

---

# PART 7 — Zod everywhere + human-first errors

## 7.1 Single source of truth
Zod schemas are the **SSOT** for request/response validation:
- Client validates before submit
- Server validates again at the boundary

## 7.2 Human-readable Zod errors (mandatory)
Never show raw Zod output to humans. Implement:
- `zodIssueToHumanMessage(issue)` and `zodErrorToFieldMap(error)`
- Consistent UI behavior: inline field errors + concise toast summary
- Stable error codes for automation and logging

## 7.3 Problem Details error envelope (mandatory)
All API errors must use an RFC7807-style envelope:
- Stable `code`
- `correlationId` / `requestId`
- Structured `errors[]` for validation
- "What to do next" for user-facing failures

---

# PART 8 — Distinguished-engineer error handling (everywhere)

## 8.1 Error taxonomy (required)
Maintain a central taxonomy with:
- Category (validation/auth/permission/upstream/timeout/internal...)
- Stable code
- Retry policy
- User-safe message
- Log severity mapping

## 8.2 Idempotency and retries (required)
- Every mutation is idempotent where possible
- Background jobs are safe to retry and safe to re-run
- External API calls: retry with backoff + jitter + circuit-breaking
- Create compensating actions for partial failures (sagas)

## 8.3 "Errors as UX"
- Friendly empty states with "Fix / Retry / Learn more"
- Support panel: copy correlationId + safe diagnostics
- Dedicated error routes/pages for 404/500 with recovery links
- No silent failures: always show status and next step

---

# PART 9 — Enriched logs, telemetry, and notifications

Because AI agents are the primary maintainers, logging is a first-class product.

## 9.1 Correlation everywhere (mandatory)
Every request/job/action must carry:
- requestId + traceId
- tenantId + userId (when known)
- Feature flag state (when relevant)

## 9.2 Structured logging schema (mandatory)
Every log line must be structured and include:
- service, env, eventName
- durationMs, status
- Error taxonomy code/category if failing
- safeContext only (PII redaction and secret redaction)

## 9.3 "Log enrichment" placement rules
Add high-signal logs at:
- Boundaries (incoming requests, validation)
- Policy decisions (RBAC checks, feature flags)
- State transitions (job starts/finishes, retries)
- External calls (provider calls, latency, result)
- All retry loops (attempt counts + next delay)

## 9.4 Notifications are actionable and enriched
Notifications must include:
- What happened
- Why it matters
- What to do next (deep links)
- Correlation metadata

For operational alerts:
- Include a short AI summary
- Include remediation steps and runbook links

---

# PART 10 — MANDATORY: Test-Driven Development (TDD)

> **ALL development in this repository MUST follow strict Test-Driven Development.**
> This is NON-NEGOTIABLE. No feature, bug fix, or refactor may be merged without tests.

## 10.1 TDD Workflow (Red -> Green -> Refactor)

1. **Write failing tests FIRST** — Before writing any implementation code, write unit tests that describe the expected behavior. Run them and confirm they fail.
2. **Write the minimum code to pass** — Implement just enough to make the tests pass.
3. **Refactor** — Clean up the implementation while keeping all tests green.
4. **Write E2E tests** — After the unit tests pass, write Playwright E2E tests that cover the full user flow.
5. **All tests must pass** — Run all test suites before considering any work complete.

## 10.2 Unit Test Requirements
- Every new function, route handler, or service method MUST have corresponding unit tests
- Test the happy path AND error/edge cases (invalid input, unauthorized, rate limiting, etc.)
- Mock external dependencies (D1, fetch, KV, R2) — never call real APIs in unit tests
- Minimum coverage expectation: all branches of new code must be tested
- Target: 100% coverage thresholds (statements/branches/functions/lines)

## 10.3 E2E Test Requirements (Playwright)
- Every user-facing feature MUST have E2E tests that cover the **complete user flow**
- **Absolute rule: every E2E starts from the homepage** — `goto("/")`, assert shell readiness, navigate by UI actions only
- All E2E tests must be: deterministic (no sleeps; only locator waits), parallel-safe, using stable selectors (`data-testid` or role-based)
- E2E tests for bolt.diy main app: `e2e/specs/` (96+ tests across 14 spec files)
- E2E tests for project-sites: `apps/project-sites/e2e/` (27+ spec files)
- Feature inventory: `e2e/FEATURES.md` — authoritative feature list
- Coverage mapping: `e2e/COVERAGE.yml` — every feature maps to spec files

## 10.4 Test Commands
```bash
# Root app (bolt.diy)
npm test                                              # Vitest unit tests
npx playwright test --config e2e/playwright.config.ts # E2E tests

# Project Sites Worker
cd apps/project-sites && npm test                     # Jest unit tests
cd apps/project-sites && npx playwright test          # E2E tests

# Shared Package
cd packages/shared && npm test                        # Jest unit tests

# All checks (unit + typecheck + lint + format)
cd apps/project-sites && npm run check
cd packages/shared && npm run check
```

## 10.5 Testing patterns
- **Jest config MUST be `.cjs`** (not `.js` or `.ts`) because `"type": "module"`
- Jest needs `moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }` for TS imports
- E2E: Use the custom fixture from `e2e/fixtures.ts` (blocks external CDN requests)
- Test counts: worker tests (25 suites) + shared tests (6 suites) + root E2E (14 files, 96+ tests)

---

# PART 11 — Feature inventory + coverage gate (mandatory)

## 11.1 Feature inventory files
- `e2e/FEATURES.md` — the authoritative feature list, grouped by product area
- `e2e/COVERAGE.yml` — maps every feature to one or more Playwright spec files
- CI gate: fail if any feature lacks coverage mapping

## 11.2 50-test minimum per product area
When applying this prompt to a new app or feature area, generate at least **50 Playwright tests** that:
- Start at homepage
- Cover nearly all features + critical edge cases
- Can run in parallel
- Are deterministic (no sleeps)
- Use stable selectors
- Use an isolated fixture strategy

## 11.3 E2E test blueprint (adapt to project entities)

### Group A — App shell, navigation, baseline quality (1-10)
1. Home renders and shell ready
2. Global nav works (sidebar)
3. Theme toggle persists
4. Not found UX (404)
5. Loading skeletons
6. Responsive layout (mobile/tablet/desktop)
7. Keyboard shortcuts
8. Performance smoke (no hangs)
9. Error banner + correlation ID
10. Copy readability presence

### Group B — Auth and identity (11-20)
11. Sign up / sign in
12. Sign out
13. Session expiry recovery
14. OTP/passwordless (magic link)
15. Google OAuth
16. Profile update
17. RBAC denial UX
18. Session management

### Group C — Core domain features (21-35)
21. Create entity (Chat / Site)
22. View entity details
23. Edit entity
24. Delete entity
25. Validation errors are human-readable
26. Pagination/infinite scroll
27. Sort/filter
28. Search
29. Chat streaming
30. Chat history
31. Chat persistence
32. Provider/model configuration
33. File management
34. Code editor
35. Live preview + terminal

### Group D — Deployment & integrations (36-45)
36. Deploy menu
37. GitHub deploy
38. Netlify deploy
39. Vercel deploy
40. Stripe checkout
41. Billing portal
42. Custom domains
43. Site serving
44. Webhook handling
45. Email (magic link)

### Group E — AI features & edge cases (46-50+)
46. AI site generation workflow
47. AI explain screen
48. AI search (permission-aware)
49. Rate limit UX is friendly
50. Stream recovery on network failure

---

# PART 12 — Quantitative quality gates (required)

## 12.1 Readability gate for copy (Flesch Reading Ease >= 50)
All user-facing copy should meet **Flesch Reading Ease >= 50**.

## 12.2 Additional quantitative gates (recommended)
- Complexity: enforce max cyclomatic complexity in lint rules
- Dead code: run Knip in CI on main
- Spellcheck: CSpell in CI (docs + UI copy)
- Bundle budgets: fail if route bundles exceed thresholds
- API contract: lint OpenAPI, fail on breaking changes
- Coverage thresholds: Unit 100%, E2E 100% feature coverage via inventory

---

# PART 13 — Documentation standards

Documentation must be good enough that another AI agent can safely operate and evolve the system.

## 13.1 JSDoc/TypeDoc requirements (mandatory on all exports)
Every exported symbol must include:
- `@remarks` (why)
- `@example` (copy/paste runnable)
- `@throws` (mapped to taxonomy)
- `@see` / `@link` to docs or related APIs

## 13.2 Docs required in `/docs`
- `docs/ARCHITECTURE.md` (include Mermaid diagrams)
- `docs/DEPLOYMENT.md` (dev/test/deploy)
- `docs/REQUIREMENTS.md` (full requirements)
- `docs/PROMPTS.md` (prompt infrastructure guide)

## 13.3 Further documentation
- **[apps/project-sites/CLAUDE.md](apps/project-sites/CLAUDE.md)** — Worker API surface, middleware, services
- **[apps/project-sites/PROJECT_GUIDE.md](apps/project-sites/PROJECT_GUIDE.md)** — Complete build guide (1000+ lines)
- **[packages/shared/CLAUDE.md](packages/shared/CLAUDE.md)** — Schemas, constants, utilities

---

# PART 14 — MANDATORY: Auto-Deploy After Each Session

> **After completing all changes**, you MUST deploy to staging (and production if on main).
> If `CLOUDFLARE_API_KEY` and `CLOUDFLARE_EMAIL` are not set as environment variables,
> **ask the user to provide them** before deploying.

## Deploy Checklist
1. Run all unit tests (`npm test` in both packages) — all must pass
2. Run E2E tests (`npx playwright test`) — all must pass
3. Run typecheck (`npm run typecheck`) — no errors
4. Run lint (`npm run lint`) — no errors
5. Deploy to staging: `cd apps/project-sites && npx wrangler deploy --env staging`
6. Upload marketing homepage: `npx wrangler r2 object put project-sites-staging/marketing/index.html --file public/index.html --content-type text/html --remote`
7. If on main branch, also deploy to production after verifying staging

## Deployment Credentials
- **CLOUDFLARE_API_KEY** and **CLOUDFLARE_EMAIL** must be set as env vars for `wrangler deploy`
- If not available, **ASK THE USER** for these credentials before deploying
- **NEVER** modify secrets that are already set in the Cloudflare dashboard (Stripe keys, SendGrid, Google OAuth, etc.)
- Only use `wrangler secret put` when explicitly asked to set a NEW secret

---

# PART 15 — Critical Development Patterns

## Git / File Operations
- **`.gitignore` blocks `*.md`** — ALWAYS use `git add -f` for markdown files
- Never push to main/master without explicit permission

## Package Management
- pnpm workspace defined but `pnpm install` fails (electron-builder SSH dep)
- **Use `npm install --legacy-peer-deps`** in sub-packages (`apps/project-sites/`, `packages/shared/`)
- Worker dep: `@project-sites/shared` linked via `"file:../../packages/shared"`

## Scripts (in each sub-package)
```bash
npm test              # Run unit tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
npm run typecheck     # tsc --noEmit
npm run lint          # ESLint
npm run format        # Prettier write
npm run format:check  # Prettier check
npm run check         # All of the above
```

## Linting
- Local `eslint.config.mjs` in each sub-package (root `@blitz/eslint-plugin` not available)
- **`console.log` is blocked by eslint** — use `console.warn` for structured logs
- Run: `npx eslint --config eslint.config.mjs src` in each package

---

# PART 16 — Cloudflare Resource IDs & Deployment

## Resource IDs
| Resource | ID |
|----------|-----|
| Account | `84fa0d1b16ff8086dd958c468ce7fd59` |
| Zone (megabyte.space) | `75a6f8d5e441cd7124552976ba894f83` |
| Pages (bolt-diy) | `76c34b4f-1bd1-410c-af32-74fd8ee3b23f` |
| D1 dev | `f5b59818-c785-4807-8aca-282c9037c58c` |
| D1 staging | `7bdf6256-7b5d-417f-9b29-c7466ec78508` |
| D1 production | `ea3e839a-c641-4861-ae30-dfc63bff8032` |

## Deployment Environments
| Environment | Worker | URL |
|------------|--------|-----|
| Production | `project-sites` | `sites.megabyte.space` |
| Staging | `project-sites-staging` | `sites-staging.megabyte.space` |
| Pages (prod) | bolt-diy | `bolt.megabyte.space` |
| Pages (staging) | bolt-diy | `bolt-staging.megabyte.space` |

```bash
# Deploy worker (uses CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL env vars)
cd apps/project-sites && npx wrangler deploy --env staging
cd apps/project-sites && npx wrangler deploy --env production

# Upload marketing homepage to R2
npx wrangler r2 object put project-sites-staging/marketing/index.html --file public/index.html --content-type text/html --remote
```

---

# PART 17 — WebContainer / Cross-Origin Isolation (bolt.diy Main App)

## Cross-Origin Headers
- `public/_headers` serves COOP/COEP headers for Cloudflare Pages
- Required for `SharedArrayBuffer` which WebContainers need
- Headers: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`, `Origin-Agent-Cluster: ?1`
- Verify on deployed site: `crossOriginIsolated` should be `true` in DevTools console

## WebContainer Iframe Override
- `globalThis.WEBCONTAINER_API_IFRAME_URL` is set in `app/root.tsx` Head before app bundle loads
- This overrides the default `/headless` iframe URL used by `@webcontainer/api`
- WebContainer.boot() is called in `app/lib/webcontainer/index.ts` with `coep: 'credentialless'`
- If WebContainer fails to boot/populate, check: (1) cross-origin headers, (2) WEBCONTAINER_API_IFRAME_URL, (3) browser privacy/tracking blocking

## Browser Compatibility
- Third-party storage/cookies blocking can break WebContainer in subtle ways
- Users may need to add site exceptions for `stackblitz.com`, `webcontainer.io`, `webcontainer-api.io`
- Preview iframe at `app/routes/webcontainer.preview.$id.tsx` uses `sandbox` and `allow="cross-origin-isolated"`

---

# PART 18 — Email Configuration (Project Sites Worker)

## Provider Stack
- **Primary**: Resend (`RESEND_API_KEY` secret)
- **Fallback**: SendGrid (`SENDGRID_API_KEY` secret)
- Both are optional in `Env` interface and config schema
- If neither is configured, magic link emails will fail with "Email delivery is not configured"
- From address: `noreply@megabyte.space` — domain must be verified in provider

## After Deploying, Verify Secrets Are Set
```bash
# List secrets (requires CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL)
npx wrangler secret list --env staging
npx wrangler secret list --env production

# Set a secret if missing
npx wrangler secret put SENDGRID_API_KEY --env staging
npx wrangler secret put RESEND_API_KEY --env staging
```

## Phone Feature Was Removed
- Commit `b555680` removed: Twilio SMS, phone OTP endpoints, phone schemas
- `phone_otps` D1 table still exists but is unused (orphaned)
- `users.phone` column still exists but always set to NULL
- No Twilio secrets needed anymore

---

# PART 19 — UI Design Rules (Marketing Homepage)

## Icons
- Feature icons should NOT have background boxes or borders — just the SVG icon floating freely
- SVG icons use `stroke="currentColor"` with appropriate `stroke-width` (1.5-2.5)
- No `border-radius` + `background` containers around individual icons

## General Style
- Dark theme: `--bg-primary: #0a0a1a`, accent `#64ffda`, secondary `#7c3aed`
- Cards have subtle borders: `1px solid var(--border)` with `var(--border): rgba(100, 255, 218, 0.1)`
- Hover states: `translateY(-3px)`, `border-color: var(--border-hover)`, accent glow shadow

---

# PART 20 — CI/CD on GitHub Actions (Cloudflare-optimized)

## 20.1 CI principles
- Fast PR feedback via affected change detection
- Full verification on main
- Deploy to Cloudflare only after all gates pass

## 20.2 Required stages (in order)
1. Install + compute affected packages
2. Format check
3. Lint (ESLint)
4. Typecheck
5. Unit tests (with coverage thresholds)
6. Build (affected)
7. E2E smoke on PR; full E2E on main
8. Deploy (main only) via Wrangler / Pages action

---

# PART 21 — Hard Gate: E2E Verification (non-negotiable)

You may NOT declare a task complete until you have:
1. Implemented Playwright E2E tests that cover every feature and edge case in scope.
2. RUN the E2E suite locally (headless) and confirmed it passes.
3. Included in your final message:
   - The exact commands you ran (copy/paste)
   - A brief summary of results (pass/fail) for unit/integration/e2e
   - If any test initially failed, describe the fix you made.

If you cannot actually execute commands in your environment, you must still:
- Write E2E tests that are deterministic (no sleeps, stable selectors)
- Include a "Self-check protocol" section that simulates execution
- Do not stop until all flows are covered and consistent with the implementation

---

# PART 22 — Verification Log template (must appear in final message)

```md
## Verification Log
Commands run:
- npm test: ...
- npm run typecheck: ...
- npm run lint: ...
- npx playwright test --config e2e/playwright.config.ts: ...
- cd apps/project-sites && npm test: ...
- cd apps/project-sites && npx playwright test: ...

Results:
- Unit: PASS/FAIL (coverage: X%)
- E2E: PASS/FAIL (tests: N, parallel: yes/no)

Fix notes:
- If any test initially failed: what failed and what was changed to fix it.
```

---

# PART 23 — Final Combined Master Prompt (for quick reference)

```
You are Claude Code operating under this repo's CLAUDE.md.

Start with: Purpose Discovery -> Feature Inventory -> generate homepage-first Playwright tests (parallel-safe) -> then implement features.

Non-negotiables:
- Cloudflare-first only; Neon/Upstash only if Cloudflare primitives cannot meet requirements.
- E2E-TDD Playwright is primary proof; every E2E starts at homepage (/).
- 100% feature coverage via e2e/FEATURES.md and e2e/COVERAGE.yml (CI enforced).
- 100% unit coverage via test thresholds.
- ESLint + Prettier (+ Stylelint + CSpell + Markdownlint recommended).
- Flesch Reading Ease >= 50 for user-facing copy.

Hard Gate: E2E Verification (non-negotiable)
(See PART 21 above.)

Process:
1) Inventory repo scripts, architecture, bindings, existing tests.
2) Propose an incremental roadmap where each step includes: tests + docs updates.
3) For each step: write failing tests first -> implement minimal -> refactor -> rerun gates.
4) End every deliverable with a Verification Log (exact commands, pass/fail).
```
