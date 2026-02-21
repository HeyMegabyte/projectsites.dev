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
  website_url?: string;
  address: { street?: string; city?: string; state?: string; zip?: string };
  [key: string]: unknown;
}

/** Shape of the social data returned from research-social step. */
interface SocialData {
  website_url?: string;
  [key: string]: unknown;
}

/** Shape of the quality score data. */
interface QualityData {
  overall: number;
  issues?: string[];
  suggestions?: string[];
  missing_sections?: string[];
}

// Step callbacks return JSON-stringified data (string is always Serializable).
// We parse it back after the step completes.

const RETRY_3 = { retries: { limit: 3, delay: '10 seconds' as const, backoff: 'exponential' as const }, timeout: '2 minutes' as const };
const RETRY_HTML = { retries: { limit: 3, delay: '15 seconds' as const, backoff: 'exponential' as const }, timeout: '5 minutes' as const };
const RETRY_LEGAL = { retries: { limit: 3, delay: '10 seconds' as const, backoff: 'exponential' as const }, timeout: '3 minutes' as const };

/**
 * Safely validate LLM JSON output with enriched error messages.
 * Catches ZodError inside step.do() before Cloudflare Workflows serializes it,
 * then re-throws with field-level details baked into the Error message.
 */
async function safeValidateAndLog(
  db: D1Database,
  orgId: string,
  siteId: string,
  stepName: string,
  promptId: string,
  rawOutput: string,
  modelUsed: string,
): Promise<string> {
  const { validatePromptOutput } = await import('../prompts/schemas.js');

  // Log raw LLM output for debugging
  await workflowLog(db, orgId, siteId, 'workflow.debug.llm_output', {
    step: stepName,
    output_length: rawOutput.length,
    output_preview: rawOutput.substring(0, 300),
    model: modelUsed,
    message: 'LLM returned ' + rawOutput.length + ' chars for ' + stepName + ' (model: ' + modelUsed + ')',
  });

  let extracted: unknown;
  try {
    extracted = extractJsonFromText(rawOutput);
  } catch (jsonErr) {
    await workflowLog(db, orgId, siteId, 'workflow.debug.json_extraction_failed', {
      step: stepName,
      error: jsonErr instanceof Error ? jsonErr.message : String(jsonErr),
      output_preview: rawOutput.substring(0, 500),
      message: 'Failed to extract JSON from LLM output for ' + stepName + ' — raw: ' + rawOutput.substring(0, 200),
    });
    throw new Error('JSON extraction failed for ' + stepName + ': ' + (jsonErr instanceof Error ? jsonErr.message : String(jsonErr)));
  }

  try {
    const validated = validatePromptOutput(promptId, extracted);
    return JSON.stringify(validated);
  } catch (zodErr) {
    let zodDetails = '';
    if (zodErr && typeof zodErr === 'object' && 'issues' in zodErr) {
      const issues = (zodErr as { issues: Array<{ path: (string | number)[]; message: string }> }).issues;
      zodDetails = issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ');
    }
    const keys = extracted && typeof extracted === 'object' ? Object.keys(extracted as Record<string, unknown>) : [];
    await workflowLog(db, orgId, siteId, 'workflow.debug.validation_failed', {
      step: stepName,
      zod_details: zodDetails || null,
      extracted_keys: keys,
      extracted_preview: JSON.stringify(extracted).substring(0, 500),
      message: 'Schema validation failed for ' + stepName + (zodDetails ? ': ' + zodDetails : '') + ' — keys: ' + keys.join(', '),
    });
    throw new Error('ZodError in ' + stepName + ': ' + (zodDetails || 'validation failed') + ' · Keys present: ' + keys.join(', '));
  }
}

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

        const result = await runPrompt(env, 'research_profile', 1, {
          business_name: params.businessName,
          business_address: params.businessAddress ?? '',
          business_phone: params.businessPhone ?? '',
          google_place_id: params.googlePlaceId ?? '',
          additional_context: params.additionalContext ?? '',
        });

        return safeValidateAndLog(env.DB, params.orgId, params.siteId, 'research-profile', 'research_profile', result.output, result.model);
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      // The ZodError details are now in the error message itself (enriched inside step.do)
      const isZod = errorMsg.includes('ZodError');
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
        step: 'research-profile',
        error: errorMsg,
        elapsed_ms: elapsed('research-profile'),
        message: 'Profile research failed: ' + errorMsg,
        phase: 'data_collection',
        business_name: params.businessName,
        slug: params.slug,
        recoverable: false,
        is_validation_error: isZod,
      });
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw err;
    }

    const profile = JSON.parse(profileJson) as ProfileData;

    // ── Step 1b: Google Places Enrichment (optional) ────────
    let placesData: import('../services/google_places.js').PlacesResult | null = null;
    try {
      if (env.GOOGLE_PLACES_API_KEY) {
        const { lookupBusiness } = await import('../services/google_places.js');
        placesData = await step.do('google-places-lookup', {
          retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
          timeout: '30 seconds',
        }, async () => {
          const result = await lookupBusiness(
            env.GOOGLE_PLACES_API_KEY,
            params.businessName,
            params.businessAddress ?? '',
          );
          return result ? JSON.stringify(result) : 'null';
        }).then((r: string) => {
          try { return JSON.parse(r) as import('../services/google_places.js').PlacesResult | null; } catch { return null; }
        });

        if (placesData) {
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.google_places_enriched', {
            place_id: placesData.place_id,
            rating: placesData.rating,
            review_count: placesData.review_count,
            has_hours: !!placesData.hours,
            photo_count: placesData.photos?.length ?? 0,
            has_phone: !!placesData.phone,
            has_website: !!placesData.website,
            message: 'Google Places enrichment: ' + (placesData.rating ?? 'N/A') + ' stars, ' + (placesData.review_count ?? 0) + ' reviews, ' + (placesData.photos?.length ?? 0) + ' photos',
          });
        }
      }
    } catch (gpErr) {
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.debug.google_places_failed', {
        error: gpErr instanceof Error ? gpErr.message : String(gpErr),
        message: 'Google Places lookup failed (non-blocking): ' + (gpErr instanceof Error ? gpErr.message : String(gpErr)),
      });
    }

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
      const result = await runPrompt(env, 'research_social', 1, {
        business_name: params.businessName,
        business_address: params.businessAddress ?? '',
        business_type: profile.business_type,
      });
      return safeValidateAndLog(env.DB, params.orgId, params.siteId, 'research-social', 'research_social', result.output, result.model);
    });

    const brandJsonPromise = step.do('research-brand', RETRY_3, async () => {
      const { runPrompt } = await import('../services/ai_workflows.js');
      const result = await runPrompt(env, 'research_brand', 1, {
        business_name: params.businessName,
        business_type: profile.business_type,
        business_address: params.businessAddress ?? '',
        website_url: '',
        additional_context: params.additionalContext ?? '',
      });
      return safeValidateAndLog(env.DB, params.orgId, params.siteId, 'research-brand', 'research_brand', result.output, result.model);
    });

    const sellingPointsJsonPromise = step.do('research-selling-points', RETRY_3, async () => {
      const { runPrompt } = await import('../services/ai_workflows.js');
      const result = await runPrompt(env, 'research_selling_points', 1, {
        business_name: params.businessName,
        business_type: profile.business_type,
        services_json: servicesJson,
        description: profile.description,
        additional_context: params.additionalContext ?? '',
      });
      return safeValidateAndLog(env.DB, params.orgId, params.siteId, 'research-selling-points', 'research_selling_points', result.output, result.model);
    });

    const imagesJsonPromise = step.do('research-images', RETRY_3, async () => {
      const { runPrompt } = await import('../services/ai_workflows.js');
      const result = await runPrompt(env, 'research_images', 1, {
        business_name: params.businessName,
        business_type: profile.business_type,
        business_address: params.businessAddress ?? '',
        services_json: servicesJson,
        additional_context: params.additionalContext ?? '',
      });
      return safeValidateAndLog(env.DB, params.orgId, params.siteId, 'research-images', 'research_images', result.output, result.model);
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
        business_name: params.businessName,
        slug: params.slug,
        recoverable: false,
      });
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw err;
    }

    const social = JSON.parse(socialJson) as SocialData;
    const brand = JSON.parse(brandJson) as Record<string, unknown>;
    const sellingPoints = JSON.parse(sellingPointsJson) as Record<string, unknown>;
    const images = JSON.parse(imagesJson) as Record<string, unknown>;
    const researchRaw = { profile, social, brand, sellingPoints, images };

    // Transform to confidence-weighted v3 format
    const { transformToV3 } = await import('../services/confidence.js');
    const researchV3 = transformToV3(
      researchRaw as import('../services/confidence.js').RawResearch,
      placesData,
      {
        businessName: params.businessName,
        businessAddress: params.businessAddress,
        businessPhone: params.businessPhone,
      },
    );

    // Expose both legacy and v3 under research
    const research = {
      ...researchRaw,
      _v3: researchV3,
    };

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
        business_name: params.businessName,
        slug: params.slug,
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

        // Try JSON extraction first, fall back to text-based score parsing
        let parsed: unknown;
        try {
          parsed = extractJsonFromText(result.output);
        } catch (_jsonErr) {
          // LLM returned plain text scores — extract decimal values
          const text = result.output;
          const extract = (label: string): number => {
            const re = new RegExp(label + '[:\\s]*([0-9]+(\\.[0-9]+)?)', 'i');
            const m = text.match(re);
            return m ? Math.min(1, Math.max(0, parseFloat(m[1]) > 1 ? parseFloat(m[1]) / 100 : parseFloat(m[1]))) : 0.5;
          };
          parsed = {
            scores: {
              visual_design: extract('visual.design'),
              content_quality: extract('content.quality'),
              completeness: extract('completeness'),
              responsiveness: extract('responsiveness'),
              accessibility: extract('accessibility'),
              seo: extract('seo'),
              performance: extract('performance'),
              brand_consistency: extract('brand.consistency'),
            },
            overall: extract('overall'),
            issues: [],
            suggestions: [],
            missing_sections: [],
          };
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.debug.score_text_fallback', {
            raw_preview: text.substring(0, 300),
            parsed_overall: (parsed as Record<string, unknown>).overall,
            message: 'Score step returned plain text — used regex fallback parser',
          });
        }

        return JSON.stringify(
          validatePromptOutput('score_website', parsed),
        );
      },
    );

    // Await legal pages (required) and scoring (optional — fallback to defaults)
    let privacyHtml: string, termsHtml: string, qualityJson: string;
    try {
      [privacyHtml, termsHtml] = await Promise.all([privacyPromise, termsPromise]);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
        step: 'legal-pages',
        error: errorMsg,
        elapsed_ms: elapsed('legal-scoring'),
        message: 'Legal page generation failed: ' + errorMsg,
        phase: 'generation',
        business_name: params.businessName,
        slug: params.slug,
        recoverable: false,
      });
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw err;
    }

    // Scoring is non-blocking — if it fails, use default scores
    try {
      qualityJson = await qualityJsonPromise;
    } catch (scoreErr) {
      const scoreMsg = scoreErr instanceof Error ? scoreErr.message : String(scoreErr);
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.debug.score_fallback', {
        error: scoreMsg,
        message: 'Quality scoring failed — using default scores',
      });
      qualityJson = JSON.stringify({ overall: 0.5, scores: {}, issues: [], suggestions: [], missing_sections: [] });
    }

    let quality = JSON.parse(qualityJson) as QualityData;
    const MIN_QUALITY = 0.6;

    // If quality is below threshold, regenerate the main page once
    if (quality.overall < MIN_QUALITY) {
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.quality_below_threshold', {
        quality_score: quality.overall,
        threshold: MIN_QUALITY,
        issues: quality.issues ?? [],
        suggestions: quality.suggestions ?? [],
        message: 'Quality score ' + quality.overall + ' below threshold ' + MIN_QUALITY + ' — regenerating website',
        phase: 'generation',
      });

      try {
        const regeneratedHtml = await step.do(
          'regenerate-website',
          {
            retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
            timeout: '5 minutes',
          },
          async () => {
            const { runPrompt } = await import('../services/ai_workflows.js');
            const { validatePromptOutput } = await import('../prompts/schemas.js');
            const feedbackNote = (quality.issues ?? []).concat(quality.suggestions ?? []).join('; ');
            const result = await runPrompt(env, 'generate_website', 1, {
              profile_json: JSON.stringify(research.profile),
              brand_json: JSON.stringify(research.brand),
              selling_points_json: JSON.stringify(research.sellingPoints),
              social_json: JSON.stringify(research.social),
              images_json: JSON.stringify(research.images),
              uploads_json: params.uploadedAssets ? JSON.stringify(params.uploadedAssets) : '',
              quality_feedback: feedbackNote || 'Improve overall quality — ensure strong visuals, complete content, good SEO, and accessibility',
            });
            validatePromptOutput('generate_website', result.output);
            return result.output;
          },
        );

        html = regeneratedHtml;

        // Re-score the regenerated page
        try {
          const rescoreResult = await step.do(
            'rescore-website',
            {
              retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
              timeout: '1 minute',
            },
            async () => {
              const { runPrompt } = await import('../services/ai_workflows.js');
              const { validatePromptOutput: vpo } = await import('../prompts/schemas.js');
              const result = await runPrompt(env, 'score_website', 1, {
                html_content: html.substring(0, 6000),
                business_name: params.businessName,
              });
              return JSON.stringify(vpo('score_website', extractJsonFromText(result.output)));
            },
          );
          quality = JSON.parse(rescoreResult) as QualityData;
        } catch {
          // Re-scoring failed, keep original quality data
        }

        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.quality_regenerated', {
          new_quality_score: quality.overall,
          improved: quality.overall >= MIN_QUALITY,
          message: 'Regenerated website · New score: ' + quality.overall + '/100',
          phase: 'generation',
        });
      } catch (regenErr) {
        const msg = regenErr instanceof Error ? regenErr.message : String(regenErr);
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.quality_regen_failed', {
          error: msg,
          message: 'Regeneration failed — publishing original: ' + msg,
          phase: 'generation',
        });
      }
    }

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

        const files = ['index.html', 'privacy.html', 'terms.html', 'research.json'];
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

        // Update manifest so site-serving and research.json endpoint use new version
        await env.SITES_BUCKET.put(
          `sites/${slug}/_manifest.json`,
          JSON.stringify({
            current_version: ver,
            updated_at: new Date().toISOString(),
            files,
          }),
          { httpMetadata: { contentType: 'application/json' } },
        );

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
        business_name: params.businessName,
        slug: params.slug,
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
        business_name: params.businessName,
        slug: params.slug,
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
        .prepare('SELECT u.email FROM users u JOIN memberships m ON u.id = m.user_id WHERE m.org_id = ? AND m.role = ? AND m.deleted_at IS NULL')
        .bind(params.orgId, 'owner')
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
    } catch (emailErr) {
      // Email failure should not break the workflow — but log it
      await workflowLog(env.DB, params.orgId, params.siteId, 'notification.email_failed', {
        error: emailErr instanceof Error ? emailErr.message : String(emailErr),
        message: 'Build notification email failed: ' + (emailErr instanceof Error ? emailErr.message : String(emailErr)),
      });
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
