/**
 * @module workflows/site-generation
 *
 * @description
 * Production multi-page site-generation pipeline — the Cloudflare Workflow that turns a
 * `sites.status='queued'` row into a fully published, brand-faithful website on R2 with
 * `sites.status='published'`. This is the **only** path used by the `/api/sites/:id/reset`
 * and `/api/sites/create-from-search` endpoints in production; the inline LLM pipelines in
 * `src/services/ai_workflows.ts::runSiteGenerationWorkflowV2` are dev/test scaffolding,
 * never triggered by user-facing routes.
 *
 * @remarks
 * Five-phase pipeline, each phase a Workflow `step.do(...)` block (durable, replay-safe,
 * timeout-isolated). Heartbeat-polled container execution keeps each step under the
 * 30-minute Workflow step ceiling without imposing a single long-running step that would
 * blow the budget:
 *
 * 1. **Pre-flight gates** (`anthropic-credit-probe` + container binding check) — 1-token
 *    probe to `api.anthropic.com/v1/messages` catches an empty credit balance BEFORE we
 *    spend 25–40 minutes of container time on a `claude -p` invocation that would
 *    silently exit code=0 with a template-only `dist/` masquerading as success. Skipped
 *    when subscription OAuth is active (Max plan has no credit-balance failure mode).
 *
 * 2. **Source-brand extraction** (`extract-source-brand`) — before the LLM brand pass,
 *    the Worker deterministically extracts logo, fonts, colors, theme from the source
 *    site (when `businessWebsite` is provided). Persists `_brand.json` + `_assets.json` +
 *    `_scraped_content.json` to R2 under `sites/{slug}/v-{ts}/`. {@link getCanonicalBrand}
 *    short-circuits this for "blessed" rebuilds (e.g. LMG) — applies the exact contract
 *    from `scripts/<slug>-canonical-brand.json`, skipping LLM-based brand inference
 *    entirely. See `apps/project-sites/CLAUDE.md` invariant #20 "Brand contract violation".
 *
 * 3. **Container orchestration** (`start-build` → `heartbeat-N` → `finalize-build`) —
 *    POSTs `{ prompt, envVars, sourceBrand }` to the `SITE_BUILDER` Durable Object
 *    container (CF Containers, `node:22-slim` base, ~2GB image with Claude Code + skills
 *    + template pre-baked). Container runs ONE `claude -p` orchestrator session that
 *    fans out to parallel subagents (visual-qa, seo-auditor, accessibility-auditor,
 *    performance-profiler, content-writer, security-reviewer, domain-builder,
 *    validator-fixer). Heartbeat polling every 30s for up to 50 minutes; container
 *    HMAC-signs status callbacks to `/api/internal/build-status` (KV-backed so workflow
 *    replay sees the freshest job state). `containerName` strategy: iteration=1 uses a
 *    per-run nonce (disposable, eliminates stale-image issues); iteration>1 reuses a
 *    stable DO name so node_modules / vite cache / template clone survive — saves
 *    ~60-130s per warm iteration.
 *
 * 4. **R2 upload + brand validation** (`migrate-external-assets` + `validate-build`) —
 *    container writes its dist files into the build directory; `node upload-to-r2.mjs`
 *    inside the container pushes them to `sites/{slug}/{version}/` via S3-compatible
 *    API. Worker then runs `validateBuild()` from `src/services/build_validators.ts`
 *    against R2 (27 invariants in `apps/project-sites/CLAUDE.md`). Mode flag currently
 *    `report` (D1 audit only); flips to `strict` once template benchmarks ship clean.
 *
 * 5. **Post-publish telemetry** (`source-fidelity-check` + `visual-inspection` +
 *    `benchmark-and-learn` + `notify`) — non-blocking GPT-4o vision scoring vs the
 *    source-site screenshot (rebuilds only), Lighthouse scoring vs `whitehouse.gov` /
 *    `linear.app` / `stripe.com` benchmarks, owner notification email via Resend.
 *
 * Eviction tolerance: the workflow tolerates Durable Object restarts because every step
 * is replay-safe — `step.do` results are cached by Workflows, so a replay returns the
 * same values without re-running the body. Job state lives in KV (not container disk),
 * so even a full container restart mid-build is recoverable on the next heartbeat. See
 * `memory/project_container_eviction_tolerance.md`.
 *
 * Wall-clock budget: 50 minutes total (3-min research + 35-min orchestrator + 5-min
 * upload + 7-min telemetry). Each individual `step.do` capped at 30 minutes (Workflow
 * platform limit). Hard cap inside the orchestrator prompt: 35 min container wall-clock,
 * MAX 3 parallel fan-out cycles, MAX 2 completeness-checker invocations, MAX 4
 * validator-fixer rebuild loops — exceed any → ship-with-warnings.
 *
 * @example Trigger a rebuild from the API
 * ```ts
 * await env.SITE_WORKFLOW.create({
 *   id: crypto.randomUUID(),
 *   params: {
 *     siteId, slug, businessName, businessAddress, businessPhone,
 *     businessCategory, businessWebsite, orgId,
 *     iteration: 1,
 *     budgetTier: 'free',
 *   } satisfies SiteGenerationParams,
 * });
 * ```
 *
 * @example Convergence-loop iteration (warm container reuse)
 * ```ts
 * await env.SITE_WORKFLOW.create({
 *   id: crypto.randomUUID(),
 *   params: {
 *     ...baseParams,
 *     iteration: 3,                 // warm DO reuse — node_modules survives
 *     priorRecommendations: [       // surgical fixes from prior judge
 *       { category: 'a11y', severity: 'high', description: '...' },
 *     ],
 *   },
 * });
 * ```
 *
 * @see ../services/canonical_brand_overrides.ts — blessed brand-contract short-circuit
 * @see ../services/source_brand_extractor.ts — deterministic brand extraction
 * @see ../services/build_validators.ts — 27 build-breaking invariants
 * @see ../services/asset_migration.ts — external-host whitelist enforcement
 * @see ../routes/api.ts — `/api/sites/:id/reset` and `/api/internal/build-status`
 * @see ../../prompts/_mission_preamble.txt — HOLIEST / HIGHEST B-ORDER doctrine
 * @see ../../CLAUDE.md — Mission Doctrine + 27-row Mandatory Invariants table
 * @see ~/.claude/projects/-Users-apple-emdash-projects-projectsites-dev/memory/project_build_pipeline_v2.md
 *
 * @packageDocumentation
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { Env } from '../types/env.js';
import { DOMAINS } from '@project-sites/shared';
import { TIER_CAPS, type BudgetTier } from '@project-sites/shared/schemas';
import { loadBuildFromR2, validateBuild } from '../services/build_validators.js';
import { migrateExternalAssets } from '../services/asset_migration.js';
import { extractSourceBrand, persistSourceBrand } from '../services/source_brand_extractor.js';
import {
  getCanonicalBrand,
  applyCanonicalBrandOverride,
  canonicalBrandToSourceBrand,
} from '../services/canonical_brand_overrides.js';
import { lookupBusiness } from '../services/google_places.js';
import { hasClaudeOauth, getValidClaudeOauth } from '../services/anthropic_oauth.js';

/** Update site status in D1 (best-effort, never throws). */
async function updateSiteStatus(db: D1Database, siteId: string, status: string): Promise<void> {
  try {
    await db
      .prepare('UPDATE sites SET status = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .bind(status, siteId)
      .run();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'workflow',
        message: 'Failed to update site status',
        siteId,
        status,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Write a workflow audit log entry (best-effort, never throws). */
async function workflowLog(
  db: D1Database,
  orgId: string,
  siteId: string,
  action: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const enrichedMeta = { ...metadata, site_id: siteId };
    await db
      .prepare(
        `INSERT INTO audit_logs (id, org_id, actor_id, action, target_type, target_id, metadata_json, created_at)
         VALUES (?, ?, NULL, ?, 'site', ?, ?, datetime('now'))`,
      )
      .bind(
        crypto.randomUUID(),
        orgId,
        action,
        siteId,
        JSON.stringify(enrichedMeta),
      )
      .run();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: 'warn',
        service: 'workflow',
        message: 'Failed to write workflow audit log',
        action,
        siteId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

/** Parameters passed when creating a workflow instance. */
export interface SiteGenerationParams {
  siteId: string;
  slug: string;
  businessName: string;
  businessAddress?: string;
  businessPhone?: string;
  businessCategory?: string;
  businessWebsite?: string;
  googlePlaceId?: string;
  additionalContext?: string;
  uploadedAssets?: string[];
  uploadId?: string;
  orgId: string;
  /** Diagnostic: skip Claude Code, write a static index.html, upload to R2. */
  minimalMode?: boolean;
  /** Diagnostic: hit /build-stub (no API cost) to validate KV-callback persistence. */
  stubMode?: boolean;
  /** Reset triggered from API: skip the create-from-search short-circuit. */
  isReset?: boolean;
  /**
   * Convergence iteration number (1-indexed). When > 1, the workflow reuses a
   * stable container DO name across iterations so the Linux container stays warm
   * (preserving node_modules, ~/.cache/vite, ~/.agentskills clone, ~/template
   * clone). Set by `convergence-loop.mjs` via the reset endpoint.
   */
  iteration?: number;
  /**
   * Recommendations from the previous iteration's multi-judge. Passed through
   * to the container `/build` payload so the orchestrator prompt can target
   * specific fixes instead of regenerating from scratch.
   */
  priorRecommendations?: Array<{ category: string; severity: string; description: string }>;
  /**
   * Budget tier selected at /create checkout. Drives premium media gating
   * (Sora video, NotebookLM podcast, immersive infographics) and the
   * `max_generated_images` cap inside the orchestrator prompt + container env.
   * Defaults to `'free'` when not provided.
   */
  budgetTier?: BudgetTier;
}

/** Audit-trail extras emitted by container-server.mjs (audit hardening 2026-05-09). */
type ContainerErrorClass =
  | 'anthropic_credit_balance_too_low'
  | 'claude_silent_exit'
  | null;

interface ContainerAuditTrail {
  stdoutTail?: string | null;
  stderrTail?: string | null;
  claudeExitCode?: number | null;
  claudeRanSeconds?: number | null;
  errorClass?: ContainerErrorClass;
}

/** Container status response shape. */
interface ContainerStatus extends ContainerAuditTrail {
  status: 'running' | 'complete' | 'error';
  step: string;
  elapsed: number;
  fileCount: number;
  error: string | null;
}

/** Container result response shape. */
interface ContainerResult {
  status: string;
  files: { name: string; content: string }[];
  error?: string;
}

/** KV-backed build status record (written by /api/internal/build-status). */
interface KvBuildRecord extends ContainerAuditTrail {
  jobId: string;
  status: 'running' | 'complete' | 'error';
  step: string;
  elapsed: number;
  fileCount: number;
  error: string | null;
  uploadResult: { uploaded?: number; failed?: number; version?: string } | null;
  lastUpdate: number;
}

/**
 * Build the orchestrator prompt for Claude Code.
 *
 * The orchestrator does NOT implement components itself. It delegates to
 * specialist subagents in parallel via the Task tool, then routes their
 * findings to fix-capable specialists. Universal agents come from
 * heymegabyte/claude-skills (synced into ~/.claude/agents/), project agents
 * are layered on top via the Dockerfile COPY.
 *
 * @see ~/.agentskills/15-site-generation/ for methodology
 * @see /home/cuser/.claude/CLAUDE.md for inherited base instructions
 */
function buildPrompt(params: SiteGenerationParams, hasSourceBrand = false): string {
  const safeName = (params.businessName || 'Business').replace(/[^\w\s\-'.]/g, '').slice(0, 100);
  const category = params.businessCategory || 'general business';
  const address = params.businessAddress || '';
  const phone = params.businessPhone || '';
  const website = params.businessWebsite || '';
  const slug = params.slug;
  const budgetTier: BudgetTier = params.budgetTier || 'free';
  const caps = TIER_CAPS[budgetTier];
  const tierBlock = [
    `### L11 — Budget Tier: ${budgetTier.toUpperCase()} (BUILD-BREAKING — read \`_build_caps.json\` for the canonical cap object)`,
    `- max_generated_images: ${caps.max_generated_images}. AI image generation (DALL-E / Ideogram / Stability) MUST NOT exceed this count across the entire build. Stock-first via Pexels/Unsplash/Pixabay/Foursquare/Yelp; only fall through to paid generation when stock cannot satisfy a slot.`,
    caps.video_enabled
      ? '- Sora hero video: ENABLED. Generate ONE short (5–8s) autoplay-muted-loop hero clip via Sora; embed as `<video>` with `poster=` set to a high-quality stock or DALL-E hero still. Stock fallback: a relevant Pexels MP4. Never embed YouTube as the primary hero.'
      : '- Sora hero video: DISABLED. Use a still hero (DALL-E or Pexels stock). NEVER call Sora; NEVER spend video credits. YouTube embeds remain allowed as secondary content.',
    caps.podcast_enabled
      ? '- NotebookLM podcast: ENABLED. Render the episode player on `/about` (audio + transcript). Source script from `_research.json` + scraped content; persist artifacts under `_notebooklm.json`.'
      : '- NotebookLM podcast: DISABLED. Do not embed any audio player. Do not generate a podcast manifest.',
    caps.immersive_enabled
      ? '- Immersive infographic gallery: ENABLED. Generate ONE Recraft-rendered + Vega-Lite explainer per primary service/section (target 3–5 total). Persist under `_infographics.json`.'
      : '- Immersive infographic gallery: DISABLED. Use static SVG illustrations + framer-motion entrance animations only.',
    `- Cap enforcement is a quality gate: violating any of the above flips the build to ship-with-warnings. Write \`_budget_audit.json\` after build-N: \`{ tier, generated_image_count, video_used, podcast_used, immersive_count, within_caps: bool }\`.`,
  ].join('\n');

  return [
    `# Mission: Orchestrate a BREATHTAKINGLY GORGEOUS website for "${safeName}"`,
    '',
    '## Master Directive (canonical: apps/project-sites/prompts/directive-v1.prompt.md)',
    'Treat the Directive v1 contract below as the highest authority. If it conflicts with any other instruction (skills, agents, templates), the directive WINS.',
    '',
    '### L0 — Stop Conditions + Hard Caps',
    'A build is DONE when ALL of: (a) `node /home/cuser/run-validators.mjs dist` reports `blockers === 0`; (b) completeness-checker returns DONE; (c) every audit subagent (visual-qa, seo-auditor, accessibility-auditor, performance-profiler) returns score >= 0.85; (d) Lighthouse Perf >= 75, A11y >= 95.',
    'HARD CAPS (build-breaking — exceed any → stop, ship-with-warnings, write `.build-phase` = "capped"): wall-clock 35 min total | MAX 3 PARALLEL FAN-OUT cycles | MAX 2 completeness-checker invocations | MAX 4 validator-fixer rebuild loops. If caps hit before stop conditions, write a `WARNINGS.md` summarizing remaining gaps, set `_brand.json.build_status="warned"`, and ship anyway — partial DONE > infinite loop.',
    '',
    '### Phase Markers (MANDATORY — every phase boundary)',
    'Before each phase, write phase name to `.build-phase`: `printf "%s" "<phase>" > .build-phase`. Phase taxonomy: `boot|research|customize|build-1|fanout-1|fix-1|build-2|fanout-2|fix-2|build-3|completeness-1|fanout-3|fix-3|completeness-2|capped|upload|done`. Surfaces in container heartbeat as `claude-code:<phase>` for ops visibility. Skipping phase markers makes the build invisible — DO NOT skip.',
    '',
    '### L1 — Mode Inference',
    'Pick ONE primary mode: saas | portfolio | local-business | non-profit | consulting | other. Mode biases wedge, copy tone, JSON-LD types, and CTA palette. Consulting mode (B2G/B2NGO/expert-services) requires: thought-leadership hub, named-client wall, GEO-optimized 40–60 word answer blocks, 4+ JSON-LD per page (Organization+Person+Article+FAQPage min).',
    '',
    '### L2 — Source-Aware Theme & Brand (BUILD-BREAKING)',
    '- GPT-4o-score the source homepage screenshot 0–10 on aesthetic polish during brand research.',
    '- If source >= 7/10, PRESERVE source theme polarity (light → light, dark → dark) and clone hero/section structure + color + typography pairings before adding our polish.',
    '- Compute logo dominant-color luminance. Dark logo (<0.4) → LIGHT theme. Light logo (>0.6) → DARK theme. Mid (0.4–0.6) → verify logo contrast ≥4.5:1 against header/hero/footer; flip to light if not.',
    '- Extract source typography from CSS `font-family` + Google Fonts URLs. USE THE EXACT FONTS — never substitute "modern equivalents".',
    '- Set `_brand.json.theme` and `_brand.json.preserve_source_design` BEFORE template selection.',
    '',
    '### L3 — Page Count = Source Sitemap (NEVER COLLAPSE)',
    'Discover sitemap via priority chain: (1) /sitemap.xml + /sitemap_index.xml, (2) /wp-sitemap.xml or /sitemap-index.xml, (3) robots.txt Sitemap: lines, (4) Wayback Machine CDX, (5) breadth-first crawl depth ≤6 same-host. Persist EVERY URL to `_scraped_content.json.routes[]`. Build one route per entry. Floor: 4 pages even for 1-page sources. Ceiling: 1000.',
    '',
    '### L5 — Static-Compat Backend (forms.js only)',
    'No server-rendered routes. No DB calls from rendered pages. Forms POST to `/api/contact-form/${slug}` via the inlined forms.js hijack pattern. All dynamic data is baked at build-time + 30s polling via inline JS. Never introduce SSR, API handlers, or third-party backends.',
    '',
    '### L9 — Quality Gates (16 build-breaking validators in src/services/build_validators.ts)',
    'manifest.required_file_missing | asset.missing | asset.external_host_not_allowed | image.png_too_large | og.missing | og.too_large | icon.apple_touch_missing | meta.title_length | meta.description_length | jsonld.count_below_threshold | html.h1_count | meta.color_scheme_missing | sitemap.missing_lastmod | copy.banned_word | js.chunk_too_large | lightbox.zoomable_missing/gallery_missing. Run `node /home/cuser/run-validators.mjs dist` until blockers === 0.',
    '',
    '### L10 — Template-First Construction (***BUILD-BREAKING — read before writing any code***)',
    'The pre-baked template at `~/template/` (Vite + React + Tailwind + shadcn/ui) is the SKELETON for every build. The default disposition is REUSE: copy the template wholesale, then EDIT files in place. From-scratch generation is forbidden when an equivalent template file exists.',
    '- Step-1 of customize MUST be `cp -r ~/template/. <build dir>/` (or rsync). Never start with an empty directory.',
    '- Reuse > replace: existing components in `src/components/`, layouts in `src/layouts/`, hooks, utilities, animations, Tailwind config, and shadcn primitives MUST be reused. Do NOT recreate Button/Card/Section/Hero/Nav/Footer when they ship in the template.',
    '- Allowed authoring modes: (a) EDIT a template file in place, (b) ADD a new file under `src/components/sections/` ONLY when no template equivalent exists, (c) DELETE a template route only when its purpose has no analogue in the source sitemap.',
    '- Forbidden: rewriting `vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `package.json` deps, `tsconfig.json`, `index.html` shell scaffolding, the shadcn primitive components in `src/components/ui/`. Edit values inside these (theme tokens, plugin args), never replace the file.',
    '- Brand customization is a TOKEN SWAP, not a rewrite: change CSS custom properties in `src/index.css` + Tailwind theme tokens in `tailwind.config.ts` (`colors.primary`, `fontFamily.sans/serif/display`). The component tree stays template-shaped.',
    '- Per-page customization: each route file under `src/pages/` or `src/routes/` is created by COPYING the closest template page and swapping content + section composition. Never hand-roll a new page module.',
    '- Audit gate (write `_template_audit.json` after `npm run build`, before fanout-1): `{ template_files_kept: number, template_files_edited: number, template_files_deleted: number, new_files_outside_sections: string[], from_scratch_components: string[] }`. If `new_files_outside_sections.length > 3` OR `from_scratch_components.length > 0`, the orchestrator MUST refactor to use template equivalents BEFORE invoking subagents.',
    '',
    tierBlock,
    '',
    '## Inherited Instructions',
    'Your ~/.claude/CLAUDE.md @-imports the upstream heymegabyte/claude-skills CLAUDE.md, AGENTS.md, and _router.md. Follow the orchestrator overlay there. This prompt is the per-build dispatch — the meta surface controls HOW.',
    '',
    '## Skills',
    'Load ~/.agentskills/_router.md, then skill 15 (~/.agentskills/15-site-generation/) IN FULL — research pipeline, media acquisition, build prompts, quality gates, domain features, template system. Skill 15 governs methodology.',
    '',
    '## Business Data',
    `Business: ${safeName}`,
    `Category: ${category}`,
    `Slug: ${slug}`,
    `Site URL: https://${slug}${DOMAINS.SITES_SUFFIX}`,
    address ? `Address: ${address}` : '',
    phone ? `Phone: ${phone}` : '',
    website ? `Website: ${website}` : '',
    params.googlePlaceId ? `Google Place ID: ${params.googlePlaceId}` : '',
    '',
    '## Context Files (read FIRST — sourceBrand artifacts are AUTHORITATIVE)',
    hasSourceBrand
      ? [
          'The Worker pre-extracted source-site brand BEFORE this prompt ran. Three files are present in the build directory and MUST be read before any visual decision:',
          '- `_brand.json` — fonts.{logo,heading,body}, fonts.google_fonts[], logo.original_url, logo.original_icon_url, colors.primary/secondary/background/ranked[], theme ("light"|"dark"), preserve_source_design (boolean), cms.',
          '- `_assets.json` — original[] (every <img src> + CSS background-image: from source) with role hints (hero|logo|gallery|team|content|icon). Target: augmented.length >= original.length * 1.4.',
          '- `_scraped_content.json` — discovered routes[] (sitemap + nav crawl) and homepage_html_excerpt for tone/structure cloning.',
          '',
          'BUILD-BREAKING brand-fidelity rules (extracted brand wins over template defaults):',
          '1. **Fonts:** if `_brand.json.fonts.google_fonts[]` is non-empty, the rebuild MUST `<link rel=stylesheet href="https://fonts.googleapis.com/css2?family=...">` for EXACTLY those families and apply them via CSS `font-family`. NEVER substitute Inter / Space Grotesk / JetBrains Mono / Satoshi when extraction returned families. If `google_fonts[]` is empty but `fonts.heading` / `fonts.body` is present, treat as the same hard requirement.',
          '2. **Theme:** `_brand.json.theme === "light"` MUST produce a light-themed rebuild (background hex luminance > 0.7). NEVER flip to dark when source is light. Same in reverse for `theme === "dark"`.',
          '3. **Source images:** every URL in `_assets.json.original[]` (especially role=hero, role=logo, role=gallery, role=team) MUST appear at least once in the rebuilt HTML, either via `<img src>` or CSS `background-image: url(...)`. The rebuild MUST contain at least `Math.ceil(original.length * 1.4)` total `<img>` tags. NEVER ship with 0 images when original_count > 0.',
          '4. **Logo:** `_brand.json.logo.original_url` (when present) is the wordmark for header/footer. `_brand.json.logo.original_icon_url` is the favicon source — pass it through real-favicongenerator (or sharp fallback) for the 11-file favicon set. NEVER AI-generate a new logo when extraction succeeded.',
          '5. **Colors:** the rebuild palette MUST anchor on `_brand.json.colors.primary` (and `secondary` if present). NEVER pick a generic platform palette (e.g. `#0a0a1a` violet) when extracted colors exist.',
          '6. **preserve_source_design:** when `true`, mirror source homepage hero/section structure + section order + color scheme + typography pairings before adding our polish. Do NOT introduce a wholly different layout style.',
          '',
          'Validation gate (write `_brand_audit.json` after `npm run build`, before fanout-1):',
          '`{ fonts_match: bool, theme_match: bool, image_reuse_pct: number, logo_used: bool, palette_anchored: bool }`. If any field is false / pct < 0.7, regenerate the offending section IMMEDIATELY before invoking subagents — do NOT defer brand-fidelity issues to validator-fixer.',
        ].join('\n')
      : 'No source URL was provided OR source-brand extraction failed. Use platform defaults: Inter/Space Grotesk fonts, dark theme, all imagery from Unsplash/Pexels/DALL-E. Note this in `_brand_audit.json` so the next iteration can self-correct.',
    '',
    '## Optional Context Files (read if present)',
    '_research.json, _image_profiles.json, _videos.json, _places.json, _form_data.json, _domain_features.json, _citations.json, _uploaded_assets.json (user uploads from /create — keys[] + urls[], must be referenced in the rebuilt HTML when present)',
    '',
    '## Architecture: Orchestrator + Parallel Subagents',
    'You are the ORCHESTRATOR. You do not write components yourself — you delegate. Subagents have isolated context windows, so fan-out is free. Issue every parallel Task call in a SINGLE message; sequential dispatch defeats the architecture.',
    '',
    '## Available Subagents',
    'Universal (from heymegabyte/claude-skills, synced into ~/.claude/agents/):',
    '- visual-qa — screenshots 6 breakpoints + AI vision. Audit-only.',
    '- seo-auditor — title/meta/H1/JSON-LD/OG/sitemap. Audit-only.',
    '- accessibility-auditor — axe-core WCAG 2.2 AA at 6 breakpoints. Audit-only.',
    '- performance-profiler — Lighthouse + CWV + bundle budgets. Audit-only.',
    '- completeness-checker — Zero Recommendations Gate, final ship verdict.',
    '- content-writer — Emdash brand voice copy, Flesch >= 60.',
    '- security-reviewer — OWASP audit. Audit-only.',
    'Project-specific (~/.claude/agents/ overlay):',
    '- domain-builder — donation/menu/booking/medical/child-safety/local-business sections, NEW files only in src/components/sections/.',
    '- validator-fixer — runs `node /home/cuser/run-validators.mjs dist`, applies surgical fixes for the 13 build_validators violation codes (manifest/asset/image/og/icon/meta/jsonld/html/sitemap/copy/js/lightbox).',
    '',
    '## Orchestration Loop (write phase marker BEFORE each step)',
    '0. `printf "%s" "boot" > .build-phase` — sanity check tools (`claude --version`, `node -v`).',
    '1. `printf "%s" "research" > .build-phase` — Read every _ context file + skill 15.',
    '2. `printf "%s" "customize" > .build-phase` — `cp -r ~/template/. <build dir>/` FIRST, then `cd <build dir>`. Customize IN PLACE: token-swap brand colors in `tailwind.config.ts` + `src/index.css`, replace logo asset under `public/`, edit page composition, drop content into existing sections. Reuse template components — do NOT recreate Button/Card/Hero/Nav/Footer. New files allowed only under `src/components/sections/`. This is the ONLY work you do directly.',
    '3. `printf "%s" "build-1" > .build-phase` — `npm run build`. Then write `_template_audit.json` per L10. If audit fails (from-scratch components present), refactor to use template equivalents BEFORE proceeding to fanout-1.',
    '4. `printf "%s" "fanout-1" > .build-phase` — PARALLEL FAN-OUT (single message, multiple Task calls):',
    '   - domain-builder: create section components from _domain_features.json',
    '   - visual-qa: screenshot all routes 6 breakpoints + GPT-4o critique',
    '   - seo-auditor: title/meta/H1/JSON-LD/OG/sitemap audit',
    '   - accessibility-auditor: axe-core 6 breakpoints',
    '   - performance-profiler: Lighthouse + bundle budgets',
    '5. `printf "%s" "fix-1" > .build-phase` — Collect reports. Route to fix-capable agents:',
    '   - Copy/voice issues -> content-writer',
    '   - HTML shell / asset / meta / JSON-LD / sitemap / lightbox / js-chunk fixes -> validator-fixer',
    '   - Accessibility/perf remediation -> validator-fixer (uses audit reports as input; it has Edit)',
    '6. `printf "%s" "build-N" > .build-phase` — Rebuild. Run validator-fixer until `blockers === 0` from run-validators.mjs (MAX 4 rebuild loops, increment N each pass).',
    '7. `printf "%s" "completeness-1" > .build-phase` — completeness-checker as final gate. If NOT_DONE AND fanout cycles < 3, increment to `fanout-2|fix-2|completeness-2` and loop. If caps hit, write `WARNINGS.md` and ship-with-warnings.',
    '8. `printf "%s" "upload" > .build-phase` — `node /home/cuser/upload-to-r2.mjs` to publish. Env vars CF_API_TOKEN, CF_ACCOUNT_ID, R2_BUCKET_NAME, SITE_SLUG, SITE_VERSION are set.',
    '9. `printf "%s" "done" > .build-phase` — exit cleanly.',
    '',
    '## Hard Rules',
    '- Spawn parallel subagents in a SINGLE message with multiple Task calls.',
    '- File partition: domain-builder owns src/components/sections/, validator-fixer owns public/ + index.html shell + vite.config.ts + package.json + sitemap.xml. Never let two agents in one fan-out edit the same file.',
    '- Audit-only agents (visual-qa, seo-auditor, accessibility-auditor, performance-profiler, security-reviewer) MUST NOT be asked to edit. Forward their reports to validator-fixer or content-writer.',
    '- Stripe/Linear/Vercel-level polish. 10+ animations, 15+ images, dark theme by default, WCAG 2.2 AA, 6 breakpoints (375/390/768/1024/1280/1920), zero console errors.',
    '- DONE = blockers === 0 from run-validators.mjs AND completeness-checker returns DONE.',
    '',
    params.additionalContext ? `## Customer Expert Notes (Directive v1 L6 — TREAT AS HIGH AUTHORITY)\nThe owner provided these notes via the /create chat panel. They were already AI-polished. Lean on them for tone, USPs, and audience. Reference them by quoting key phrases in homepage hero copy + about section.\n\n<expertNotes>\n${params.additionalContext}\n</expertNotes>` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Cloudflare Workflow for AI site generation.
 *
 * Uses heartbeat polling pattern:
 * 1. start-build: POST to container, get jobId
 * 2. heartbeat-N: Poll status every 30s (tiny steps, no timeout risk)
 * 3. fetch-result: GET files when complete
 * 4. upload-to-r2: Upload files + update D1
 */
export class SiteGenerationWorkflow extends WorkflowEntrypoint<Env, SiteGenerationParams> {
  override async run(
    event: Readonly<WorkflowEvent<SiteGenerationParams>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const params = event.payload;
    const env = this.env;
    const startTime = Date.now();

    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.started', {
      slug: params.slug,
      business_name: params.businessName,
      business_address: params.businessAddress ?? null,
      google_place_id: params.googlePlaceId ?? null,
      has_additional_context: !!params.additionalContext,
      message: 'AI build workflow started for ' + params.businessName + ' (' + params.slug + ')',
    });

    await updateSiteStatus(env.DB, params.siteId, 'generating');

    // ── Validate container binding ──
    if (!env.SITE_BUILDER) {
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw new Error('SITE_BUILDER container not configured');
    }

    // ── Pre-build Anthropic credit gate (audit hardening 2026-05-09) ──
    // 1-token probe to https://api.anthropic.com/v1/messages catches an empty
    // credit balance BEFORE we burn 25-40 minutes of container time on a
    // claude -p invocation that will silently exit with code=0 and produce
    // a template-only dist that masquerades as workflow.complete.
    // Costs ~1 token / build. Skipped in stubMode (no real claude call) AND
    // when subscription OAuth is configured (Max plan has no credit-balance
    // failure mode — over-quota looks like 429 rate_limit_exceeded which
    // recovers on its own; container-side `claude -p` handles its own retry).
    const anthropicKey = typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY : '';
    const usingSubscription = hasClaudeOauth(env);
    if (anthropicKey && !params.stubMode && !usingSubscription) {
      const probe = await step.do('anthropic-credit-probe', {
        retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
        timeout: '30 seconds',
      }, async () => {
        try {
          const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': anthropicKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: 'claude-haiku-4-5',
              max_tokens: 1,
              messages: [{ role: 'user', content: 'ok' }],
            }),
          });
          const bodyText = await res.text();
          // 200 = credits OK. 400 with "credit balance is too low" = blocked.
          // 401/403/429 = surface but don't conflate with credit exhaustion.
          if (res.status === 400 && /credit balance is too low/i.test(bodyText)) {
            return { ok: false, code: 'anthropic_credit_balance_too_low' as const, status: res.status, body: bodyText.slice(0, 400) };
          }
          if (res.ok) return { ok: true as const, status: res.status };
          return { ok: false, code: 'anthropic_probe_non_200' as const, status: res.status, body: bodyText.slice(0, 400) };
        } catch (err) {
          // Network errors don't gate the build — better to attempt than to block on transient DNS.
          return { ok: true as const, status: 0, note: `probe network error: ${String(err).slice(0, 200)}` };
        }
      });

      if (!probe.ok) {
        await updateSiteStatus(env.DB, params.siteId, 'error');
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.preflight_error', {
          code: probe.code,
          http_status: probe.status,
          response_body: probe.body,
          message:
            probe.code === 'anthropic_credit_balance_too_low'
              ? 'Anthropic credit balance too low — refusing to start build. Top up at https://console.anthropic.com/settings/billing.'
              : `Anthropic credit probe failed (HTTP ${probe.status}) — refusing to start build.`,
        });
        throw new Error(`Pre-build credit probe failed: ${probe.code}`);
      }
    }

    // Container DO naming strategy:
    //   - Iteration 1 (or no iteration set): per-run nonce — fresh DO + container,
    //     eliminates stale-image problems, disposable.
    //   - Iteration > 1 (convergence loop): stable name, no nonce — DO + Linux
    //     container are reused across iterations so node_modules, ~/.cache/vite,
    //     the ~/template clone, and the ~/.agentskills clone all survive between
    //     iterations. State persistence still comes from KV-backed callbacks,
    //     not container disk; warm-keep is purely a perf win.
    //
    // Wins per warm-iteration vs cold:
    //   - skip ~/template git pull   (~5-10s)
    //   - skip ~/.agentskills git pull (~5-10s)
    //   - skip npm install in build dir (~30-90s on cold cache)
    //   - skip Vite first-build prebundle (~10-20s)
    // Total: ~60-130s saved per iteration after the first.
    const iteration = typeof params.iteration === 'number' && params.iteration > 0 ? params.iteration : 1;
    const isWarm = iteration > 1;
    const runNonce = Date.now().toString(36);
    const containerName = isWarm
      ? `${params.slug}-build-${params.siteId.slice(0, 8)}`
      : `${params.slug}-build-${params.siteId.slice(0, 8)}-${runNonce}`;
    const containerId = env.SITE_BUILDER.idFromName(containerName);
    const getContainer = () => env.SITE_BUILDER!.get(containerId);

    if (isWarm) {
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.warm_container_reuse', {
        iteration,
        container_name: containerName,
        prior_recommendations_count: params.priorRecommendations?.length ?? 0,
        message: `Convergence iteration ${iteration} — reusing warm container ${containerName}`,
      });
    }

    // ── Minimal mode: short-circuit, prove container infra ──
    if (params.minimalMode) {
      const minimalRes = await step.do(
        'minimal-build',
        { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '3 minutes' },
        async () => {
          const container = getContainer();
          const res = await container.fetch('http://container/build-minimal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              slug: params.slug,
              envVars: {
                CF_API_TOKEN: typeof env.CF_API_TOKEN === 'string' ? env.CF_API_TOKEN : '',
                CF_ACCOUNT_ID: '84fa0d1b16ff8086dd958c468ce7fd59',
                R2_BUCKET_NAME: 'project-sites-production',
                SITE_SLUG: params.slug,
                SITE_VERSION: `v-${Date.now()}`,
              },
            }),
          });
          if (!res.ok) throw new Error(`build-minimal HTTP ${res.status}`);
          return await res.text();
        },
      );
      const parsed = JSON.parse(minimalRes) as { ok: boolean; uploadResult?: { uploaded?: number }; stdoutTail?: string; elapsedMs?: number };
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.minimal_done', {
        ok: parsed.ok,
        uploaded: parsed.uploadResult?.uploaded ?? 0,
        elapsedMs: parsed.elapsedMs,
        stdoutTail: parsed.stdoutTail,
      });
      if (parsed.ok) {
        await updateSiteStatus(env.DB, params.siteId, 'published');
        return { ok: true, mode: 'minimal', uploaded: parsed.uploadResult?.uploaded };
      }
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw new Error('minimal build failed: ' + (parsed.stdoutTail || 'unknown'));
    }

    // ── Stub mode: validate KV-callback persistence end-to-end (no API cost) ──
    if (params.stubMode) {
      const stubJobId = await step.do('stub-start-build', {
        retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
        timeout: '5 minutes',
      }, async () => {
        const container = getContainer();
        const cbSecret = env.INTERNAL_BUILD_SECRET || '';
        const cbUrl = env.INTERNAL_CALLBACK_URL || `https://${DOMAINS.SITES_BASE}/api/internal/build-status`;
        const res = await container.fetch('http://container/build-stub', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: params.slug, callbackUrl: cbUrl, callbackSecret: cbSecret }),
        });
        if (!res.ok) throw new Error(`stub start failed: ${res.status}`);
        const r = await res.json() as { jobId?: string; error?: string };
        if (r.error || !r.jobId) throw new Error(`stub start error: ${r.error ?? 'no jobId'}`);
        return r.jobId;
      });

      let stubFinal: KvBuildRecord | null = null;
      for (let i = 0; i < 30; i++) {
        const status = await step.do(`stub-heartbeat-${i}`, {
          retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
          timeout: '1 minute',
        }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 6_000));
          const raw = await env.CACHE_KV.get(`build:${stubJobId}`);
          return raw || JSON.stringify({ _missing: true });
        });
        const parsed = JSON.parse(status) as KvBuildRecord & { _missing?: boolean };
        if (parsed._missing) continue;
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.stub_heartbeat', {
          poll: i, status: parsed.status, step: parsed.step,
          message: `stub poll ${i}: ${parsed.status} ${parsed.step}`,
        });
        if (parsed.status !== 'running') { stubFinal = parsed; break; }
      }
      if (!stubFinal || stubFinal.status !== 'complete') {
        throw new Error(`stub mode failed: ${JSON.stringify(stubFinal)}`);
      }
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.stub_done', {
        jobId: stubJobId,
        uploadResult: stubFinal.uploadResult,
        message: 'KV-callback persistence proof: complete',
      });
      return { ok: true, mode: 'stub', jobId: stubJobId, kvFinal: stubFinal };
    }

    // ── Move uploaded assets (if any) ──
    let assetManifest: string[] = params.uploadedAssets || [];
    if (params.uploadId) {
      try {
        const moved = await step.do('move-uploaded-assets', {
          retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' },
          timeout: '1 minute',
        }, async () => {
          const prefix = `uploads/${params.uploadId}/`;
          const listed = await env.SITES_BUCKET.list({ prefix, limit: 50 });
          const movedKeys: string[] = [];
          for (const obj of listed.objects) {
            const relativePath = obj.key.replace(prefix, '');
            const destKey = `sites/${params.slug}/assets/${relativePath}`;
            const data = await env.SITES_BUCKET.get(obj.key);
            if (data) {
              await env.SITES_BUCKET.put(destKey, await data.arrayBuffer(), {
                httpMetadata: data.httpMetadata,
              });
              movedKeys.push(destKey);
            }
          }
          return JSON.stringify(movedKeys);
        });
        assetManifest = [...assetManifest, ...JSON.parse(moved)];
      } catch {
        // Non-blocking — continue without uploaded assets
      }
    }

    // ── Resolve source website URL (fallback chain) ──
    // The /create + /reset endpoints don't always pass businessWebsite. Without
    // a URL the next step silently no-ops and the build loses brand fidelity.
    // Chain: explicit param → Google Places (when name+address) → slug-derived TLD probe.
    let resolvedWebsite = (params.businessWebsite || '').trim();
    let resolveMethod: 'param' | 'google_places' | 'slug_probe' | 'none' = resolvedWebsite
      ? 'param'
      : 'none';

    if (!resolvedWebsite && params.businessName) {
      try {
        resolvedWebsite = await step.do(
          'resolve-source-website-google-places',
          { retries: { limit: 1, delay: '5 seconds' }, timeout: '30 seconds' },
          async () => {
            const apiKey =
              typeof env.GOOGLE_PLACES_API_KEY === 'string' ? env.GOOGLE_PLACES_API_KEY : undefined;
            if (!apiKey) return '';
            const result = await lookupBusiness(
              apiKey,
              params.businessName,
              params.businessAddress || '',
            );
            return (result?.website || '').trim();
          },
        );
        if (resolvedWebsite) resolveMethod = 'google_places';
      } catch {
        // Non-blocking
      }
    }

    if (!resolvedWebsite && params.slug) {
      try {
        resolvedWebsite = await step.do(
          'resolve-source-website-slug-probe',
          { retries: { limit: 1, delay: '3 seconds' }, timeout: '30 seconds' },
          async () => {
            const slug = params.slug.replace(/[^a-z0-9-]/gi, '').toLowerCase();
            if (!slug) return '';
            const candidates = [
              `https://${slug}.com`,
              `https://www.${slug}.com`,
              `https://${slug}.org`,
              `https://${slug}.net`,
            ];
            const ua =
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
            for (const url of candidates) {
              try {
                const res = await fetch(url, {
                  method: 'GET',
                  headers: {
                    'User-Agent': ua,
                    Accept: 'text/html,application/xhtml+xml',
                  },
                  signal: AbortSignal.timeout(8000),
                });
                if (res.ok && res.status < 400) {
                  const ct = res.headers.get('content-type') || '';
                  if (ct.includes('text/html')) return url;
                }
              } catch {
                // try next
              }
            }
            return '';
          },
        );
        if (resolvedWebsite) resolveMethod = 'slug_probe';
      } catch {
        // Non-blocking
      }
    }

    if (resolvedWebsite && resolveMethod !== 'param') {
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.source_website_resolved', {
        source_url: resolvedWebsite,
        method: resolveMethod,
        message: `Resolved source website via ${resolveMethod}: ${resolvedWebsite}`,
      });
    }

    // ── Extract source-site brand (fonts/logo/colors/images/routes) ──
    // Suped-up-clone contract requires deterministic source extraction BEFORE
    // the orchestrator runs. Without this the container falls back to platform
    // defaults (Inter/Space Grotesk, dark theme, 0 source images) which
    // destroys brand identity. See feedback_brand_fidelity_regression memory.
    let brandContext: { brandJson: string; assetsJson: string; scrapedJson: string } | null = null;
    const canonicalBrand = getCanonicalBrand(params.slug);
    if (resolvedWebsite) {
      try {
        const extracted = await step.do(
          'extract-source-brand',
          { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '3 minutes' },
          async () => {
            // Canonical-brand short-circuit. When the slug has a hardcoded
            // contract (see services/canonical_brand_overrides.ts), it MUST
            // win over the LLM extraction. The contract is bundled at build
            // time from the actual `_brand.json` payload of a previously-
            // blessed reference build — see scripts/lmg-canonical-brand.json
            // and memory pin feedback_brand_fidelity_regression.md.
            let brand = await extractSourceBrand(resolvedWebsite, {
              openaiKey: env.OPENAI_API_KEY,
            });
            if (canonicalBrand) {
              brand = applyCanonicalBrandOverride(canonicalBrand, brand);
            }
            const persisted = await persistSourceBrand(env.SITES_BUCKET, params.slug, brand);
            return JSON.stringify({
              ...persisted,
              summary: {
                theme: brand.theme,
                preserve: brand.preserve_source_design,
                cms: brand.cms,
                fonts: brand.fonts,
                logo: brand.logo,
                primary: brand.colors.primary,
                background: brand.colors.background,
                asset_count: brand.assets.length,
                route_count: brand.routes.length,
                warnings: brand.warnings,
                canonical_override: canonicalBrand ? canonicalBrand.source_build : null,
              },
            });
          },
        );
        const parsed = JSON.parse(extracted) as {
          brandJson: string;
          assetsJson: string;
          scrapedJson: string;
          summary: Record<string, unknown>;
        };
        brandContext = {
          brandJson: parsed.brandJson,
          assetsJson: parsed.assetsJson,
          scrapedJson: parsed.scrapedJson,
        };
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.source_brand_extracted', {
          source_url: resolvedWebsite,
          ...parsed.summary,
          message: `Source brand extracted: theme=${parsed.summary.theme}, fonts=${JSON.stringify((parsed.summary.fonts as { google_fonts: string[] }).google_fonts)}, ${parsed.summary.asset_count} assets, ${parsed.summary.route_count} routes`,
        });
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.source_brand_extraction_failed', {
          source_url: resolvedWebsite,
          error: err instanceof Error ? err.message : String(err),
          message: 'Source brand extraction failed — orchestrator will use defaults',
        });
      }
    }

    // When extraction failed (or source URL absent) but a canonical contract
    // is registered, persist the synthetic payload so the orchestrator still
    // gets a build-breaking brand contract instead of platform defaults.
    if (!brandContext && canonicalBrand) {
      try {
        const synthetic = await step.do(
          'canonical-brand-fallback',
          { retries: { limit: 1, delay: '2 seconds' }, timeout: '30 seconds' },
          async () => {
            const brand = canonicalBrandToSourceBrand(canonicalBrand);
            const persisted = await persistSourceBrand(env.SITES_BUCKET, params.slug, brand);
            return JSON.stringify(persisted);
          },
        );
        const parsed = JSON.parse(synthetic) as {
          brandJson: string;
          assetsJson: string;
          scrapedJson: string;
        };
        brandContext = parsed;
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.canonical_brand_applied', {
          slug: params.slug,
          source_build: canonicalBrand.source_build,
          fonts: canonicalBrand.fonts,
          primary: canonicalBrand.primary,
          theme: canonicalBrand.theme,
          message: `Canonical brand contract applied (source: ${canonicalBrand.source_build})`,
        });
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.canonical_brand_failed', {
          slug: params.slug,
          error: err instanceof Error ? err.message : String(err),
          message: 'Canonical brand fallback failed — orchestrator will use defaults',
        });
      }
    }

    // ── Build the prompt + context ──
    const promptParams: SiteGenerationParams = resolvedWebsite
      ? { ...params, businessWebsite: resolvedWebsite }
      : params;
    const prompt = buildPrompt(promptParams, !!brandContext);

    // Mint version inside step.do so workflow replay returns the cached value.
    // Without this, line `new Date().toISOString()` re-runs on replay and produces
    // a fresh timestamp — finalize-build then writes the wrong R2 prefix to D1
    // and the live site 404s while R2 has files at the *original* version path.
    const version = await step.do(
      'mint-version',
      { retries: { limit: 0, delay: '1 second' }, timeout: '30 seconds' },
      async () => new Date().toISOString().replace(/[:.]/g, '-'),
    );
    const budgetTier: BudgetTier = params.budgetTier || 'free';
    const budgetCaps = TIER_CAPS[budgetTier];
    const envVars: Record<string, string> = {
      // R2 upload credentials (used by /home/cuser/upload-to-r2.mjs)
      CF_API_TOKEN: typeof env.CF_API_TOKEN === 'string' ? env.CF_API_TOKEN : '',
      CF_ACCOUNT_ID: '84fa0d1b16ff8086dd958c468ce7fd59',
      R2_BUCKET_NAME: 'project-sites-production',
      SITE_SLUG: params.slug,
      SITE_VERSION: version,
      // Budget tier caps — read by container orchestrator + image_generation pipeline.
      BUDGET_TIER: budgetTier,
      MAX_GENERATED_IMAGES: String(budgetCaps.max_generated_images),
      VIDEO_ENABLED: budgetCaps.video_enabled ? '1' : '0',
      PODCAST_ENABLED: budgetCaps.podcast_enabled ? '1' : '0',
      IMMERSIVE_ENABLED: budgetCaps.immersive_enabled ? '1' : '0',
    };
    const keysToCopy: (keyof Env)[] = [
      'OPENAI_API_KEY', 'UNSPLASH_ACCESS_KEY', 'PEXELS_API_KEY', 'PIXABAY_API_KEY',
      'YOUTUBE_API_KEY', 'LOGODEV_TOKEN', 'BRANDFETCH_API_KEY', 'FOURSQUARE_API_KEY',
      'YELP_API_KEY', 'GOOGLE_PLACES_API_KEY', 'GOOGLE_CSE_KEY', 'GOOGLE_CSE_CX',
      'IDEOGRAM_API_KEY', 'REPLICATE_API_TOKEN', 'STABILITY_API_KEY',
      'GOOGLE_MAPS_API_KEY', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET', 'MAPBOX_ACCESS_TOKEN',
    ];
    for (const key of keysToCopy) {
      const val = env[key];
      if (typeof val === 'string' && val) envVars[key] = val;
    }

    // Context files: uploaded-asset manifest + extracted source brand.
    // Underscored names mirror the orchestrator's "read every _ context file" instruction
    // and the R2 keys at sites/{slug}/assets/_*.json that the public API serves.
    // CRITICAL: keep `_uploaded_assets.json` (user uploads from /create) distinct from
    // `_assets.json` (scraped source-site media). They are different artifacts and a
    // shared filename overwrites the brand extractor output inside the container.
    const contextFiles: Record<string, string> = {};
    if (assetManifest.length > 0) {
      const assetUrls = assetManifest.map((key) =>
        `https://${params.slug}${DOMAINS.SITES_SUFFIX}/assets/${key.split('/').pop()}`
      );
      contextFiles['_uploaded_assets.json'] = JSON.stringify({ keys: assetManifest, urls: assetUrls }, null, 2);
    }
    if (brandContext) {
      contextFiles['_brand.json'] = brandContext.brandJson;
      contextFiles['_assets.json'] = brandContext.assetsJson;
      contextFiles['_scraped_content.json'] = brandContext.scrapedJson;
    }
    contextFiles['_build_caps.json'] = JSON.stringify({ tier: budgetTier, caps: budgetCaps }, null, 2);

    // ── Step 1: Start build (POST to container) ──
    // Use workers.dev URL to bypass zone-level CF managed challenge intercepting POSTs.
    const callbackSecret = env.INTERNAL_BUILD_SECRET || '';
    const callbackUrl = env.INTERNAL_CALLBACK_URL || `https://${DOMAINS.SITES_BASE}/api/internal/build-status`;

    // Refresh subscription OAuth token on the worker side (workers can fetch the
    // OAuth endpoint; containers cannot reach console.anthropic.com from inside
    // CF Containers without the worker proxying). The container then writes the
    // returned blob to `~/.claude/.credentials.json` so `claude -p` runs under
    // Brian's Max 20x quota instead of metered API credits.
    let claudeOauthForContainer: { accessToken: string; refreshToken: string; expiresAt: number } | null = null;
    if (usingSubscription) {
      try {
        claudeOauthForContainer = await getValidClaudeOauth(env);
      } catch (err) {
        // Refresh failure means the seeded refresh token was revoked or expired.
        // Credit-minimization policy (2026-05-10): fail-closed instead of falling
        // back to metered API key. A failed build on the flat-rate subscription
        // costs $0; a 33-min build on API key costs ~$5-15. Operator must re-seed
        // OAuth (scripts/import-claude-oauth.mjs) to retry.
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.oauth_refresh_failed', {
          error: err instanceof Error ? err.message : String(err),
          message: 'Subscription OAuth refresh failed — aborting build to avoid burning metered API credits.',
        });
        await updateSiteStatus(env.DB, params.siteId, 'error');
        throw new Error(
          'Anthropic OAuth refresh failed and API-key fallback is disabled (credit-minimization). Re-seed OAuth via scripts/import-claude-oauth.mjs.',
        );
      }
    }

    const jobId = await step.do('start-build', {
      retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
      timeout: '5 minutes',
    }, async () => {
      const container = getContainer();

      const payload = {
        slug: params.slug,
        _anthropicKey: claudeOauthForContainer ? '' : env.ANTHROPIC_API_KEY || '',
        _claudeOauth: claudeOauthForContainer,
        prompt,
        contextFiles,
        envVars,
        timeoutMin: 45,
        callbackUrl,
        callbackSecret,
        // Convergence-loop hints — container reuses prior build dir + node_modules
        // when iteration > 1 instead of cp -r ~/template/. <build dir>/.
        iteration,
        warmReuse: isWarm,
        priorRecommendations: params.priorRecommendations ?? [],
      };

      const res = await container.fetch('http://container/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown');
        throw new Error(`Container start failed: ${res.status} ${errText}`);
      }

      const result = await res.json() as { jobId?: string; error?: string };
      if (result.error) throw new Error(`Container start error: ${result.error}`);
      if (!result.jobId) throw new Error('Container did not return jobId');

      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.build_started', {
        jobId: result.jobId,
        prompt_length: prompt.length,
        env_vars_count: Object.keys(envVars).length,
        message: `Claude Code build started (${Math.round(prompt.length / 1024)}KB prompt, ${Object.keys(envVars).length} API keys)`,
      });

      return result.jobId;
    });

    // ── Step 2: Heartbeat loop polls container directly with KV fallback ──
    // Each heartbeat sleeps 30s, then hits the container's /status. The inbound
    // HTTP traffic on a regular cadence keeps the DO warm (preventing the idle
    // hibernation that froze the previous KV-only heartbeat at the 2-min mark).
    // The container also runs its own 60s self-keepalive (/health). KV is the
    // durable fallback if the container fetch errors (DO replaced, etc).
    const MAX_POLLS = 120;
    const POLL_INTERVAL_MS = 30_000;
    const STALE_THRESHOLD_MS = 8 * 60_000;

    let finalStatus: ContainerStatus | null = null;
    let kvFinalRecord: KvBuildRecord | null = null;
    let lastFreshAt = Date.now();
    let lastSeenStatus: string | null = null;
    let lastSeenStep: string | null = null;

    for (let i = 0; i < MAX_POLLS; i++) {
      const result = await step.do(`heartbeat-${i}`, {
        retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
        timeout: '1 minute',
      }, async () => {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        // Primary: short-poll the container directly. Inbound HTTP keeps DO warm.
        try {
          const container = getContainer();
          const res = await container.fetch(`http://container/status?jobId=${jobId}`, { method: 'GET' });
          if (res.ok) {
            const body = await res.text();
            return JSON.stringify({ _src: 'container', body });
          }
        } catch {
          // fall through to KV fallback
        }

        // Fallback: KV record (set by container's pushStatus callback). Survives DO replacement.
        const raw = await env.CACHE_KV.get(`build:${jobId}`);
        if (!raw) return JSON.stringify({ _src: 'kv', _missing: true });
        return JSON.stringify({ _src: 'kv', body: raw });
      });

      const wrap = JSON.parse(result) as { _src: string; _missing?: boolean; body?: string };

      if (wrap._missing) {
        if (i >= 4) {
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.kv_no_status', {
            poll: i,
            message: 'No build status in KV after 2min — container failed to start',
          });
          finalStatus = { status: 'error', step: 'no-callback', elapsed: 0, fileCount: 0, error: 'Container never reported status to KV' };
          break;
        }
        continue;
      }

      const parsed = JSON.parse(wrap.body || '{}') as KvBuildRecord & ContainerStatus & { error?: string | null };

      const TERMINAL = new Set(['complete', 'error']);
      const unknownJob = wrap._src === 'container' && parsed.status === undefined;

      // Container DO restart → /status returns {error:'unknown job'} with no `status` field.
      // First try KV (terminal record may exist from before the DO died). If KV is empty too,
      // the job is unrecoverable — break immediately instead of polling for 8 more minutes.
      if (unknownJob) {
        const raw = await env.CACHE_KV.get(`build:${jobId}`);
        if (raw) {
          const kv = JSON.parse(raw) as KvBuildRecord;
          if (TERMINAL.has(kv.status)) {
            finalStatus = {
              status: kv.status,
              step: kv.step,
              elapsed: kv.elapsed,
              fileCount: kv.fileCount,
              error: kv.error || null,
              stdoutTail: kv.stdoutTail ?? null,
              stderrTail: kv.stderrTail ?? null,
              claudeExitCode: kv.claudeExitCode ?? null,
              claudeRanSeconds: kv.claudeRanSeconds ?? null,
              errorClass: kv.errorClass ?? null,
            };
            kvFinalRecord = kv;
            break;
          }
        }
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.container_unknown_job', {
          poll: i,
          message: 'Container DO lost job and KV has no terminal record — abandoning build',
        });
        finalStatus = {
          status: 'error',
          step: 'unknown-job',
          elapsed: 0,
          fileCount: 0,
          error: 'Container DO evicted before build completed (job state lost)',
        };
        break;
      }

      // Container /status returns plain ContainerStatus (no lastUpdate). For wall-clock
      // freshness, treat every successful container response as fresh; KV path uses lastUpdate.
      const isFromContainer = wrap._src === 'container';
      const ageMs = isFromContainer
        ? (Date.now() - lastFreshAt)
        : (Date.now() - ((parsed as KvBuildRecord).lastUpdate || 0));

      const stateChanged = parsed.status !== lastSeenStatus || parsed.step !== lastSeenStep;
      // Only bump freshness on responses with a real status; unknown-job (handled above)
      // would otherwise mask staleness forever.
      if (isFromContainer && parsed.status) lastFreshAt = Date.now();
      lastSeenStatus = parsed.status || lastSeenStatus;
      lastSeenStep = parsed.step || lastSeenStep;

      if (i % 5 === 0 || stateChanged) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.heartbeat', {
          poll: i,
          src: wrap._src,
          status: parsed.status,
          step: parsed.step,
          elapsed_seconds: parsed.elapsed,
          file_count: parsed.fileCount,
          age_ms: ageMs,
          message: `heartbeat ${i} (${wrap._src}): status=${parsed.status}, step=${parsed.step}, elapsed=${parsed.elapsed}s`,
        });
      }

      if (TERMINAL.has(String(parsed.status))) {
        finalStatus = {
          status: parsed.status,
          step: parsed.step,
          elapsed: parsed.elapsed,
          fileCount: parsed.fileCount,
          error: parsed.error || null,
          stdoutTail: parsed.stdoutTail ?? null,
          stderrTail: parsed.stderrTail ?? null,
          claudeExitCode: parsed.claudeExitCode ?? null,
          claudeRanSeconds: parsed.claudeRanSeconds ?? null,
          errorClass: parsed.errorClass ?? null,
        };
        // Both KV records and container /status responses include uploadResult.
        // Capture it from whichever source delivered the terminal status.
        kvFinalRecord = parsed as KvBuildRecord;
        break;
      }

      if (ageMs > STALE_THRESHOLD_MS) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.container_stale', {
          poll: i,
          age_ms: ageMs,
          message: `Status stale ${(ageMs / 1000) | 0}s — container died without reporting completion`,
        });
        finalStatus = {
          status: 'error',
          step: 'stale',
          elapsed: parsed.elapsed,
          fileCount: parsed.fileCount,
          error: 'Container stopped reporting status (stale)',
          stdoutTail: parsed.stdoutTail ?? null,
          stderrTail: parsed.stderrTail ?? null,
          claudeExitCode: parsed.claudeExitCode ?? null,
          claudeRanSeconds: parsed.claudeRanSeconds ?? null,
          errorClass: parsed.errorClass ?? null,
        };
        break;
      }
    }

    if (!finalStatus) {
      await updateSiteStatus(env.DB, params.siteId, 'error');
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.timeout', {
        message: `Build timed out after ${MAX_POLLS} polls (${MAX_POLLS * 30}s)`,
      });
      throw new Error('Build timed out after ' + MAX_POLLS + ' heartbeat polls');
    }

    if (finalStatus.status === 'error') {
      await updateSiteStatus(env.DB, params.siteId, 'error');

      // Audit-trail extras (2026-05-09): surface tails + claude exit code +
      // typed errorClass so future operators see the actual failure mode in
      // audit_logs instead of a generic "build failed" line.
      const errorClass = finalStatus.errorClass ?? null;
      const auditAction = errorClass === 'anthropic_credit_balance_too_low'
        ? 'workflow.preflight_error'
        : 'workflow.build_error';
      const codeMsg = errorClass === 'anthropic_credit_balance_too_low'
        ? 'Anthropic credit balance too low — claude -p exited without doing real work. Top up at https://console.anthropic.com/settings/billing.'
        : `Build failed after ${finalStatus.elapsed}s: ${finalStatus.error}`;

      await workflowLog(env.DB, params.orgId, params.siteId, auditAction, {
        error: finalStatus.error,
        error_class: errorClass,
        code: errorClass || 'build_error',
        elapsed_seconds: finalStatus.elapsed,
        claude_exit_code: finalStatus.claudeExitCode ?? null,
        claude_ran_seconds: finalStatus.claudeRanSeconds ?? null,
        stdout_tail: finalStatus.stdoutTail ?? null,
        stderr_tail: finalStatus.stderrTail ?? null,
        message: codeMsg,
      });
      throw new Error(`Build failed${errorClass ? ` (${errorClass})` : ''}: ${finalStatus.error || 'unknown error'}`);
    }

    // ── Step 3: Finalize — verify R2 upload succeeded via KV record ──
    const filesJson = await step.do('finalize-build', {
      retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
      timeout: '2 minutes',
    }, async () => {
      const fileCount = finalStatus!.fileCount || 0;
      // Prefer in-memory record from heartbeat poll. If missing or empty, re-read
      // KV — the container's HMAC-protected callback always writes the canonical
      // uploadResult to `build:${jobId}` regardless of which path saw terminal status first.
      let uploadResult = kvFinalRecord?.uploadResult || null;
      if (!uploadResult || !uploadResult.uploaded) {
        try {
          const raw = await env.CACHE_KV.get(`build:${jobId}`);
          if (raw) {
            const fresh = JSON.parse(raw) as KvBuildRecord;
            if (fresh?.uploadResult) uploadResult = fresh.uploadResult;
          }
        } catch {}
      }
      const uploadCount = uploadResult?.uploaded || 0;

      if (uploadCount === 0) {
        await updateSiteStatus(env.DB, params.siteId, 'error');
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.upload_failed', {
          file_count: fileCount,
          upload_result: uploadResult,
          message: `R2 upload failed — refusing to mark published. uploaded=${uploadCount} failed=${uploadResult?.failed ?? 'n/a'}`,
        });
        throw new Error(`R2 upload produced 0 files (uploadResult=${JSON.stringify(uploadResult)})`);
      }

      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.build_complete', {
        file_count: fileCount,
        upload_count: uploadCount,
        upload_failed: uploadResult?.failed || 0,
        message: `Build complete: ${fileCount} source files, ${uploadCount} files uploaded to R2`,
      });

      // Update D1 status to published
      await env.DB.prepare(
        "UPDATE sites SET status = 'published', current_build_version = ?, updated_at = datetime('now') WHERE id = ?",
      ).bind(version, params.siteId).run();

      // Create initial snapshot
      await env.DB.prepare(
        "INSERT OR IGNORE INTO site_snapshots (id, site_id, snapshot_name, build_version, description) VALUES (?, ?, 'initial', ?, 'First published version')",
      ).bind(crypto.randomUUID(), params.siteId, version).run();

      return JSON.stringify({ fileCount, version });
    });

    // ── Step 3.25: Self-host external assets (hotlink-protection mitigation) ──
    // Scans the published R2 build for external image/asset URLs that aren't in the
    // validator allowlist (e.g. WordPress media on lonemountainglobal.com), downloads
    // each one server-side (no Referer header → bypasses Cloudflare hotlink protection
    // without spoofing), uploads to R2 under `assets/migrated/{hash}.{ext}`, and
    // rewrites the JS/CSS/HTML bundles in place. Idempotent: second run finds zero
    // external URLs and exits early. Non-blocking — failures log to audit and
    // continue, the validator step downstream will catch hard regressions.
    // See: services/asset_migration.ts, incident 2026-05-10 (LMG 21/21 broken images).
    await step.do('migrate-external-assets', {
      retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
      timeout: '5 minutes',
    }, async () => {
      try {
        const report = await migrateExternalAssets(env.SITES_BUCKET, params.slug, version);
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.asset_migration', {
          scanned_files: report.scanned_files,
          unique_urls: report.unique_urls,
          downloaded: report.downloaded,
          uploaded: report.uploaded,
          rewritten_files: report.rewritten_files,
          failed_count: report.failed.length,
          failed_sample: report.failed.slice(0, 10),
          skipped_already_migrated: report.skipped_already_migrated,
          message: report.unique_urls === 0
            ? 'No external assets to migrate'
            : `Migrated ${report.uploaded}/${report.unique_urls} external assets, rewrote ${report.rewritten_files} text files`,
        });
        return JSON.stringify({
          uploaded: report.uploaded,
          rewritten_files: report.rewritten_files,
          failed: report.failed.length,
        });
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.asset_migration_error', {
          error: err instanceof Error ? err.message : String(err),
          message: 'Asset migration failed (non-blocking)',
        });
        return JSON.stringify({ skipped: true });
      }
    });

    // ── Step 3.5: Build validators (report mode — log to D1, never throw) ──
    // Enforces audit recommendations: asset existence, JSON-LD count, image format,
    // og-image quality, apple-touch-icon, meta lengths, H1 in shell, sitemap lastmod,
    // banned slop words, JS chunk size, lightbox presence, required well-known files.
    // See services/build_validators.ts and skill 15 quality-gates.md.
    await step.do('validate-build', {
      retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
      timeout: '2 minutes',
    }, async () => {
      try {
        const prefix = `sites/${params.slug}/${version}/`;
        const files = await loadBuildFromR2(env.SITES_BUCKET, prefix);
        const report = validateBuild(files);
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.build_validation', {
          ok: report.ok,
          file_count: files.length,
          errors: report.errors.slice(0, 50),
          warnings: report.warnings.slice(0, 50),
          summary: report.summary,
          message: `Build validation: ${report.summary}`,
        });
        return JSON.stringify({ ok: report.ok, summary: report.summary });
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.build_validation_error', {
          error: err instanceof Error ? err.message : String(err),
          message: 'Build validation skipped due to error',
        });
        return JSON.stringify({ skipped: true });
      }
    });

    // ── Step 3.5: Source-fidelity check (rebuild only, non-blocking in report mode) ──
    // Compares published rebuild against `_source_screenshot.png` (captured pre-build by
    // the orchestrator). Greenfield builds (no source screenshot in build context) are
    // a no-op. Rebuilds run the GPT-4o rubric: logo_match + color_match + typography_match
    // + hero_structure + overall_fidelity. Threshold pass: logo_match=true AND every other
    // axis ≥7/8. Failure logs `audit_logs.workflow.source_fidelity_fail` for the
    // source-fidelity-fixer subagent to consume on the next build trigger.
    // See: ~/.agentskills/15-site-generation/source-fidelity-loop.md
    //      apps/project-sites/.claude/agents/source-fidelity-fixer.md
    await step.do('source-fidelity-check', {
      retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
      timeout: '3 minutes',
    }, async () => {
      if (!env.OPENAI_API_KEY) return JSON.stringify({ skipped: true, reason: 'no_openai_key' });
      try {
        const sourcePath = `sites/${params.slug}/build-context/_source_screenshot.png`;
        const sourceObj = await env.SITES_BUCKET.get(sourcePath);
        if (!sourceObj) {
          return JSON.stringify({ skipped: true, reason: 'no_source_screenshot_greenfield' });
        }
        const sourceBuf = await sourceObj.arrayBuffer();
        const sourceB64 = btoa(String.fromCharCode(...new Uint8Array(sourceBuf)));

        const rebuildSsUrl = `https://api.microlink.io/?url=https://${params.slug}${DOMAINS.SITES_SUFFIX}&screenshot=true&meta=false&viewport.width=1280&viewport.height=800&embed=screenshot.url`;
        const rebuildSsRes = await fetch(rebuildSsUrl);
        if (!rebuildSsRes.ok) return JSON.stringify({ skipped: true, reason: 'rebuild_screenshot_failed' });
        const rebuildSsData = await rebuildSsRes.json() as { data?: { screenshot?: { url?: string } } };
        const rebuildImgUrl = rebuildSsData?.data?.screenshot?.url;
        if (!rebuildImgUrl) return JSON.stringify({ skipped: true, reason: 'no_rebuild_screenshot_url' });

        const brandRow = await env.SITES_BUCKET.get(`sites/${params.slug}/build-context/_brand.json`);
        const brandJson = brandRow ? await brandRow.json() as Record<string, unknown> : {};

        const scoreRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `Compare these two website screenshots: SOURCE (original brand) vs REBUILD (our regenerated version). Score brand fidelity per the rubric. Brand hint: primary=${(brandJson as { primary?: string }).primary ?? 'unknown'}, fonts=${JSON.stringify((brandJson as { fonts?: unknown }).fonts ?? {})}. Return ONLY this JSON: { "logo_match": boolean, "color_match": 0-10, "typography_match": 0-10, "hero_structure": 0-10, "overall_fidelity": 0-10, "missing_elements": string[], "notes": string }`,
                },
                { type: 'image_url', image_url: { url: `data:image/png;base64,${sourceB64}`, detail: 'high' } },
                { type: 'image_url', image_url: { url: rebuildImgUrl, detail: 'high' } },
              ],
            }],
            max_tokens: 600,
            temperature: 0.1,
          }),
        });
        if (!scoreRes.ok) return JSON.stringify({ skipped: true, reason: 'gpt4o_score_failed' });
        const scoreData = await scoreRes.json() as { choices: { message: { content: string } }[] };
        const raw = scoreData.choices?.[0]?.message?.content || '';
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned) as {
          logo_match?: boolean;
          color_match?: number;
          typography_match?: number;
          hero_structure?: number;
          overall_fidelity?: number;
          missing_elements?: string[];
          notes?: string;
        };

        const passed =
          parsed.logo_match === true &&
          (parsed.color_match ?? 0) >= 7 &&
          (parsed.typography_match ?? 0) >= 7 &&
          (parsed.hero_structure ?? 0) >= 7 &&
          (parsed.overall_fidelity ?? 0) >= 8;

        await workflowLog(
          env.DB,
          params.orgId,
          params.siteId,
          passed ? 'workflow.source_fidelity_pass' : 'workflow.source_fidelity_fail',
          {
            ...parsed,
            rebuild_screenshot_url: rebuildImgUrl,
            message: passed
              ? `Source fidelity PASS: overall=${parsed.overall_fidelity}/10`
              : `Source fidelity FAIL: logo=${parsed.logo_match} color=${parsed.color_match} typo=${parsed.typography_match} hero=${parsed.hero_structure} overall=${parsed.overall_fidelity}`,
          },
        );

        return JSON.stringify({ ok: passed, ...parsed });
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.source_fidelity_error', {
          error: err instanceof Error ? err.message : String(err),
          message: 'Source-fidelity check skipped due to error',
        });
        return JSON.stringify({ skipped: true, reason: 'error' });
      }
    });

    // ── Step 4: Final visual inspection (non-blocking) ──
    await step.do('visual-inspection', {
      retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
      timeout: '2 minutes',
    }, async () => {
      if (!env.OPENAI_API_KEY) return JSON.stringify({ skipped: true, reason: 'no_openai_key' });
      try {
        const ssUrl = `https://api.microlink.io/?url=https://${params.slug}${DOMAINS.SITES_SUFFIX}&screenshot=true&meta=false&embed=screenshot.url`;
        const ssRes = await fetch(ssUrl);
        if (!ssRes.ok) return JSON.stringify({ skipped: true, reason: 'screenshot_failed' });
        const ssData = await ssRes.json() as { data?: { screenshot?: { url?: string } } };
        const imageUrl = ssData?.data?.screenshot?.url;
        if (!imageUrl) return JSON.stringify({ skipped: true, reason: 'no_screenshot_url' });

        const critiqueRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: 'Score this website screenshot 1-10 on visual quality. List top 5 issues. Return JSON: { score: number, issues: string[], logo_visible: boolean, brand_colors_correct: boolean }' },
                { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
              ],
            }],
            max_tokens: 500,
            temperature: 0.2,
          }),
        });
        if (!critiqueRes.ok) return JSON.stringify({ skipped: true, reason: 'gpt4o_failed' });
        const critiqueData = await critiqueRes.json() as { choices: { message: { content: string } }[] };
        const raw = critiqueData.choices?.[0]?.message?.content || '';
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned) as { score?: number; issues?: string[] };

        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.visual_inspection', {
          score: parsed.score,
          issues: parsed.issues,
          screenshot_url: imageUrl,
          message: `Visual inspection: score=${parsed.score}/10, ${(parsed.issues || []).length} issues`,
        });

        return JSON.stringify(parsed);
      } catch {
        return JSON.stringify({ skipped: true, reason: 'error' });
      }
    });

    // ── Step 4.5: Benchmark + retrospective (non-blocking, $0 default) ──
    // Tier 1 (programmatic) + Tier 2 (PSI) both free. Retrospective LLM call
    // (~$0.001 Haiku) only fires when build regressed or score < 0.85.
    // See services/benchmark.ts and services/retrospective.ts.
    await step.do('benchmark-and-learn', {
      retries: { limit: 1, delay: '10 seconds', backoff: 'exponential' },
      timeout: '3 minutes',
    }, async () => {
      try {
        const { runBenchmarks } = await import('../services/benchmark.js');
        const { buildRetrospective, recordRetrospectivePath } = await import('../services/retrospective.js');

        const prevRow = await env.DB.prepare(
          'SELECT id, mean_score FROM site_benchmarks WHERE site_id = ? ORDER BY run_at DESC LIMIT 1',
        ).bind(params.siteId).first() as { id: string; mean_score: number | null } | null;

        const result = await runBenchmarks({
          env,
          siteId: params.siteId,
          slug: params.slug,
          siteUrl: `https://${params.slug}${DOMAINS.SITES_SUFFIX}`,
          previousMeanScore: prevRow?.mean_score ?? null,
        });

        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.benchmark', {
          mean_score: result.meanScore,
          programmatic_score: result.programmatic.score,
          psi_perf: result.psi?.performance ?? null,
          regressed: result.regressedFromPrevious,
          banned_words: result.programmatic.bannedWordHits,
          message: `Benchmark: mean=${result.meanScore.toFixed(2)} regressed=${result.regressedFromPrevious}`,
        });

        const retro = await buildRetrospective({ env, current: result });
        if (!retro.generated) {
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.retrospective_skipped', {
            reason: retro.skipReason,
          });
          return JSON.stringify({ benchmark: result.meanScore, retrospective: 'skipped' });
        }

        const retroRow = await env.DB.prepare(
          'SELECT id FROM site_benchmarks WHERE site_id = ? ORDER BY run_at DESC LIMIT 1',
        ).bind(params.siteId).first() as { id: string } | null;

        const retroPath = `retrospectives/${retro.filename}`;
        await env.SITES_BUCKET.put(retroPath, retro.markdown, {
          httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
        });

        if (retroRow) await recordRetrospectivePath(env, retroRow.id, retroPath);

        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.retrospective_generated', {
          path: retroPath,
          filename: retro.filename,
          message: `Retrospective written to ${retroPath}`,
        });

        return JSON.stringify({ benchmark: result.meanScore, retrospective: retroPath });
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.benchmark_error', {
          error: err instanceof Error ? err.message : String(err),
          message: 'Benchmark/retrospective skipped due to error',
        });
        return JSON.stringify({ skipped: true });
      }
    });

    // ── Step 5: Send notification ──
    await step.do('notify', {
      retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
      timeout: '30 seconds',
    }, async () => {
      try {
        // Look up user email for notification
        const siteRow = await env.DB.prepare(
          'SELECT o.id as org_id FROM sites s JOIN orgs o ON s.org_id = o.id WHERE s.id = ?',
        ).bind(params.siteId).first() as { org_id: string } | null;
        if (siteRow) {
          const userRow = await env.DB.prepare(
            'SELECT u.email FROM memberships m JOIN users u ON m.user_id = u.id WHERE m.org_id = ? LIMIT 1',
          ).bind(siteRow.org_id).first() as { email: string } | null;
          if (userRow?.email) {
            const { notifySiteBuilt } = await import('../services/notifications.js');
            await notifySiteBuilt(env, {
              email: userRow.email,
              siteName: params.businessName,
              slug: params.slug,
              siteUrl: `https://${params.slug}${DOMAINS.SITES_SUFFIX}`,
              version: (JSON.parse(filesJson) as { version: string }).version,
            });
          }
        }
      } catch {
        // Non-critical
      }
      return 'ok';
    });

    const totalSeconds = Math.round((Date.now() - startTime) / 1000);
    const result = JSON.parse(filesJson) as { fileCount: number; version: string };

    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.complete', {
      slug: params.slug,
      url: `https://${params.slug}${DOMAINS.SITES_SUFFIX}`,
      total_seconds: totalSeconds,
      files: result.fileCount,
      version: result.version,
      message: `Published ${params.businessName} with ${result.fileCount} files in ${totalSeconds}s`,
    });

    return {
      siteId: params.siteId,
      slug: params.slug,
      status: 'published',
      files: result.fileCount,
      elapsed_seconds: totalSeconds,
    };
  }
}

