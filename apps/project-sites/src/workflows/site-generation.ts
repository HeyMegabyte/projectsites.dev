/**
 * @module workflows/site-generation
 * @description Cloudflare Workflow for AI-powered site generation.
 *
 * This is a durable, step-based workflow that orchestrates the full
 * site generation pipeline:
 *
 * 1. Profile research (sequential — needed for business_type)
 * 2. Parallel research (social, brand, selling points, images)
 * 3. Website HTML generation
 * 4. Legal pages + quality scoring (parallel)
 * 5. Upload to R2 and update D1 status
 *
 * Each step is automatically retried on failure (up to 3 times with
 * exponential backoff). The workflow is visible in the Cloudflare
 * dashboard under Workers → Workflows.
 *
 * @packageDocumentation
 */

import { WorkflowEntrypoint } from 'cloudflare:workers';
import type { WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { Env } from '../types/env.js';
import { extractJsonFromText } from '../services/ai_workflows.js';
import { notifySiteBuilt } from '../services/notifications.js';

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

/** Workflow step timing tracker for granular logs. */
const stepTimers: Record<string, number> = {};

function startTimer(step: string): void {
  stepTimers[step] = Date.now();
}

function elapsed(step: string): number {
  const start = stepTimers[step];
  return start ? Date.now() - start : 0;
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
    // Always include site_id in metadata for robust audit_log querying
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
    // Best-effort logging — workflow must not fail due to audit log errors
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
  googlePlaceId?: string;
  additionalContext?: string;
  uploadedAssets?: string[];
  orgId: string;
}

/** Shape of the profile data returned from research-profile step. */
interface ProfileData {
  business_type: string;
  services: Array<{ name: string }>;
  description: string;
  email?: string;
  address: { street?: string; city?: string; state?: string; zip?: string };
}

/** Shape of the social data returned from research-social step. */
interface SocialData {
  website_url?: string;
}

/** Shape of the quality score data. */
interface QualityData {
  overall: number;
}

// Step callbacks return JSON-stringified data (string is always Serializable).
// We parse it back after the step completes.

const RETRY_3 = { retries: { limit: 3, delay: '10 seconds' as const, backoff: 'exponential' as const }, timeout: '2 minutes' as const };
const RETRY_HTML = { retries: { limit: 3, delay: '15 seconds' as const, backoff: 'exponential' as const }, timeout: '5 minutes' as const };
const RETRY_LEGAL = { retries: { limit: 3, delay: '10 seconds' as const, backoff: 'exponential' as const }, timeout: '3 minutes' as const };

/**
 * Cloudflare Workflow for AI site generation.
 *
 * Deployed as `site-generation-workflow` and bound to `SITE_WORKFLOW`.
 * Trigger via `env.SITE_WORKFLOW.create({ id: siteId, params })`.
 */
export class SiteGenerationWorkflow extends WorkflowEntrypoint<Env, SiteGenerationParams> {
  override async run(
    event: Readonly<WorkflowEvent<SiteGenerationParams>>,
    step: WorkflowStep,
  ): Promise<unknown> {
    const params = event.payload;
    const env = this.env;

    // Log workflow start and set status to 'collecting'
    startTimer('workflow');
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.started', {
      slug: params.slug,
      business_name: params.businessName,
      business_address: params.businessAddress ?? null,
      google_place_id: params.googlePlaceId ?? null,
      has_additional_context: !!params.additionalContext,
      has_uploaded_assets: !!(params.uploadedAssets && params.uploadedAssets.length),
      uploaded_asset_count: params.uploadedAssets?.length ?? 0,
      phase: 'initialization',
      message: 'AI build workflow started for ' + params.businessName + ' (' + params.slug + ')',
    });

    // Update site status to 'collecting' for real-time UI
    await updateSiteStatus(env.DB, params.siteId, 'collecting');

    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.status_update', {
      status: 'collecting',
      phase: 'data_collection',
      message: 'Starting AI-powered business research',
    });

    // ── Step 1: Profile Research ──────────────────────────────
    // Returns JSON-stringified validated profile data
    startTimer('research-profile');
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.profile_research_started', {
      step: 'research-profile',
      business_name: params.businessName,
      business_address: params.businessAddress ?? '',
      message: 'Analyzing business type, services, and contact information',
    });

    let profileJson: string;
    try {
      profileJson = await step.do('research-profile', RETRY_3, async () => {
        const { runPrompt } = await import('../services/ai_workflows.js');
        const { validatePromptOutput } = await import('../prompts/schemas.js');

        const result = await runPrompt(env, 'research_profile', 1, {
          business_name: params.businessName,
          business_address: params.businessAddress ?? '',
          business_phone: params.businessPhone ?? '',
          google_place_id: params.googlePlaceId ?? '',
          additional_context: params.additionalContext ?? '',
        });

        const validated = validatePromptOutput('research_profile', extractJsonFromText(result.output));
        return JSON.stringify(validated);
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
        step: 'research-profile',
        error: errorMsg,
        elapsed_ms: elapsed('research-profile'),
        message: 'Profile research failed: ' + errorMsg,
        phase: 'data_collection',
        recoverable: false,
      });
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw err;
    }

    const profile = JSON.parse(profileJson) as ProfileData;

    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.profile_research_complete', {
      business_type: profile.business_type,
      services_count: profile.services?.length ?? 0,
      services: profile.services?.map((s) => s.name) ?? [],
      has_email: !!profile.email,
      has_address: !!(profile.address?.city || profile.address?.state),
      city: profile.address?.city ?? null,
      state: profile.address?.state ?? null,
      elapsed_ms: elapsed('research-profile'),
      message: 'Found business type: ' + profile.business_type + ' · ' + (profile.services?.length ?? 0) + ' services found',
    });

    // ── Step 2: Parallel Research ─────────────────────────────
    const servicesJson = JSON.stringify(profile.services.map((s) => s.name));

    startTimer('parallel-research');
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.parallel_research_started', {
      steps: ['research-social', 'research-brand', 'research-selling-points', 'research-images'],
      business_type: profile.business_type,
      message: 'Running 4 parallel research streams: social profiles, brand identity, selling points, and image strategy',
      phase: 'data_collection',
    });

    const socialJsonPromise = step.do('research-social', RETRY_3, async () => {
      const { runPrompt } = await import('../services/ai_workflows.js');
      const { validatePromptOutput } = await import('../prompts/schemas.js');
      const result = await runPrompt(env, 'research_social', 1, {
        business_name: params.businessName,
        business_address: params.businessAddress ?? '',
        business_type: profile.business_type,
      });
      return JSON.stringify(validatePromptOutput('research_social', extractJsonFromText(result.output)));
    });

    const brandJsonPromise = step.do('research-brand', RETRY_3, async () => {
      const { runPrompt } = await import('../services/ai_workflows.js');
      const { validatePromptOutput } = await import('../prompts/schemas.js');
      const result = await runPrompt(env, 'research_brand', 1, {
        business_name: params.businessName,
        business_type: profile.business_type,
        business_address: params.businessAddress ?? '',
        website_url: '',
        additional_context: params.additionalContext ?? '',
      });
      return JSON.stringify(validatePromptOutput('research_brand', extractJsonFromText(result.output)));
    });

    const sellingPointsJsonPromise = step.do('research-selling-points', RETRY_3, async () => {
      const { runPrompt } = await import('../services/ai_workflows.js');
      const { validatePromptOutput } = await import('../prompts/schemas.js');
      const result = await runPrompt(env, 'research_selling_points', 1, {
        business_name: params.businessName,
        business_type: profile.business_type,
        services_json: servicesJson,
        description: profile.description,
        additional_context: params.additionalContext ?? '',
      });
      return JSON.stringify(
        validatePromptOutput('research_selling_points', extractJsonFromText(result.output)),
      );
    });

    const imagesJsonPromise = step.do('research-images', RETRY_3, async () => {
      const { runPrompt } = await import('../services/ai_workflows.js');
      const { validatePromptOutput } = await import('../prompts/schemas.js');
      const result = await runPrompt(env, 'research_images', 1, {
        business_name: params.businessName,
        business_type: profile.business_type,
        business_address: params.businessAddress ?? '',
        services_json: servicesJson,
        additional_context: params.additionalContext ?? '',
      });
      return JSON.stringify(validatePromptOutput('research_images', extractJsonFromText(result.output)));
    });

    let socialJson: string, brandJson: string, sellingPointsJson: string, imagesJson: string;
    try {
      [socialJson, brandJson, sellingPointsJson, imagesJson] = await Promise.all([
        socialJsonPromise,
        brandJsonPromise,
        sellingPointsJsonPromise,
        imagesJsonPromise,
      ]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
        step: 'parallel-research',
        error: errorMsg,
        elapsed_ms: elapsed('parallel-research'),
        message: 'Parallel research failed: ' + errorMsg,
        phase: 'data_collection',
        recoverable: false,
      });
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw err;
    }

    const social = JSON.parse(socialJson) as SocialData;
    const brand = JSON.parse(brandJson) as Record<string, unknown>;
    const sellingPoints = JSON.parse(sellingPointsJson) as Record<string, unknown>;
    const images = JSON.parse(imagesJson) as Record<string, unknown>;
    const research = { profile, social, brand, sellingPoints, images };

    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.parallel_research_complete', {
      has_social: !!social,
      has_website_url: !!social.website_url,
      website_url: social.website_url ?? null,
      brand_keys: Object.keys(brand),
      selling_points_keys: Object.keys(sellingPoints),
      images_keys: Object.keys(images),
      elapsed_ms: elapsed('parallel-research'),
      message: 'Parallel research complete · social' + (social.website_url ? ' (website found)' : '') + ' · brand · USPs · images',
      phase: 'data_collection',
    });

    // Update status to 'generating' — data collection done, now generating HTML
    await updateSiteStatus(env.DB, params.siteId, 'generating');

    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.status_update', {
      status: 'generating',
      phase: 'generation',
      message: 'Data collection complete — generating website HTML',
    });

    // ── Step 3: Generate Website HTML ─────────────────────────
    startTimer('generate-website');
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.html_generation_started', {
      step: 'generate-website',
      message: 'Generating complete self-contained HTML website from research data',
      phase: 'generation',
      has_uploads: !!(params.uploadedAssets && params.uploadedAssets.length),
    });

    let html: string;
    try {
      html = await step.do('generate-website', RETRY_HTML, async () => {
      const { runPrompt } = await import('../services/ai_workflows.js');
      const { validatePromptOutput } = await import('../prompts/schemas.js');
      const result = await runPrompt(env, 'generate_website', 1, {
        profile_json: JSON.stringify(research.profile),
        brand_json: JSON.stringify(research.brand),
        selling_points_json: JSON.stringify(research.sellingPoints),
        social_json: JSON.stringify(research.social),
        images_json: JSON.stringify(research.images),
        uploads_json: params.uploadedAssets ? JSON.stringify(params.uploadedAssets) : '',
      });
      validatePromptOutput('generate_website', result.output);
      return result.output;
    });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
        step: 'generate-website',
        error: errorMsg,
        elapsed_ms: elapsed('generate-website'),
        message: 'HTML generation failed: ' + errorMsg,
        phase: 'generation',
        recoverable: false,
      });
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw err;
    }

    const htmlSizeKb = Math.round(html.length / 1024);
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.html_generation_complete', {
      html_length: html.length,
      html_size_kb: htmlSizeKb,
      has_uploads: !!(params.uploadedAssets && params.uploadedAssets.length),
      elapsed_ms: elapsed('generate-website'),
      message: 'Website HTML generated · ' + htmlSizeKb + 'KB',
      phase: 'generation',
    });

    // ── Step 4: Legal Pages + Quality Score (parallel) ────────
    startTimer('legal-scoring');
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.legal_scoring_started', {
      steps: ['generate-privacy-page', 'generate-terms-page', 'score-website'],
      message: 'Generating privacy policy, terms of service, and scoring website quality',
      phase: 'generation',
    });

    const addr = profile.address;
    const addressStr = [addr.street, addr.city, addr.state, addr.zip]
      .filter(Boolean)
      .join(', ');
    const websiteUrl = social.website_url ?? '';

    const privacyPromise = step.do('generate-privacy-page', RETRY_LEGAL, async () => {
      const { runPrompt } = await import('../services/ai_workflows.js');
      const { validatePromptOutput } = await import('../prompts/schemas.js');
      const result = await runPrompt(env, 'generate_legal_pages', 1, {
        business_name: params.businessName,
        brand_json: JSON.stringify(research.brand),
        page_type: 'privacy',
        business_address: addressStr,
        business_email: profile.email ?? '',
        website_url: websiteUrl,
      });
      validatePromptOutput('generate_legal_pages', result.output);
      return result.output;
    });

    const termsPromise = step.do('generate-terms-page', RETRY_LEGAL, async () => {
      const { runPrompt } = await import('../services/ai_workflows.js');
      const { validatePromptOutput } = await import('../prompts/schemas.js');
      const result = await runPrompt(env, 'generate_legal_pages', 1, {
        business_name: params.businessName,
        brand_json: JSON.stringify(research.brand),
        page_type: 'terms',
        business_address: addressStr,
        business_email: profile.email ?? '',
        website_url: websiteUrl,
      });
      validatePromptOutput('generate_legal_pages', result.output);
      return result.output;
    });

    const qualityJsonPromise = step.do(
      'score-website',
      {
        retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
        timeout: '2 minutes',
      },
      async () => {
        const { runPrompt } = await import('../services/ai_workflows.js');
        const { validatePromptOutput } = await import('../prompts/schemas.js');
        const result = await runPrompt(env, 'score_website', 1, {
          html_content: html.substring(0, 6000),
          business_name: params.businessName,
        });
        return JSON.stringify(
          validatePromptOutput('score_website', extractJsonFromText(result.output)),
        );
      },
    );

    let privacyHtml: string, termsHtml: string, qualityJson: string;
    try {
      [privacyHtml, termsHtml, qualityJson] = await Promise.all([
        privacyPromise,
        termsPromise,
        qualityJsonPromise,
      ]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
        step: 'legal-and-scoring',
        error: errorMsg,
        elapsed_ms: elapsed('legal-scoring'),
        message: 'Legal pages / quality scoring failed: ' + errorMsg,
        phase: 'generation',
        recoverable: false,
      });
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw err;
    }

    const quality = JSON.parse(qualityJson) as QualityData;

    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.legal_and_scoring_complete', {
      quality_score: quality.overall,
      privacy_html_length: privacyHtml.length,
      terms_html_length: termsHtml.length,
      elapsed_ms: elapsed('legal-scoring'),
      message: 'Legal pages generated · Quality score: ' + quality.overall + '/100',
      phase: 'generation',
    });

    // Update status to 'uploading' — generating done, now uploading
    await updateSiteStatus(env.DB, params.siteId, 'uploading');

    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.status_update', {
      status: 'uploading',
      phase: 'deployment',
      message: 'All content generated — uploading files to storage',
    });

    // ── Step 5: Upload to R2 ──────────────────────────────────
    startTimer('upload-to-r2');
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.upload_started', {
      step: 'upload-to-r2',
      slug: params.slug,
      files: ['index.html', 'privacy.html', 'terms.html', 'research.json'],
      file_count: 4,
      message: 'Uploading 4 files to R2 storage: index.html, privacy.html, terms.html, research.json',
      phase: 'deployment',
    });

    let version: string;
    try {
      version = await step.do(
      'upload-to-r2',
      {
        retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
        timeout: '1 minute',
      },
      async () => {
        const ver = new Date().toISOString().replace(/[:.]/g, '-');
        const slug = params.slug;

        await Promise.all([
          env.SITES_BUCKET.put(`sites/${slug}/${ver}/index.html`, html, {
            httpMetadata: { contentType: 'text/html' },
          }),
          env.SITES_BUCKET.put(`sites/${slug}/${ver}/privacy.html`, privacyHtml, {
            httpMetadata: { contentType: 'text/html' },
          }),
          env.SITES_BUCKET.put(`sites/${slug}/${ver}/terms.html`, termsHtml, {
            httpMetadata: { contentType: 'text/html' },
          }),
          env.SITES_BUCKET.put(
            `sites/${slug}/${ver}/research.json`,
            JSON.stringify(research, null, 2),
            { httpMetadata: { contentType: 'application/json' } },
          ),
        ]);

        return ver;
      },
    );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
        step: 'upload-to-r2',
        error: errorMsg,
        elapsed_ms: elapsed('upload-to-r2'),
        message: 'R2 upload failed: ' + errorMsg,
        phase: 'deployment',
        recoverable: false,
      });
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw err;
    }

    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.upload_to_r2_complete', {
      version,
      slug: params.slug,
      files: ['index.html', 'privacy.html', 'terms.html', 'research.json'],
      r2_prefix: 'sites/' + params.slug + '/' + version + '/',
      elapsed_ms: elapsed('upload-to-r2'),
      message: 'Files uploaded to R2 · Version: ' + version,
      phase: 'deployment',
    });

    // ── Step 6: Update D1 status ──────────────────────────────
    startTimer('publish');
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.publishing_started', {
      step: 'update-site-status',
      version,
      message: 'Publishing site — updating database to mark as live',
      phase: 'deployment',
    });

    try {
      await step.do(
      'update-site-status',
      {
        retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
        timeout: '30 seconds',
      },
      async () => {
        const { dbUpdate } = await import('../services/db.js');
        await dbUpdate(
          env.DB,
          'sites',
          {
            status: 'published',
            current_build_version: version,
          },
          'id = ?',
          [params.siteId],
        );
        return `published:${version}`;
      },
    );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
        step: 'update-site-status',
        error: errorMsg,
        elapsed_ms: elapsed('publish'),
        message: 'Database publish failed: ' + errorMsg,
        phase: 'deployment',
        recoverable: false,
      });
      throw err;
    }

    const totalElapsed = elapsed('workflow');
    const totalSeconds = Math.round(totalElapsed / 1000);
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.completed', {
      slug: params.slug,
      version,
      quality_score: quality.overall,
      pages: ['index.html', 'privacy.html', 'terms.html', 'research.json'],
      url: `https://${params.slug}-sites.megabyte.space`,
      total_elapsed_ms: totalElapsed,
      total_seconds: totalSeconds,
      message: 'Site published successfully · ' + totalSeconds + 's total · Score: ' + quality.overall + '/100',
      phase: 'complete',
    });

    // Send build-complete email to site owner
    try {
      const owner = await env.DB
        .prepare('SELECT u.email FROM users u JOIN organizations o ON u.id = o.owner_id WHERE o.id = ?')
        .bind(params.orgId)
        .first<{ email: string }>();
      if (owner?.email) {
        await notifySiteBuilt(env, {
          email: owner.email,
          siteName: params.businessName || params.slug,
          slug: params.slug,
          siteUrl: `https://${params.slug}-sites.megabyte.space`,
          version,
          pagesGenerated: 4,
        });
        await workflowLog(env.DB, params.orgId, params.siteId, 'notification.build_complete_sent', {
          email: owner.email,
          message: 'Build complete email sent to ' + owner.email,
        });
      }
    } catch {
      // Email failure should not break the workflow
    }

    return {
      siteId: params.siteId,
      slug: params.slug,
      version,
      quality: quality.overall,
      pages: ['index.html', 'privacy.html', 'terms.html', 'research.json'],
    };
  }
}
