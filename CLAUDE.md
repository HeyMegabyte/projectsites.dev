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
- Test counts: 527 worker tests (25 suites) + 367 shared tests (6 suites) + E2E
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
| Email | SendGrid | Magic links, transactional |
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

## Further Documentation

- **[apps/project-sites/CLAUDE.md](apps/project-sites/CLAUDE.md)** — Worker API surface, middleware, services
- **[apps/project-sites/PROJECT_GUIDE.md](apps/project-sites/PROJECT_GUIDE.md)** — Complete build guide (1000+ lines)
- **[packages/shared/CLAUDE.md](packages/shared/CLAUDE.md)** — Schemas, constants, utilities
- **[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md)** — Full requirements from all prompts
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Detailed architecture decisions
- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — Deployment & CI/CD guide
- **[docs/PROMPTS.md](docs/PROMPTS.md)** — Prompt infrastructure guide
