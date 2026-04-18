# Project Sites Worker — AI Context Guide

> Cloudflare Worker powering the SaaS website delivery engine at `projectsites.dev`.
> Built with Hono framework, Cloudflare D1/KV/R2/Workflows/AI.
>
> **Template repo:** https://github.com/HeyMegabyte/projectsites-template

## Website Generation Philosophy (CRITICAL — read this first)

**Our goal: Generate enterprise-grade, industry-leading websites that BEAT any existing website.** We don't copy sites — we take any website and use AI to make it dramatically better. Every generated site must be more beautiful, more accessible, better structured, faster loading, and better optimized for SEO/conversions than the source. We specialize in information-dense sites: take sprawling, poorly-organized original websites and condense them into gorgeous, well-organized, modern designs that pack MORE useful information into FEWER, better-designed pages.

**Quality bar: The generated website must be so good that the business owner would prefer it over their original.** Think: "What if Stripe's design team rebuilt this local business's website?"

**A perfect website CANNOT be created with a single prompt.** It requires 20-30 iterative, specialized prompts — just like a Principal Software Engineer needs 20+ detailed prompts to deploy a normal website. The system must spread the load across many prompts to circumvent single-prompt limitations.

### Benchmark Sites (use for testing & quality validation)

| Site | URL | Type | What We Improve |
|------|-----|------|----------------|
| **whitehouse.gov** | https://www.whitehouse.gov | Government / Information | Condense sprawling navigation into a clean, gorgeous homepage. Keep ALL important content but present it more beautifully. More information above the fold. Better visual hierarchy. |
| **njsk.org** | https://www.njsk.org | Non-Profit / Soup Kitchen | Bundle 20+ scattered pages into 3-4 well-organized pages + a blog. Make it gorgeous with warm, dignified colors. Add donation CTA, impact counters, volunteer signup. Keep all original content. |

**How to use benchmarks:**
1. Deep-crawl the original site (all pages, all content)
2. Generate our version using the full pipeline
3. Compare: our version must have ALL the original content, but better organized
4. Visual comparison: our version must look more professional, more modern
5. Lighthouse comparison: our version must score higher on all metrics
6. SEO comparison: our version must have better meta tags, schema, keywords

**For information-heavy sites (like whitehouse.gov):**
- The homepage should pack MORE useful information than the original
- Navigation should be cleaner (3-4 pages max vs. hundreds)
- Content should be reorganized by user intent, not org structure
- Blog/news section should be auto-generated from scraped articles

**For community/non-profit sites (like njsk.org):**
- Bundle scattered pages into cohesive sections
- Generate a blog from existing news/updates content
- Add prominent donation/volunteer CTAs
- Use warm, inviting, professional colors (not generic)

**See:** `memory/project_prompt_philosophy.md` for the full 30-prompt pipeline specification.

### The Pipeline (6 phases, 25-30 prompts, parallel where possible)

| Phase | Prompts | Parallel? | Duration |
|-------|---------|-----------|----------|
| 1. Research & Planning | 7 prompts (profile, brand, social, USPs, images, deep-crawl, structure) | 5 parallel + 2 sequential | ~3 min |
| 2. Asset Generation | 5 prompts (logo, favicon, hero images, section images, multimedia discovery) | All parallel | ~5 min |
| 3. Website Generation | 5 prompts (base HTML, animations, SEO meta, content, images) | Sequential | ~10 min |
| 4. Inspection & Fixes | 3 prompts (visual inspect via screenshot, fix issues, accessibility audit) | Sequential | ~5 min |
| 5. Quality & Safety | 5 prompts (quality gate, SEO audit, performance audit, safety check, final polish) | Sequential | ~3 min |
| 6. Domain-Specific | 1-3 prompts (donation CTA, menu, booking, child safety, medical compliance) | Conditional | ~2 min |

**Key principles:**
- NO API FALLBACK. Container-only builds. If it fails, it fails visibly with an error email.
- Each prompt has ONE focused job. Never combine multiple responsibilities.
- Parallelize aggressively — research + asset generation runs concurrently.
- Every prompt must measurably improve the website. If it doesn't, the prompt is wrong.
- Visual inspection is MANDATORY — screenshot the rendered page, analyze with GPT-4o vision.
- Domain-specific features are decided by AI based on research data, not hardcoded categories.
- Safety check is ALWAYS the last step regardless of business type.
- Optimize every feature for bottom-line impact (conversions, SEO, retention).

## Container Architecture (CRITICAL — how builds actually work)

**The container is a STATELESS Claude Code executor.** It does not access D1 or R2 directly.

```
Workflow Step 1-3: Research (parallel)
  → Profile, Brand, Social, Images, Scrape website, Structure plan
  → All research runs on Workers AI (Llama 3.1) and external APIs

Workflow Step 4a: stage-a-foundation (20 min timeout)
  → Sends research data + foundation prompt to container
  → Container runs `claude -p` as non-root user `cuser`
  → Claude Code generates a full Vite + React + Tailwind + shadcn/ui project:
    - package.json (with shadcn/ui, Tailwind, React, Vite dependencies)
    - vite.config.ts, tailwind.config.ts, tsconfig.json
    - src/ with components, pages, layouts using shadcn/ui
    - public/ with assets, robots.txt, sitemap.xml
    - index.html (Vite entry point)
  → Returns ALL generated files to workflow
  → Workflow uploads to R2 as interim v1

Workflow Step 4b: stage-b-enhancement (20 min timeout)
  → Sends existing files + 3 enhancement prompts to container
  → Container runs 3 sequential `claude -p` calls
  → Returns updated files
  → Workflow uploads to R2 as interim v2

Workflow Step 4c: stage-cd-quality-final (20 min timeout)
  → Sends existing files + 5 quality/safety prompts to container
  → Returns final files
  → Workflow uploads to R2 as final version
  → Workflow updates D1 status to 'published'
  → Workflow creates 'initial' snapshot
```

**Container entrypoint** (`src/container.ts`): ~3KB inline Node.js that:
1. Installs `@anthropic-ai/claude-code` globally
2. Creates non-root user `cuser` (Claude blocks `--dangerously-skip-permissions` as root)
3. Starts HTTP server on port 8080
4. Accepts POST with `{ prompts, existingFiles, contextFiles }`
5. Runs each prompt via `su cuser -s /bin/sh -c "sh /tmp/run.sh"`
6. Returns all non-underscore files from the build directory

**API Credit Discipline (NON-NEGOTIABLE):**
- **NEVER** waste API credits on speculative or debugging builds
- If there's an error, reduce to the **simplest reproducible state** first (e.g., 2+2 math test)
- Fix issues as **separate, temporary tests** — not by running full production builds
- Only trigger full builds when the pipeline is proven working end-to-end
- For infrastructure debugging, use mock responses or static data — never real API calls
- Each Claude Code prompt costs ~$0.50-2.00. Each full build costs ~$5-15. Treat credits as scarce.

**Key constraints:**
- Entrypoint must be under 10KB (CF Containers limit)
- Each workflow step must complete within 25 minutes
- Container uses `node:22-slim` image (CF Containers don't support custom large images)
- Claude Code needs `--dangerously-skip-permissions -p` flag for stdin→stdout mode
- Shell scripts need `String.fromCharCode(10)` for newlines (not `\\n` in template literals)

## Template System (CRITICAL — saves build time)

**Templates are pre-built project skeletons stored in R2.** Instead of generating from scratch every time, Claude Code starts from a template and customizes it.

**Template repo:** https://github.com/HeyMegabyte/projectsites-template

**How templates work:**
1. Templates are Vite + React + Tailwind + shadcn/ui project skeletons
2. Each template has a `package.json` with all dependencies pre-configured
3. The template includes shadcn/ui components, layout patterns, responsive grids
4. Templates are categorized by industry: restaurant, non-profit, retail, professional, etc.
5. Claude Code receives the template as `existingFiles` and customizes it with business-specific content
6. This reduces build time from 15 min to ~5 min (Claude Code edits vs. creates from scratch)

**Template stack:**
- **Vite** — build tool
- **React 18+** — UI framework  
- **Tailwind CSS 3+** — utility-first CSS
- **shadcn/ui** — accessible component library (Radix UI primitives)
- **Inter / Satoshi** — typography (Google Fonts)

**Templates evolve:** Each successful build improves the template for that category. If Claude Code adds a pattern that improves quality, it gets folded back into the template.

**Current templates stored at:** `R2: templates/{category}/` with files like `package.json`, `vite.config.ts`, `tailwind.config.ts`, `src/App.tsx`, etc.

## Prompt System Philosophy (CRITICAL)

**Claude Code is INCAPABLE of designing a perfect website with a single prompt.** The prompts MUST be broken into as many focused prompts as necessary — forming a web of Principal Software Engineer-level prompts that always take what's available and improve it. Each prompt should improve the site tremendously if there's nothing there, or polish incrementally if quality is already high.

**The prompt system should:**
- Use however many prompts are necessary (12 is the floor, not the ceiling)
- Include small, surgical prompts for specific improvements (e.g., "fix color contrast in section 3")
- Leverage GPT-4o visual inspection heavily — screenshot after each major change, analyze, fix
- Use Playwright E2E TDD to validate DOM correctness programmatically
- Parallelize whenever possible (run independent prompts concurrently)
- Target under 1 hour total build time
- Evolve — the prompt chain should get better over time as new patterns emerge

**Color Contrast & Palette Quality:**
- Every color combination in the design MUST be checked for WCAG AA contrast (4.5:1 for text, 3:1 for large text)
- UI default colors, component colors, and backgrounds must use industry-appropriate, legendary, gorgeous, professional palettes
- NEVER use colors that look washed out, muddy, or generic
- The AI should generate 3-5 palette options per business type and select the most professional one
- Brand colors from the original website are extracted via AI vision, then enhanced to be more vibrant if needed while keeping the hue family
- If brand colors have poor contrast combinations, the AI must adjust them (lighter/darker variants) while maintaining brand recognition

## SEO Strategy (MANDATORY — world-class, not boilerplate)

Every generated website must implement aggressive, intelligent SEO that targets low-hanging fruit:

### Keyword Strategy
- **Primary keyword**: `{business type} in {city}` (e.g., "soup kitchen in Newark NJ", "grocery store Hell's Kitchen NYC")
- **Secondary keywords**: Each page targets 2-3 long-tail phrases derived from services + location
- **Keyword placement**: Primary in H1, title tag, meta description, first paragraph, and at least 2 H2s. Secondary in H3s, image alt text, internal link anchor text.
- **Keyword density**: 1-2% natural density. Never stuff. Always readable.

### Technical SEO (every site, every page)
- `<title>` under 60 chars: `{Primary Keyword} | {Business Name}`
- `<meta description>` under 160 chars: compelling, includes primary keyword + CTA
- `<link rel="canonical">` on every page
- JSON-LD `LocalBusiness` schema with: name, address, phone, geo coordinates, opening hours, price range, image, URL, sameAs (social links)
- `robots.txt` allowing all crawlers
- `sitemap.xml` listing all pages with lastmod dates
- Open Graph + Twitter Card meta tags for social sharing
- Semantic HTML: one H1, logical H2→H3 hierarchy, `<article>`, `<section>`, `<nav>`, `<main>`

### Content SEO
- **Internal linking**: Every page links to at least 2 other pages with keyword-rich anchor text
- **FAQ schema**: FAQ section uses `FAQPage` structured data for rich snippets in Google
- **Breadcrumbs**: Multi-page sites include breadcrumb navigation with `BreadcrumbList` schema
- **Image SEO**: Every image has descriptive alt text containing a relevant keyword. File names are descriptive (not `img-1.jpg`).
- **Content length**: Homepage 1000+ words, about page 500+ words. Real content, not filler.

### Local SEO (for location-based businesses)
- Google Maps embed with exact address
- `LocalBusiness` schema includes `geo` coordinates, `areaServed`, `serviceArea`
- NAP consistency (Name, Address, Phone) appears in header, footer, contact section, and schema
- Location mentioned naturally in content: "serving {neighborhood} since {year}"

### SEO Audit Prompts (run in the build pipeline)
Two dedicated SEO prompts run during the build:
1. **Keyword research + placement**: Analyze the business type + location, identify 5-8 target keywords, ensure they're placed in all required positions
2. **Technical SEO audit**: Verify all meta tags, schema, sitemap, canonical, heading hierarchy, alt text, internal links. Fix any gaps.

### Visual Quality Standards (CRITICAL — Breathtakingly Gorgeous)

**Every page must be a COMPELLING MULTIMEDIA EXPERIENCE. Everything should be BREATHTAKINGLY GORGEOUS and VIVIDLY + MASTERFULLY ANIMATED.**

**Tech stack:** shadcn/ui + Tailwind CSS + React (Vite). Every generated site uses this stack.

**Visual requirements:**
- 8+ @keyframes animations, glassmorphism, gradient text, scroll reveals
- 10+ unique images per site minimum
- Actual brand colors extracted via AI vision from original website
- Creative typography using premium fonts (Inter, Satoshi, DM Sans, Cabinet Grotesk)
- **Dark theme preferred** — darker + colorful is trending. Use dark backgrounds with vibrant accent colors
- Sites must look award-winning — Stripe / Linear / Vercel level polish

**Multi-page architecture (5-8 pages minimum for content-rich businesses):**
- Don't cram everything into one page
- Homepage = compelling marketing summary of the entire business mission
- Every sub-page (About, Services, Get Involved, etc.) must be its own stunning experience
- Proper navigation between all pages

**Brand Recreation Philosophy (CRITICAL — suped-up clone):**
- The goal is a SUPED-UP CLONE — same brand, same content, dramatically more beautiful
- **Logo:** IF THE BUSINESS HAS A LOGO, IT MUST BE USED. Priority: scrape from site header/footer → Logo.dev → Brandfetch → scan merchandise photos → extract from favicon → AI-generate as LAST resort
- **Logo font:** Extract the font from the logo image using AI vision and reuse it in the design
- **Logo graphics:** The graphic elements and colors in the logo should influence the ENTIRE site design
- **App icon:** Find real app icon → extract from logo → upscale favicon with AI → generate
- **Brand colors:** Extract from LOGO first, then website design, then merchandise/signage in photos
- **Content:** Use ALL original website content. Crawl and scrape EVERY page. If pages are too small, combine with 301 redirects
- **Images:** Use ALL original images. IF ANY PICTURE IS TOO SMALL, UPSIZE IT WITH AI
- **Page recreation:** Recreate every URL from the original sitemap. Make each page more beautiful, compelling, multimedia-packed
- **Every pass makes it better:** Structure prompts so each Claude Code pass escalates beauty, adding: gorgeous, accessible, concise, integrated, informative, intuitive, stunning, creative qualities

**Criticism integration (MANDATORY):**
- Any criticism for a *.projectsites.dev site must be adhered to, patched in prompts, and re-deployed
- The prompt system evolves with every user feedback cycle — never ignore a criticism

**Deep content integration:**
- Scrape ALL pages from the source site, not just the homepage
- Combine with web search results
- Augment with research, facts, references to affiliated organizations
- Back up content with real facts, proven research, affiliated org references
- If the source has a blog, recreate it with external CMS capability

**Multimedia everywhere:**
- Every page should have rich media (images, videos, animations)
- Double the parallelized research and multimedia discovery
- Optimize for visual impact — dark overlays on text are OK if they look stunning
- Add interactive, gamification elements where appropriate

**Google Maps embed:**
- Must have proper CSP headers allowing Google Maps iframe sources
- Register the domain with Google Maps Platform for API key restrictions
- Address links should use Google Maps directions URL format: `https://www.google.com/maps/dir/?api=1&destination={encoded_address}`
- Include `LocalBusiness` schema with geo coordinates matching the embedded map

## Design System & Style Guide (MANDATORY)

Every generated website must embody **Stripe / Linear / Vercel-level polish**:

### Design Stack
- **Layout:** Material Design spacing + layout principles
- **Typography:** Apple-level hierarchy — Inter or Satoshi, 48px hero / 24px section / 16px body
- **Components:** Tailwind CSS patterns + shadcn/ui-inspired accessible components (Radix UI patterns)
- **Colors:** Professional Tailwind-style palette, WCAG AA minimum contrast, brand colors extracted via AI vision

### UX Principles
- Immediate clarity above the fold — visitor knows what the business does in 3 seconds
- Single primary CTA (scroll to contact/donate/book)
- No cognitive overload — clean, minimal, premium SaaS aesthetic
- Subtle gradients, soft shadows, light motion only (not garish)

### Performance
- Must pass Lighthouse 90+ across all categories
- Minimal JS, fast load, lazy images, font-display: swap

### Quality Bar
- **Reference:** Stripe.com, Linear.app, Vercel.com level of polish
- **Output:** Production-ready code. No placeholders. No filler text. No lorem ipsum.

## Asset Curation Philosophy (MANDATORY)

**Collect 10x more assets than needed, then curate down via AI visual inspection.**

### The Pipeline
1. **Collect ~100 candidate assets** from ALL APIs: Unsplash, Pexels, Pixabay, Foursquare, Yelp, Google CSE, DALL-E, scraped images, YouTube videos
2. **AI visual inspection on EVERY asset** — GPT-4o vision checks quality, professionalism, relevance, safety, resolution
3. **Score and rank** — each asset gets a quality score (0-100) and a relevance score
4. **Select top 10-15** for the final website — the absolute best from the 100 candidates
5. **Include rich media generously** — a 3-4 page site should have 15-20 high-quality images + 1-2 videos minimum

### What Gets Inspected
- **Every image**: resolution, composition, relevance to business, professionalism, no watermarks
- **Every video**: quality, relevance, appropriate content, no ads
- **Logos**: clarity at multiple sizes, brand accuracy, text readability
- **App icons**: works at 512px AND 32px, distinctive, brand colors

### Logo & App Icon Selection
- Use ALL available sources: Logo.dev, Brandfetch, website scrape, Google image search
- For logo: prefer horizontal/text-based version with business name readable
- For app icon: prefer square/monogram version, works at small sizes
- Use the best trendy fonts (Inter, Satoshi, DM Sans, Cabinet Grotesk, General Sans) customized to brand personality
- If no suitable logo exists: generate via DALL-E/Ideogram using brand colors + display font

**Branded error pages:** All HTTP errors (400-503) return gorgeous animated HTML pages with Fira Code debug info (for browsers). API clients get JSON.

**Snapshot system:** Each build auto-creates a snapshot (first = "initial", edits = AI-named). Access frozen versions at `{slug}-{snapshot}.projectsites.dev`.

**49 API integrations deployed** — see memory file for full list. Key: Unsplash, Foursquare, Yelp, YouTube, Pexels, Pixabay, DALL-E, Stability AI, Cloudinary, Mapbox, Brandfetch, Logo.dev, plus quality gates (PageSpeed, GTmetrix).

**Build process reference:** See [`docs/BUILD_PROCESS.md`](docs/BUILD_PROCESS.md) for the complete technical flow — from user click to published site, including all prompts, APIs, and quality gates.

**Quality rules:** See memory file `website_quality_rules.md` for the criticism registry — every user feedback item about generated websites, organized by category.

**Every prompt's suggestions should be considered** and possibly included in the multi-stage build process. When a user provides feedback about a generated site, the feedback should be generalized into rules that apply to all future builds.

## Logo & App Icon Generation (MANDATORY)

Every site MUST have a logo and app icon. If none is uploaded or discovered:

1. **Logo.dev** (`LOGODEV_TOKEN`) — try first for established businesses with domains
2. **Brandfetch** (`BRANDFETCH_API_KEY`) — full brand kit including logos
3. **DALL-E 3** (`OPENAI_API_KEY`) — generate a clean, modern text-based logo
4. **Ideogram** (`IDEOGRAM_API_KEY`) — alternative AI logo generation (good for stylized text)
5. **Stability AI** (`STABILITY_API_KEY`) — Stable Diffusion for logo variations

Logo style: Clean, simple, text-based with a geometric accent. Use the business name in a bold display font with brand colors. The logo should work at both large sizes (hero) and small sizes (favicon).

App icon: 512x512 PNG, simplified version of the logo. If the logo has text, the app icon should be just the first letter or monogram in the brand's primary color on a clean background.

## Multimedia API Usage (MANDATORY in every build)

ALL available multimedia APIs must be queried during the build:

| API | Key | Use In Build |
|-----|-----|-------------|
| Unsplash | `UNSPLASH_ACCESS_KEY` | Hero images, section backgrounds, service card images |
| Pexels | `PEXELS_API_KEY` | Stock photos + videos for hero/section backgrounds |
| Pixabay | `PIXABAY_API_KEY` | Illustrations, vectors, supplementary photos |
| YouTube | `YOUTUBE_API_KEY` | Business-specific videos for hero or featured section |
| Foursquare | `FOURSQUARE_API_KEY` | Venue-specific photos |
| Yelp | `YELP_API_KEY` | Business photos from Yelp listing |
| DALL-E 3 | `OPENAI_API_KEY` | Generated section images, logos, hero art |
| Ideogram | `IDEOGRAM_API_KEY` | Logo generation, stylized text art |
| Stability AI | `STABILITY_API_KEY` | Supplementary images, backgrounds, patterns |
| Replicate | `REPLICATE_API_TOKEN` | Image upscaling, background removal |
| Remove.bg | `REMOVEBG_API_KEY` | Clean up logos, product photos |
| Cloudinary | `CLOUDINARY_*` | Image optimization CDN (auto WebP, responsive sizing) |

The generated website should have **minimum 10 unique images** from these sources. No site should ever launch with placeholder or missing imagery.

## Quick Start

```bash
cd apps/project-sites
npm install --legacy-peer-deps   # NOT pnpm (electron-builder breaks it)
npm test                         # 896 unit tests across 48 suites
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
│   ├── ai_workflows.ts         # Multi-phase AI pipeline + prompt registration
│   ├── analytics.ts            # PostHog server-side event capture
│   ├── audit.ts                # Append-only audit log writes
│   ├── auth.ts                 # Magic link, Google OAuth, sessions
│   ├── billing.ts              # Stripe checkout, subscriptions, entitlements
│   ├── build_context.ts        # Build context assembly for container builds
│   ├── build_limits.ts         # Build rate limiting + concurrency
│   ├── chat_synthesis.ts       # Chat context synthesis for AI
│   ├── confidence.ts           # Confidence scoring for research data
│   ├── contact.ts              # Contact form handling
│   ├── db.ts                   # D1 query helpers (dbQuery, dbInsert, dbUpdate, dbExecute)
│   ├── domains.ts              # CF for SaaS custom hostname provisioning
│   ├── external_llm.ts         # External LLM provider routing (OpenAI, Anthropic, etc.)
│   ├── google_places.ts        # Google Places API integration
│   ├── image_discovery.ts      # Multi-API image discovery (Unsplash, Pexels, etc.)
│   ├── image_generation.ts     # AI image generation (DALL-E, Stability, etc.)
│   ├── notifications.ts        # Email notifications (Resend/SendGrid)
│   ├── openai_research.ts      # OpenAI-powered research pipeline
│   ├── sentry.ts               # Error tracking (Toucan SDK)
│   ├── site_serving.ts         # R2 static file serving + top bar injection for unpaid
│   ├── template_cache.ts       # R2 template caching for container builds
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
| GET | `/api/search/address?q=...` | Address search proxy |
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
| GET | `/api/auth/me` | Get current user session |
| POST | `/api/sites` | Create site (manual) |
| GET | `/api/slug/check` | Check slug availability |
| GET | `/api/sites` | List user's sites |
| GET | `/api/sites/:id` | Get single site |
| GET | `/api/sites/:id/workflow` | Get workflow status |
| GET | `/api/sites/:id/logs` | Get site audit logs |
| POST | `/api/sites/:id/reset` | Reset site (rebuild) |
| POST | `/api/sites/:id/deploy` | Deploy zip to site |
| POST | `/api/sites/:id/publish-bolt` | Publish from bolt editor |
| DELETE | `/api/sites/:id` | Delete site |
| POST | `/api/billing/checkout` | Create Stripe checkout session |
| POST | `/api/billing/embedded-checkout` | Create embedded checkout |
| GET | `/api/billing/subscription` | Get subscription status |
| GET | `/api/billing/entitlements` | Get plan entitlements |
| POST | `/api/billing/portal` | Create Stripe billing portal |
| GET | `/api/sites/:siteId/hostnames` | List hostnames |
| POST | `/api/sites/:siteId/hostnames` | Provision hostname |
| PUT | `/api/sites/:siteId/hostnames/:hostnameId/primary` | Set primary hostname |
| POST | `/api/sites/:siteId/hostnames/reset-primary` | Reset to default hostname |
| DELETE | `/api/sites/:siteId/hostnames/:hostnameId` | Delete hostname |
| POST | `/api/sites/:siteId/hostnames/:hostnameId/unsubscribe` | Unsubscribe hostname |
| POST | `/api/sites/improve-prompt` | AI prompt improvement |
| POST | `/api/sites/generate-prompt` | AI prompt generation |
| POST | `/api/ai/categorize` | AI business categorization |
| POST | `/api/contact-form/:slug` | Submit contact form |
| GET | `/api/sites/by-slug/:slug/build-context` | Get build context |
| GET | `/api/sites/by-slug/:slug/chat` | Get chat context |
| GET | `/api/sites/by-slug/:slug/research.json` | Get research data |
| GET | `/api/domains/search` | Search available domains |
| POST | `/api/domains/purchase` | Purchase domain |
| GET | `/api/admin/domains` | Admin: list all domains |
| POST | `/api/publish/bolt` | Publish from bolt |

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
Step 1 (sequential):  research-profile          → business_type needed for others
Step 1b (optional):   google-places-lookup      → enrich with Places API data
Step 2 (parallel):    research-social            → social links
                      research-brand             → logo, colors, fonts
                      research-selling-points    → USPs, hero content
                      research-images            → image strategies
Step 2.5 (sequential): move-uploaded-assets      → move user uploads to R2
                       generate-logo             → AI logo generation
                       generate-favicon-set      → favicon from logo
                       generate-section-images   → AI section images
                       discover-brand-images     → brand image discovery
                       discover-videos           → YouTube video discovery
                       store-build-context       → persist research to R2
Step 2.5b (optional): scrape-website             → deep-crawl existing site
Step 2.6 (optional):  seed-site-data             → seed per-site D1 tables
Step 3 (sequential):  structure-plan             → site structure plan (fast LLM)
Steps 4-6 (container build — multi-stage):
  stage-a-foundation   → Claude Code generates full Vite+React+Tailwind+shadcn/ui project
  upload-interim-v1    → upload to R2
  stage-b-enhancement  → 3 sequential enhancement prompts
  stage-c-quality      → quality/polish prompts
  stage-d-final        → final safety + SEO prompts
  upload-final         → upload to R2, update D1 status to 'published'
```

Each step has automatic retry (3x) with exponential backoff. Container builds use
Cloudflare Containers (Durable Object `SITE_BUILDER`) running `node:22-slim` with
Claude Code (`@anthropic-ai/claude-code`) installed at runtime.

## Prompt Files (prompts/*.prompt.md)

15 prompt files in YAML frontmatter + Markdown format:

| File | Purpose |
|------|---------|
| `research_profile.prompt.md` | Deep business profile research |
| `research_social.prompt.md` | Social media + website discovery |
| `research_brand.prompt.md` | Logo, colors, fonts, personality |
| `research_selling_points.prompt.md` | 3 USPs + hero slogans |
| `research_images.prompt.md` | Image needs + search strategies |
| `generate_website.prompt.md` | Full website HTML from research data |
| `generate_multipage_site.prompt.md` | Multi-page site generation |
| `generate_legal_pages.prompt.md` | Privacy/terms pages |
| `plan_site_structure.prompt.md` | Site structure planning |
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
**Auth**: `sessions`, `magic_links`, `oauth_states` (`phone_otps` table exists but is orphaned — phone feature removed)
**Billing**: `subscriptions`
**Infra**: `webhook_events`, `audit_logs`, `workflow_jobs`
**AI**: `research_data`, `confidence_attributes`
**Analytics**: `analytics_daily`, `funnel_events`, `usage_events`

Site status machine: `draft → collecting → imaging → generating → published | error | archived`

## D1 Query Helpers (services/db.ts)
```typescript
dbQuery<T>(db, sql, params)      // SELECT multiple → { data: T[] }
dbQueryOne<T>(db, sql, params)   // SELECT one → T | null
dbInsert(db, table, record)      // INSERT + auto timestamps
dbUpdate(db, table, updates, where, params) // UPDATE + auto updated_at
dbExecute(db, sql, params)       // Raw execute
```

## Site Serving Flow
1. Base domain (`projectsites.dev`) → serve `marketing/index.html` from R2
2. Subdomain (`{slug}.projectsites.dev`) → resolve from D1 → serve from R2
3. Unpaid sites → inject top bar after `<body>` tag
4. KV cache: `host:{hostname}` → site record (60s TTL)

## Env Bindings (wrangler.toml)
- `CACHE_KV`: KV namespace for caching
- `PROMPT_STORE`: KV namespace for prompt hot-patching
- `DB`: D1 database
- `SITES_BUCKET`: R2 bucket for static sites
- `QUEUE`: Queue (optional, commented out — not yet enabled on account)
- `SITE_WORKFLOW`: Cloudflare Workflow binding
- `SITE_BUILDER`: Durable Object (Cloudflare Container) for Claude Code builds (production only)
- `AI`: Workers AI binding

## Testing
```bash
npm test                    # 896 unit tests across 48 suites
npm run test:coverage       # with coverage
npx playwright test         # E2E tests (needs Chromium)
```

### E2E Test Files (38 spec files)
Key specs include:
- `e2e/golden-path.spec.ts` — Full user journey
- `e2e/homepage.spec.ts` — Homepage sections + auth screens
- `e2e/health.spec.ts` — Health, CORS, auth gates
- `e2e/site-serving.spec.ts` — Serving, security, webhooks
- `e2e/inline-editing.spec.ts` — Inline site editing
- `e2e/ai-workflow.spec.ts` — AI generation workflow
- `e2e/domain-management.spec.ts` — Domain provisioning
- `e2e/admin-and-billing.spec.ts` — Admin + billing flows
- `e2e/auth-and-signin.spec.ts` — Authentication flows
- Plus 29 additional spec files covering UI polish, modals, search, etc.

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
