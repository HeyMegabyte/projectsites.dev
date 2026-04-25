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

/**
 * Build the single comprehensive prompt for Claude Code.
 * References skills in ~/.agentskills/15-site-generation/ for full methodology.
 * Claude Code handles research, building, inspection, and R2 upload.
 */
function buildPrompt(params: SiteGenerationParams): string {
  const safeName = (params.businessName || 'Business').replace(/[^\w\s\-'.]/g, '').slice(0, 100);
  const category = params.businessCategory || 'general business';
  const address = params.businessAddress || '';
  const phone = params.businessPhone || '';
  const website = params.businessWebsite || '';
  const slug = params.slug;

  return [
    `# Mission: Build a BREATHTAKINGLY GORGEOUS website for "${safeName}"`,
    '',
    '## Skills',
    'Read ~/.agentskills/15-site-generation/ for COMPLETE build methodology.',
    'Load via ~/.agentskills/_router.md — skill 15 covers: research pipeline, media acquisition, build prompts, quality gates, domain features, template system.',
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
    '## Context Files',
    'Read ALL _ prefixed files in this directory for pre-researched data.',
    '',
    '## Build Loop',
    '1. Read all context files + skills',
    '2. Research via curl (website scraping, brand extraction, media APIs) — parallelize with background agents',
    '3. Customize the template with real content, brand colors, images',
    '4. npm run build — fix errors',
    '5. node /home/cuser/inspect.js dist/index.html — fix issues scoring <8',
    '6. Rebuild and re-inspect (max 3 iterations)',
    '',
    '## Post-Build',
    'After successful build: node /home/cuser/upload-to-r2.mjs',
    'This uploads dist/ to R2. Env vars CF_API_TOKEN, CF_ACCOUNT_ID, R2_BUCKET_NAME, SITE_SLUG, SITE_VERSION are set.',
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

    // Stable container ID — all steps talk to the same container instance
    const containerName = `${params.slug}-build-${params.siteId.slice(0, 8)}`;
    const containerId = env.SITE_BUILDER.idFromName(containerName);
    const getContainer = () => env.SITE_BUILDER!.get(containerId);

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

    // Collect all API keys to pass as env vars
    const version = new Date().toISOString().replace(/[:.]/g, '-');
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

    // ── Step 2: Heartbeat polling loop ──
    // Each poll is a tiny step (~5s). No timeout risk.
    // Max 120 polls × 30s = 60 minutes max build time.
    const MAX_POLLS = 120;
    const POLL_INTERVAL_MS = 30_000;

    let finalStatus: ContainerStatus | null = null;

    for (let i = 0; i < MAX_POLLS; i++) {
      const status = await step.do(`heartbeat-${i}`, {
        retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
        timeout: '1 minute',
      }, async () => {
        // Sleep 30s between polls
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

        const container = getContainer();

        const res = await container.fetch(`http://container/status?jobId=${encodeURIComponent(jobId)}`);
        if (!res.ok) {
          throw new Error(`Status poll failed: ${res.status}`);
        }

        const data = await res.json() as ContainerStatus;

        // Log progress every 5 polls (~2.5 min)
        if (i % 5 === 0) {
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.heartbeat', {
            poll: i,
            status: data.status,
            step: data.step,
            elapsed_seconds: data.elapsed,
            file_count: data.fileCount,
            message: `Heartbeat ${i}: status=${data.status}, step=${data.step}, elapsed=${data.elapsed}s`,
          });
        }

        return JSON.stringify(data);
      });

      const parsed = JSON.parse(status) as ContainerStatus;

      if (parsed.status !== 'running') {
        finalStatus = parsed;
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

    // ── Step 3: Finalize — container already uploaded to R2, update D1 ──
    const filesJson = await step.do('finalize-build', {
      retries: { limit: 3, delay: '10 seconds', backoff: 'exponential' },
      timeout: '2 minutes',
    }, async () => {
      // Fetch result from container to get upload status + file count
      const container = getContainer();
      const res = await container.fetch(`http://container/result?jobId=${encodeURIComponent(jobId)}`);
      const result = await res.json() as ContainerResult & { uploadResult?: { uploaded?: number; version?: string } };

      const fileCount = result.files?.length || finalStatus!.fileCount || 0;

      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.build_complete', {
        file_count: fileCount,
        r2_uploaded: !!result.uploadResult,
        upload_count: result.uploadResult?.uploaded || 0,
        message: `Build complete: ${fileCount} files, R2 upload ${result.uploadResult ? 'succeeded' : 'handled by container'}`,
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

