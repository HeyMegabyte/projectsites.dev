# Project Sites Setup Guide

This document describes how to set up and deploy Project Sites - a Cloudflare Workers-based website delivery platform.

## Architecture Overview

```
bolt.diy/
├── apps/
│   └── project-sites/          # Cloudflare Worker (API + site serving)
├── packages/
│   └── shared/                 # Shared types, schemas, utilities
├── supabase/
│   └── migrations/             # Database migrations (to be added)
├── cypress/                    # E2E tests
└── .github/workflows/          # CI/CD pipelines
```

## Prerequisites

- Node.js >= 18.18.0
- pnpm >= 9.14.4
- Cloudflare account with Workers, R2, KV, and Queues enabled
- Supabase project
- Stripe account

## Local Development Setup

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Build Shared Package

```bash
pnpm --filter @project-sites/shared build
```

### 3. Configure Environment

Create `.dev.vars` in `apps/project-sites/`:

```bash
# Do NOT commit this file - it contains secrets

# Environment
ENVIRONMENT=development
LOG_LEVEL=debug

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Stripe (use TEST keys for development)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Cloudflare
CF_API_TOKEN=your-cf-api-token
CF_ZONE_ID=your-zone-id
CF_ACCOUNT_ID=your-account-id

# AI Providers
OPENAI_API_KEY=sk-...
OPEN_ROUTER_API_KEY=sk-or-...

# Google
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_PLACES_API_KEY=your-places-api-key

# External Services
SENDGRID_API_KEY=SG....
CHATWOOT_API_URL=https://app.chatwoot.com
CHATWOOT_API_KEY=your-chatwoot-key
NOVU_API_KEY=your-novu-key

# Observability
SENTRY_DSN=https://xxx@sentry.io/123

# Sale Webhook (optional)
SALE_WEBHOOK_URL=https://your-webhook-endpoint.com/sale
SALE_WEBHOOK_SECRET=your-webhook-secret
```

### 4. Run Development Server

```bash
cd apps/project-sites
pnpm dev
```

The worker will be available at `http://localhost:8787`.

## Running Tests

### Unit Tests

```bash
# Run all tests
pnpm --filter @project-sites/shared test
pnpm --filter @project-sites/worker test

# Watch mode
pnpm --filter @project-sites/shared test:watch

# With coverage
pnpm --filter @project-sites/shared test:coverage
```

### E2E Tests

```bash
# Run Cypress locally
npx cypress open

# Run headless
npx cypress run --config baseUrl=http://localhost:8787
```

## Cloudflare Resources Setup

### 1. Create KV Namespace

```bash
wrangler kv:namespace create CACHE_KV
wrangler kv:namespace create CACHE_KV --preview
```

Update `wrangler.toml` with the returned IDs.

### 2. Create R2 Bucket

```bash
wrangler r2 bucket create project-sites
wrangler r2 bucket create project-sites-staging
wrangler r2 bucket create project-sites-preview
```

### 3. Create Queue

```bash
wrangler queues create project-sites-workflows
wrangler queues create project-sites-workflows-staging
wrangler queues create project-sites-dlq
```

### 4. Set Secrets

```bash
# Development
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_ANON_KEY
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_PUBLISHABLE_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
# ... etc

# Staging
wrangler secret put STRIPE_SECRET_KEY --env staging
# ... etc

# Production
wrangler secret put STRIPE_SECRET_KEY --env production
# ... etc
```

**IMPORTANT:** Production must use live Stripe keys. Staging/development must use test keys.

## Deployment

### Manual Deployment

```bash
# Deploy to staging
cd apps/project-sites
pnpm deploy:staging

# Deploy to production
pnpm deploy:production
```

### CI/CD Deployment

Deployments are automated via GitHub Actions:

1. Push to `main` triggers staging deployment
2. After staging E2E passes, production deployment begins
3. After production E2E passes, deployment is complete
4. If production E2E fails, automatic rollback is initiated

### Required GitHub Secrets

- `CLOUDFLARE_API_TOKEN` - Cloudflare API token with Workers/R2/KV/Queues permissions
- `CLOUDFLARE_ACCOUNT_ID` - Your Cloudflare account ID

## Supabase Setup

### 1. Create Tables

Run the migrations in `supabase/migrations/` (to be added):

```bash
supabase db push
```

### 2. Enable RLS

All tables have Row Level Security enabled by default.

### 3. Configure Auth

In Supabase dashboard:
- Enable Email Magic Links
- Enable Phone (SMS) OTP
- Enable Google OAuth
- Configure redirect URLs

## Stripe Setup

### 1. Create Products and Prices

- Create a product: "Project Sites Subscription"
- Create a price: $50/month recurring

### 2. Configure Webhooks

In Stripe dashboard, add webhook endpoint:
- URL: `https://sites.megabyte.space/webhooks/stripe` (production)
- URL: `https://sites-staging.megabyte.space/webhooks/stripe` (staging)

Enable events:
- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

### 3. Enable Stripe Link

In Stripe dashboard, ensure Stripe Link is enabled for faster checkout.

## Custom Domains (Cloudflare for SaaS)

### 1. Enable Cloudflare for SaaS

In Cloudflare dashboard, enable SSL for SaaS on the zone.

### 2. Configure Fallback Origin

Set the fallback origin to the Worker:
```
sites.megabyte.space
```

### 3. Provisioning

Custom domains are provisioned automatically when:
- User completes checkout
- User adds a custom domain in dashboard

## Monitoring

### Cloudflare Analytics

Available in Cloudflare dashboard for the Worker.

### Sentry

All errors are captured and sent to Sentry with:
- Request ID
- Trace ID
- User/Org context (when available)

### Structured Logs

Logs are in JSON format with:
- `level`: debug/info/warn/error
- `type`: request/response/webhook/error
- `request_id`: unique per request
- `trace_id`: unique per trace

## Security Considerations

1. **Never commit secrets** - Use `.dev.vars` locally and `wrangler secret put` for deployment
2. **Validate all inputs** - All requests are validated with Zod schemas
3. **Webhook signatures** - All webhooks verify signatures
4. **Idempotency** - All webhooks and jobs are idempotent
5. **Rate limiting** - Auth and expensive endpoints are rate limited
6. **RLS** - All database access respects Row Level Security

## Troubleshooting

### Worker not deploying

Check:
- Cloudflare API token permissions
- Wrangler version compatibility
- Build errors in `apps/project-sites`

### Tests failing

Check:
- Shared package is built (`pnpm --filter @project-sites/shared build`)
- Environment variables are set
- KV/R2 bindings are configured for tests

### Webhooks not processing

Check:
- Webhook signature verification
- Idempotency key collisions
- Queue consumer is running

## Support

For issues, contact: hey@megabyte.space
