# bolt.diy Monorepo — AI Context Guide

> **Purpose**: This file is the primary AI onboarding document for the bolt.diy monorepo.
> A new Claude Code session reading only this file should understand the project structure,
> development patterns, and how to get productive immediately.

## Quick Orientation

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
├── supabase/migrations/          # Reference Postgres schema (D1 SQLite used in prod)
├── docs/                         # MkDocs documentation site
├── electron/                     # Electron desktop wrapper
└── .github/workflows/            # CI/CD pipelines
```

## MANDATORY: Test-Driven Development (TDD)

> **ALL development in this repository MUST follow strict Test-Driven Development.**
> This is NON-NEGOTIABLE. No feature, bug fix, or refactor may be merged without tests.

### TDD Workflow (Red → Green → Refactor)

1. **Write failing tests FIRST** — Before writing any implementation code, write unit tests that describe the expected behavior. Run them and confirm they fail.
2. **Write the minimum code to pass** — Implement just enough to make the tests pass.
3. **Refactor** — Clean up the implementation while keeping all tests green.
4. **Write E2E tests** — After the unit tests pass, write Playwright E2E tests that cover the full user flow (see below).
5. **All tests must pass** — Run `npm test` in both `packages/shared/` and `apps/project-sites/`, plus `npx playwright test` for E2E, before considering any work complete.

### Unit Test Requirements
- Every new function, route handler, or service method MUST have corresponding unit tests
- Test the happy path AND error/edge cases (invalid input, unauthorized, rate limiting, etc.)
- Mock external dependencies (D1, fetch, KV, R2) — never call real APIs in unit tests
- Minimum coverage expectation: all branches of new code must be tested

### E2E Test Requirements (Playwright)
- Every user-facing feature MUST have E2E tests that cover the **complete user flow**
- E2E flows should cover realistic scenarios end-to-end:
  - Loading the marketing homepage
  - Searching for a business
  - Selecting a result from the dropdown
  - Navigating to the details screen
  - Signing in (Google OAuth or Email Magic Link)
  - Triggering a website build
  - Verifying the waiting/progress screen
  - Verifying the built site is accessible
- E2E test files live in `apps/project-sites/e2e/`
- Use the custom fixture from `e2e/fixtures.ts` (blocks external CDN requests)
- Run with: `npx playwright test` in `apps/project-sites/`

### Test Commands
```bash
# Unit tests
cd apps/project-sites && npm test
cd packages/shared && npm test

# E2E tests
cd apps/project-sites && npx playwright test

# All checks (unit + typecheck + lint + format)
cd apps/project-sites && npm run check
cd packages/shared && npm run check
```

## MANDATORY: Auto-Deploy After Each Session

> **After completing all changes**, you MUST deploy to staging (and production if on main).
> If `CLOUDFLARE_API_KEY` and `CLOUDFLARE_EMAIL` are not set as environment variables,
> **ask the user to provide them** before deploying.

### Deploy Checklist
1. Run all unit tests (`npm test` in both packages) — all must pass
2. Run E2E tests (`npx playwright test`) — all must pass
3. Run typecheck (`npm run typecheck`) — no errors
4. Run lint (`npm run lint`) — no errors
5. Deploy to staging: `cd apps/project-sites && npx wrangler deploy --env staging`
6. Upload marketing homepage: `npx wrangler r2 object put project-sites-staging/marketing/index.html --file public/index.html --content-type text/html --remote`
7. If on main branch, also deploy to production after verifying staging

### Deployment Credentials
- **CLOUDFLARE_API_KEY** and **CLOUDFLARE_EMAIL** must be set as env vars for `wrangler deploy`
- If not available, **ASK THE USER** for these credentials before deploying
- **NEVER** modify secrets that are already set in the Cloudflare dashboard (Stripe keys, SendGrid, Google OAuth, etc.)
- Only use `wrangler secret put` when explicitly asked to set a NEW secret

## Critical Development Patterns

### Git / File Operations
- **`.gitignore` blocks `*.md`** — ALWAYS use `git add -f` for markdown files
- Development branch: `claude/setup-cloudflare-workers-gDWiV`
- Never push to main/master without explicit permission

### Package Management
- pnpm workspace defined but `pnpm install` fails (electron-builder SSH dep)
- **Use `npm install --legacy-peer-deps`** in sub-packages (`apps/project-sites/`, `packages/shared/`)
- Worker dep: `@project-sites/shared` linked via `"file:../../packages/shared"`

### TypeScript / Build
- All packages use `"type": "module"` in package.json
- `moduleResolution: "Bundler"` in tsconfig
- `.js` extensions in imports (TypeScript resolves them)
- Typecheck: `npx tsc --noEmit` in each package

### Testing
- **Jest config MUST be `.cjs`** (not `.js` or `.ts`) because `"type": "module"`
- Jest needs `moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' }` for TS imports
- Test counts: worker tests (25 suites) + shared tests (6 suites) + E2E (6 files)
- Run: `npm test` in `apps/project-sites/` or `packages/shared/`
- E2E: Playwright, run with `npx playwright test` in `apps/project-sites/`

### Linting
- Local `eslint.config.mjs` in each sub-package (root `@blitz/eslint-plugin` not available)
- **`console.log` is blocked by eslint** — use `console.warn` for structured logs
- Run: `npx eslint --config eslint.config.mjs src` in each package

### Scripts (in each sub-package)
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

## Architecture at a Glance

### Project Sites Worker Stack
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

## Cloudflare Resource IDs
| Resource | ID |
|----------|-----|
| Account | `84fa0d1b16ff8086dd958c468ce7fd59` |
| Zone (megabyte.space) | `75a6f8d5e441cd7124552976ba894f83` |
| Pages (bolt-diy) | `76c34b4f-1bd1-410c-af32-74fd8ee3b23f` |
| D1 dev | `f5b59818-c785-4807-8aca-282c9037c58c` |
| D1 staging | `7bdf6256-7b5d-417f-9b29-c7466ec78508` |
| D1 production | `ea3e839a-c641-4861-ae30-dfc63bff8032` |

## Deployment
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

## WebContainer / Cross-Origin Isolation (bolt.diy Main App)

### Cross-Origin Headers
- `public/_headers` serves COOP/COEP headers for Cloudflare Pages
- Required for `SharedArrayBuffer` which WebContainers need
- Headers: `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: credentialless`, `Origin-Agent-Cluster: ?1`
- Verify on deployed site: `crossOriginIsolated` should be `true` in DevTools console

### WebContainer Iframe Override
- `globalThis.WEBCONTAINER_API_IFRAME_URL` is set in `app/root.tsx` Head before app bundle loads
- This overrides the default `/headless` iframe URL used by `@webcontainer/api`
- WebContainer.boot() is called in `app/lib/webcontainer/index.ts` with `coep: 'credentialless'`
- If WebContainer fails to boot/populate, check: (1) cross-origin headers, (2) WEBCONTAINER_API_IFRAME_URL, (3) browser privacy/tracking blocking

### Browser Compatibility
- Third-party storage/cookies blocking can break WebContainer in subtle ways
- Users may need to add site exceptions for `stackblitz.com`, `webcontainer.io`, `webcontainer-api.io`
- Preview iframe at `app/routes/webcontainer.preview.$id.tsx` uses `sandbox` and `allow="cross-origin-isolated"`

## Email Configuration (Project Sites Worker)

### Provider Stack
- **Primary**: Resend (`RESEND_API_KEY` secret)
- **Fallback**: SendGrid (`SENDGRID_API_KEY` secret)
- Both are optional in `Env` interface and config schema
- If neither is configured, magic link emails will fail with "Email delivery is not configured"
- From address: `noreply@megabyte.space` — domain must be verified in provider

### After Deploying, Verify Secrets Are Set
```bash
# List secrets (requires CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL)
npx wrangler secret list --env staging
npx wrangler secret list --env production

# Set a secret if missing
npx wrangler secret put SENDGRID_API_KEY --env staging
npx wrangler secret put RESEND_API_KEY --env staging
```

### Phone Feature Was Removed
- Commit `b555680` removed: Twilio SMS, phone OTP endpoints, phone schemas
- `phone_otps` D1 table still exists but is unused (orphaned)
- `users.phone` column still exists but always set to NULL
- No Twilio secrets needed anymore (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` removed)

## UI Design Rules (Marketing Homepage)

### Icons
- Feature icons should NOT have background boxes or borders — just the SVG icon floating freely
- SVG icons use `stroke="currentColor"` with appropriate `stroke-width` (1.5–2.5)
- No `border-radius` + `background` containers around individual icons

### General Style
- Dark theme: `--bg-primary: #0a0a1a`, accent `#64ffda`, secondary `#7c3aed`
- Cards have subtle borders: `1px solid var(--border)` with `var(--border): rgba(100, 255, 218, 0.1)`
- Hover states: `translateY(-3px)`, `border-color: var(--border-hover)`, accent glow shadow

## Further Documentation

- **[apps/project-sites/CLAUDE.md](apps/project-sites/CLAUDE.md)** — Worker API surface, middleware, services
- **[apps/project-sites/PROJECT_GUIDE.md](apps/project-sites/PROJECT_GUIDE.md)** — Complete build guide (1000+ lines)
- **[packages/shared/CLAUDE.md](packages/shared/CLAUDE.md)** — Schemas, constants, utilities
- **[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)** — Full requirements from all prompts
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Detailed architecture decisions
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — Deployment & CI/CD guide
- **[docs/PROMPTS.md](docs/PROMPTS.md)** — Prompt infrastructure guide
