# Project Sites - Setup Guide

## Prerequisites

- Node.js >= 18.18.0
- pnpm >= 9.14.4
- Wrangler CLI (`npm install -g wrangler`)
- Supabase CLI (for local development)

## Monorepo Structure

```
bolt.diy/                        # Root (bolt.diy Cloudflare Pages app)
├── apps/project-sites/          # Cloudflare Worker (Hono)
├── packages/shared/             # Shared Zod schemas, types, utilities
├── supabase/migrations/         # Supabase Postgres migrations
├── .github/workflows/           # CI/CD pipelines
└── pnpm-workspace.yaml          # Workspace config
```

## Getting Started

### 1. Install Dependencies

```bash
# From repo root
pnpm install
```

### 2. Configure Secrets

Secrets are managed via Wrangler and should NEVER be committed.

```bash
cd apps/project-sites

# Set environment variables for wrangler auth
export CLOUDFLARE_API_KEY="your-global-api-key"
export CLOUDFLARE_EMAIL="your-email"

# Staging secrets (use TEST Stripe keys)
npx wrangler secret put SUPABASE_URL --env staging
npx wrangler secret put SUPABASE_ANON_KEY --env staging
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env staging
npx wrangler secret put STRIPE_SECRET_KEY --env staging
npx wrangler secret put STRIPE_PUBLISHABLE_KEY --env staging
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env staging
npx wrangler secret put CF_API_TOKEN --env staging
npx wrangler secret put CF_ZONE_ID --env staging
npx wrangler secret put SENDGRID_API_KEY --env staging
npx wrangler secret put GOOGLE_CLIENT_ID --env staging
npx wrangler secret put GOOGLE_CLIENT_SECRET --env staging
npx wrangler secret put GOOGLE_PLACES_API_KEY --env staging
npx wrangler secret put SENTRY_DSN --env staging

# Production secrets (use LIVE Stripe keys)
# Same commands with --env production
```

**Important**: If any secret is ever exposed in chat/logs/git, rotate it immediately in the provider's dashboard.

### 3. Run Tests

```bash
# Shared package tests
cd packages/shared && npx jest --config jest.config.cjs

# Worker tests
cd apps/project-sites && npx jest --config jest.config.cjs
```

### 4. Local Development

```bash
cd apps/project-sites
npx wrangler dev
```

### 5. Deploy

```bash
# Staging
cd apps/project-sites && npx wrangler deploy --env staging

# Production
cd apps/project-sites && npx wrangler deploy --env production
```

## Environment Configuration

### Required Secrets (per environment)

| Secret | Description | Test/Staging | Production |
|--------|-------------|:---:|:---:|
| `SUPABASE_URL` | Supabase project URL | Required | Required |
| `SUPABASE_ANON_KEY` | Public anon key | Required | Required |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service role | Required | Required |
| `STRIPE_SECRET_KEY` | Stripe secret key | `sk_test_*` | `sk_live_*` |
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable key | `pk_test_*` | `pk_live_*` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing | Required | Required |
| `CF_API_TOKEN` | Cloudflare API token | Required | Required |
| `CF_ZONE_ID` | Cloudflare zone ID | Required | Required |
| `SENDGRID_API_KEY` | SendGrid API key | Required | Required |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Required | Required |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | Required | Required |
| `GOOGLE_PLACES_API_KEY` | Places autocomplete | Required | Required |
| `SENTRY_DSN` | Sentry error tracking | Required | Required |

### Optional Secrets

| Secret | Description |
|--------|-------------|
| `OPENAI_API_KEY` | OpenAI for AI generation |
| `OPEN_ROUTER_API_KEY` | OpenRouter for LLM routing |
| `CHATWOOT_API_URL` | Chatwoot communications |
| `CHATWOOT_API_KEY` | Chatwoot API key |
| `NOVU_API_KEY` | Novu workflow engine |
| `SALE_WEBHOOK_URL` | External sale webhook |
| `SALE_WEBHOOK_SECRET` | Sale webhook HMAC secret |

### Stripe Key Safety

- **Production** environment MUST use live Stripe keys (`sk_live_*`, `pk_live_*`)
- **All other** environments MUST use test Stripe keys (`sk_test_*`, `pk_test_*`)
- Boot validation will **crash** the Worker if keys don't match the environment

## Database Migrations

Migrations are in `supabase/migrations/`. Apply them via:

```bash
npx supabase db push
```

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/project-sites.yaml`) runs:

1. **Lint + Typecheck** on PR
2. **Unit + Integration Tests** on PR
3. **Deploy to Staging** on merge to main
4. **E2E Tests against Staging**
5. **Deploy to Production** (after staging E2E passes)
6. **Post-deploy Production E2E** (with automatic rollback on failure)

## Architecture

- **Worker**: Hono-based API + site serving router
- **KV**: Host-to-site cache (`host:{hostname}` -> site metadata)
- **R2**: Static site builds (`sites/{slug}/{version}/...`)
- **Queue**: Workflow job transport
- **Supabase**: System-of-record (Postgres + RLS)
