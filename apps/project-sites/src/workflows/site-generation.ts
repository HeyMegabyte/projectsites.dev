/**
 * @module workflows/site-generation
 * @description Cloudflare Workflow for AI-powered site generation.
 *
 * Architecture: Heartbeat polling with async container execution.
 * 1. POST /build to container → starts Claude Code async, returns { jobId }
 * 2. Poll GET /status every 30s via tiny workflow steps (no timeout risk)
 * 3. GET /result when complete → upload files to R2 → update D1
 *
 * Claude Code handles EVERYTHING in a single run:
 * - Business research via curl + API keys
 * - Logo discovery / generation
 * - Website building from template (Vite+React+Tailwind)
 * - GPT-4o self-inspection via inspect.js
 * - Iterative fixes
 *
 * @packageDocumentation
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { Env } from '../types/env.js';
import { DOMAINS } from '@project-sites/shared';
import { loadBuildFromR2, validateBuild } from '../services/build_validators.js';

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
}

/** Container status response shape. */
interface ContainerStatus {
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
interface KvBuildRecord {
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
 * megabytespace/claude-skills (synced into ~/.claude/agents/), project agents
 * are layered on top via the Dockerfile COPY.
 *
 * @see ~/.agentskills/15-site-generation/ for methodology
 * @see /home/cuser/.claude/CLAUDE.md for inherited base instructions
 */
function buildPrompt(params: SiteGenerationParams): string {
  const safeName = (params.businessName || 'Business').replace(/[^\w\s\-'.]/g, '').slice(0, 100);
  const category = params.businessCategory || 'general business';
  const address = params.businessAddress || '';
  const phone = params.businessPhone || '';
  const website = params.businessWebsite || '';
  const slug = params.slug;

  return [
    `# Mission: Orchestrate a BREATHTAKINGLY GORGEOUS website for "${safeName}"`,
    '',
    '## Inherited Instructions',
    'Your ~/.claude/CLAUDE.md @-imports the upstream megabytespace/claude-skills CLAUDE.md, AGENTS.md, and _router.md. Follow the orchestrator overlay there. This prompt is the per-build dispatch — the meta surface controls HOW.',
    '',
    '## Skills',
    'Load ~/.agentskills/_router.md, then skill 15 (~/.agentskills/15-site-generation/) IN FULL — research pipeline, media acquisition, build prompts, quality gates, domain features, template system. Skill 15 governs methodology.',
    '',
    '## Business Data',
    `Business: ${safeName}`,
    `Category: ${category}`,
    `Slug: ${slug}`,
    `Site URL: https://${slug}.${DOMAINS.SITES_SUFFIX}`,
    address ? `Address: ${address}` : '',
    phone ? `Phone: ${phone}` : '',
    website ? `Website: ${website}` : '',
    params.googlePlaceId ? `Google Place ID: ${params.googlePlaceId}` : '',
    '',
    '## Context Files (read ALL before delegating)',
    '_research.json, _brand.json, _scraped_content.json, _assets.json, _image_profiles.json, _videos.json, _places.json, _form_data.json, _domain_features.json, _citations.json',
    '',
    '## Architecture: Orchestrator + Parallel Subagents',
    'You are the ORCHESTRATOR. You do not write components yourself — you delegate. Subagents have isolated context windows, so fan-out is free. Issue every parallel Task call in a SINGLE message; sequential dispatch defeats the architecture.',
    '',
    '## Available Subagents',
    'Universal (from megabytespace/claude-skills, synced into ~/.claude/agents/):',
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
    '## Orchestration Loop',
    '1. Read every _ context file + skill 15.',
    '2. Customize template (~/template/) with brand colors, logo, content, images. This is the ONLY work you do directly. `cd <build dir>`.',
    '3. `npm run build`. Fix any errors before proceeding.',
    '4. PARALLEL FAN-OUT (single message, multiple Task calls):',
    '   - domain-builder: create section components from _domain_features.json',
    '   - visual-qa: screenshot all routes 6 breakpoints + GPT-4o critique',
    '   - seo-auditor: title/meta/H1/JSON-LD/OG/sitemap audit',
    '   - accessibility-auditor: axe-core 6 breakpoints',
    '   - performance-profiler: Lighthouse + bundle budgets',
    '5. Collect reports. Route to fix-capable agents:',
    '   - Copy/voice issues -> content-writer',
    '   - HTML shell / asset / meta / JSON-LD / sitemap / lightbox / js-chunk fixes -> validator-fixer',
    '   - Accessibility/perf remediation -> validator-fixer (uses audit reports as input; it has Edit)',
    '6. Rebuild. Run validator-fixer until `blockers === 0` from run-validators.mjs.',
    '7. completeness-checker as final gate. If NOT_DONE, loop back to step 4 with its findings.',
    '8. `node /home/cuser/upload-to-r2.mjs` to publish. Env vars CF_API_TOKEN, CF_ACCOUNT_ID, R2_BUCKET_NAME, SITE_SLUG, SITE_VERSION are set.',
    '',
    '## Hard Rules',
    '- Spawn parallel subagents in a SINGLE message with multiple Task calls.',
    '- File partition: domain-builder owns src/components/sections/, validator-fixer owns public/ + index.html shell + vite.config.ts + package.json + sitemap.xml. Never let two agents in one fan-out edit the same file.',
    '- Audit-only agents (visual-qa, seo-auditor, accessibility-auditor, performance-profiler, security-reviewer) MUST NOT be asked to edit. Forward their reports to validator-fixer or content-writer.',
    '- Stripe/Linear/Vercel-level polish. 10+ animations, 15+ images, dark theme by default, WCAG 2.2 AA, 6 breakpoints (375/390/768/1024/1280/1920), zero console errors.',
    '- DONE = blockers === 0 from run-validators.mjs AND completeness-checker returns DONE.',
    '',
    params.additionalContext ? `ADDITIONAL CONTEXT FROM USER: ${params.additionalContext}` : '',
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

    // Per-run container ID — each workflow run gets a fresh DO + container.
    // Eliminates stale-image problems and means containers are disposable.
    // State persistence comes from KV-backed callbacks, not container disk.
    const runNonce = Date.now().toString(36);
    const containerName = `${params.slug}-build-${params.siteId.slice(0, 8)}-${runNonce}`;
    const containerId = env.SITE_BUILDER.idFromName(containerName);
    const getContainer = () => env.SITE_BUILDER!.get(containerId);

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

    // ── Build the prompt + context ──
    const prompt = buildPrompt(params);

    // Mint version inside step.do so workflow replay returns the cached value.
    // Without this, line `new Date().toISOString()` re-runs on replay and produces
    // a fresh timestamp — finalize-build then writes the wrong R2 prefix to D1
    // and the live site 404s while R2 has files at the *original* version path.
    const version = await step.do(
      'mint-version',
      { retries: { limit: 0, delay: '1 second' }, timeout: '30 seconds' },
      async () => new Date().toISOString().replace(/[:.]/g, '-'),
    );
    const envVars: Record<string, string> = {
      // R2 upload credentials (used by /home/cuser/upload-to-r2.mjs)
      CF_API_TOKEN: typeof env.CF_API_TOKEN === 'string' ? env.CF_API_TOKEN : '',
      CF_ACCOUNT_ID: '84fa0d1b16ff8086dd958c468ce7fd59',
      R2_BUCKET_NAME: 'project-sites-production',
      SITE_SLUG: params.slug,
      SITE_VERSION: version,
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

    // Context files: asset manifest + any uploaded asset URLs
    const contextFiles: Record<string, string> = {};
    if (assetManifest.length > 0) {
      const assetUrls = assetManifest.map((key) =>
        `https://${params.slug}.${DOMAINS.SITES_SUFFIX}/assets/${key.split('/').pop()}`
      );
      contextFiles['assets.json'] = JSON.stringify({ keys: assetManifest, urls: assetUrls }, null, 2);
    }

    // ── Step 1: Start build (POST to container) ──
    // Use workers.dev URL to bypass zone-level CF managed challenge intercepting POSTs.
    const callbackSecret = env.INTERNAL_BUILD_SECRET || '';
    const callbackUrl = env.INTERNAL_CALLBACK_URL || `https://${DOMAINS.SITES_BASE}/api/internal/build-status`;

    const jobId = await step.do('start-build', {
      retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
      timeout: '5 minutes',
    }, async () => {
      const container = getContainer();

      const payload = {
        slug: params.slug,
        _anthropicKey: env.ANTHROPIC_API_KEY || '',
        prompt,
        contextFiles,
        envVars,
        timeoutMin: 45,
        callbackUrl,
        callbackSecret,
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

      // Container DO restart → /status returns {error:'unknown job'} with no `status` field.
      // Treat that as "still building" (fall back to KV) rather than a terminal state.
      // Without this guard, undefined !== 'running' would break the loop and skip uploadResult.
      const TERMINAL = new Set(['complete', 'error']);
      if (!TERMINAL.has(String(parsed.status || ''))) {
        if (wrap._src === 'container' && parsed.status === undefined) {
          // DO lost the job. Try KV directly before declaring stale.
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
              };
              kvFinalRecord = kv;
              break;
            }
          }
          continue;
        }
      }

      // Container /status returns plain ContainerStatus (no lastUpdate). For wall-clock
      // freshness, treat every successful container response as fresh; KV path uses lastUpdate.
      const isFromContainer = wrap._src === 'container';
      const ageMs = isFromContainer
        ? (Date.now() - lastFreshAt)
        : (Date.now() - ((parsed as KvBuildRecord).lastUpdate || 0));

      const stateChanged = parsed.status !== lastSeenStatus || parsed.step !== lastSeenStep;
      if (isFromContainer) lastFreshAt = Date.now();
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
        finalStatus = { status: 'error', step: 'stale', elapsed: parsed.elapsed, fileCount: parsed.fileCount, error: 'Container stopped reporting status (stale)' };
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
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.build_error', {
        error: finalStatus.error,
        elapsed_seconds: finalStatus.elapsed,
        message: `Build failed after ${finalStatus.elapsed}s: ${finalStatus.error}`,
      });
      throw new Error('Build failed: ' + (finalStatus.error || 'unknown error'));
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

    // ── Step 4: Final visual inspection (non-blocking) ──
    await step.do('visual-inspection', {
      retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
      timeout: '2 minutes',
    }, async () => {
      if (!env.OPENAI_API_KEY) return JSON.stringify({ skipped: true, reason: 'no_openai_key' });
      try {
        const ssUrl = `https://api.microlink.io/?url=https://${params.slug}.${DOMAINS.SITES_SUFFIX}&screenshot=true&meta=false&embed=screenshot.url`;
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
              siteUrl: `https://${params.slug}.${DOMAINS.SITES_SUFFIX}`,
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
      url: `https://${params.slug}.${DOMAINS.SITES_SUFFIX}`,
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

