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
import { DOMAINS } from '@project-sites/shared';

/** Strip markdown code fences from LLM HTML output. */
function cleanHtmlOutput(raw: string): string {
  let cleaned = raw.trim();
  // Strip leading text before <!DOCTYPE or <!doctype
  const docIdx = cleaned.search(/<!doctype\s/i);
  if (docIdx > 0) {
    cleaned = cleaned.substring(docIdx);
  }
  // Strip trailing markdown fence
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.replace(/\s*```\s*$/, '');
  }
  return cleaned.trim();
}

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
  businessCategory?: string;
  businessWebsite?: string;
  googlePlaceId?: string;
  additionalContext?: string;
  uploadedAssets?: string[];
  uploadId?: string;
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
const RETRY_HTML = { retries: { limit: 3, delay: '15 seconds' as const, backoff: 'exponential' as const }, timeout: '10 minutes' as const };
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

    // ── Step 2.5: Move Uploaded Assets + Generate/Discover Images ──
    await updateSiteStatus(env.DB, params.siteId, 'imaging');

    let assetManifest: string[] = params.uploadedAssets || [];

    // Move uploaded assets from uploads/{uploadId}/ to sites/{slug}/assets/
    if (params.uploadId) {
      try {
        const moved = await step.do('move-uploaded-assets', RETRY_3, async () => {
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
                customMetadata: { ...data.customMetadata, movedFrom: obj.key },
              });
              movedKeys.push(destKey);
            }
          }
          return JSON.stringify(movedKeys);
        });
        assetManifest = [...assetManifest, ...JSON.parse(moved)];
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.complete', {
          step: 'move-uploaded-assets', message: `Moved ${JSON.parse(moved).length} uploaded assets`,
        });
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
          step: 'move-uploaded-assets', error: String(err), message: 'Failed to move uploaded assets (non-blocking)',
        });
      }
    }

    // Generate logo if not uploaded
    const hasLogo = assetManifest.some((k) => k.includes('logo'));
    if (!hasLogo && env.OPENAI_API_KEY) {
      try {
        const logoResult = await step.do('generate-logo', RETRY_3, async () => {
          const { generateLogo } = await import('../services/image_generation.js');
          const result = await generateLogo(env, params.slug, params.businessName,
            profile.business_type, brand as any);
          return result ? JSON.stringify(result) : '';
        });
        if (logoResult) {
          const parsed = JSON.parse(logoResult);
          assetManifest.push(parsed.key);
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.complete', {
            step: 'generate-logo', message: 'AI-generated logo', confidence: parsed.confidence,
          });
        }
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
          step: 'generate-logo', error: String(err), message: 'Logo generation failed (non-blocking)',
        });
      }
    }

    // Generate favicon set from logo (or uploaded favicon)
    const hasFavicon = assetManifest.some((k) => k.includes('favicon') || k.includes('icon-512'));
    const logoKey = assetManifest.find((k) => k.includes('logo'));
    if (!hasFavicon && logoKey) {
      try {
        const faviconResult = await step.do('generate-favicon-set', RETRY_3, async () => {
          const { generateFaviconSet } = await import('../services/image_generation.js');
          const logoObj = await env.SITES_BUCKET.get(logoKey);
          if (!logoObj) return '[]';
          const logoBytes = await logoObj.arrayBuffer();
          const results = await generateFaviconSet(env, params.slug, logoBytes);
          return JSON.stringify(results);
        });
        const faviconAssets = JSON.parse(faviconResult);
        for (const fa of faviconAssets) assetManifest.push(fa.key);
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.complete', {
          step: 'generate-favicon-set', message: `Generated ${faviconAssets.length} favicon assets`,
        });
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
          step: 'generate-favicon-set', error: String(err), message: 'Favicon generation failed (non-blocking)',
        });
      }
    }

    // Generate section images using DALL-E 3 (if OpenAI key available)
    if (env.OPENAI_API_KEY) {
      try {
        const sectionImagesResult = await step.do('generate-section-images', {
          retries: { limit: 1, delay: '10 seconds', backoff: 'exponential' },
          timeout: '5 minutes',
        }, async () => {
          const { generateWebsiteImages } = await import('../services/image_generation.js');
          // Build image prompts from research_images output
          const imageData = images as any;
          const needs: { concept: string; prompt: string }[] = [];
          if (imageData.hero_images) {
            for (const h of (imageData.hero_images as any[]).slice(0, 2)) {
              needs.push({ concept: 'hero-' + (h.concept || 'main').replace(/\s+/g, '-'), prompt: h.search_query_stock || h.concept });
            }
          }
          if (imageData.service_images) {
            for (const s of (imageData.service_images as any[]).slice(0, 3)) {
              needs.push({ concept: 'service-' + (s.service_name || 'general').replace(/\s+/g, '-'), prompt: s.search_query_stock || s.service_name });
            }
          }
          const results = await generateWebsiteImages(env, params.slug, params.businessName, profile.business_type, needs);
          return JSON.stringify(results);
        });
        const sectionAssets = JSON.parse(sectionImagesResult);
        for (const sa of sectionAssets) assetManifest.push(sa.key);
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.complete', {
          step: 'generate-section-images', message: `Generated ${sectionAssets.length} section images`,
        });
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
          step: 'generate-section-images', error: String(err), message: 'Section image generation failed (non-blocking)',
        });
      }
    }

    // Discover brand images from web (optional, non-blocking)
    if ((env as any).GOOGLE_CSE_KEY) {
      try {
        const discoveredResult = await step.do('discover-brand-images', {
          retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
          timeout: '2 minutes',
        }, async () => {
          const { discoverBrandImages } = await import('../services/image_discovery.js');
          const results = await discoverBrandImages(env, params.slug, params.businessName,
            profile.business_type, social.website_url || undefined);
          return JSON.stringify(results);
        });
        const discovered = JSON.parse(discoveredResult);
        for (const d of discovered) assetManifest.push(d.key);
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.complete', {
          step: 'discover-brand-images', message: `Discovered ${discovered.length} brand images`,
        });
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
          step: 'discover-brand-images', error: String(err), message: 'Image discovery failed (non-blocking)',
        });
      }
    }

    // Store build context JSON for bolt.diy integration
    try {
      await step.do('store-build-context', RETRY_3, async () => {
        const { generateBuildContext, storeBuildContext } = await import('../services/build_context.js');
        const context = generateBuildContext(
          { name: params.businessName, address: params.businessAddress, phone: params.businessPhone, category: params.businessCategory },
          { profile, brand, sellingPoints, social, images },
          assetManifest.map((k) => ({ key: k, name: k.split('/').pop() || k, type: k.split('.').pop() || '', url: '', confidence: 80, source: 'mixed' })),
          params.slug,
        );
        await storeBuildContext(env, params.slug, context);
        return 'ok';
      });
    } catch {
      // Non-blocking
    }

    // Update status to 'generating' — image phase done, now generating website
    await updateSiteStatus(env.DB, params.siteId, 'generating');

    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.status_update', {
      status: 'generating',
      phase: 'generation',
      message: `Data collection + imaging complete (${assetManifest.length} assets) — starting headless generation pipeline`,
    });

    // ── Step 2.5b: Scrape existing website (if available) ─────
    let scrapedContent = '';
    if (social.website_url || params.businessWebsite) {
      try {
        const websiteUrl = social.website_url || params.businessWebsite || '';
        const siteUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
        scrapedContent = await step.do('scrape-website', RETRY_3, async () => {
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.scrape_started', {
            url: siteUrl, message: `Scraping ${siteUrl} for content`, phase: 'research',
          });
          const res = await fetch(siteUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ProjectSites/1.0; +https://projectsites.dev)' },
            redirect: 'follow',
          });
          if (!res.ok) return '';
          const html = await res.text();

          // Extract key content from HTML
          const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
          const metaDesc = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
          const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
          const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
          const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(t => t.length > 30).slice(0, 15);
          const images = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]).filter(u => !u.includes('data:') && !u.includes('pixel')).slice(0, 10);
          const navLinks = [...html.matchAll(/<nav[\s\S]*?<\/nav>/gi)].map(n => {
            const links = [...n[0].matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
            return links.map(l => ({ href: l[1], text: l[2].replace(/<[^>]+>/g, '').trim() }));
          }).flat().filter(l => l.text);
          const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);

          const scraped = {
            title: titleMatch?.[1] || '',
            description: metaDesc?.[1] || '',
            headings: [...h1s.slice(0, 3), ...h2s.slice(0, 8)],
            paragraphs,
            images,
            navLinks: navLinks.slice(0, 10),
            ogImage: ogImage?.[1] || '',
          };

          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.scrape_complete', {
            title: scraped.title, headings: scraped.headings.length, paragraphs: scraped.paragraphs.length,
            images: scraped.images.length, message: `Scraped: ${scraped.title} — ${scraped.headings.length} headings, ${scraped.paragraphs.length} paragraphs`,
            phase: 'research',
          });

          return JSON.stringify(scraped);
        });
      } catch {
        // Scraping failed — continue without it
      }
    }

    // ── Step 3: Site Structure Plan (Pass 1 — fast/cheap) ─────
    startTimer('structure-plan');
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.structure_plan_started', {
      step: 'structure-plan',
      message: 'Planning multi-page site structure with Claude (headless)',
      phase: 'generation',
    });

    let structurePlanJson: string;
    try {
      structurePlanJson = await step.do('structure-plan', RETRY_3, async () => {
        const { callExternalLLM } = await import('../services/external_llm.js');
        const { getOrCreateTemplate, matchCategory } = await import('../services/template_cache.js');

        const category = matchCategory(profile.business_type);
        const template = await getOrCreateTemplate(env, category);

        const researchData = JSON.stringify({ profile, social, brand, sellingPoints, images });

        const result = await callExternalLLM(env, {
          system: `You are an expert website information architect. Given research data about a business and an industry template, plan the structure of a multi-page website. Return valid JSON matching: { pages: [{ path, title, purpose, sections[] }], design: { primary_color, secondary_color, accent_color, font_heading, font_body, style_notes }, nav_links: [{ label, href }], seo: { site_title, default_description } }`,
          user: `Business: ${params.businessName}\n\nResearch:\n${researchData}\n\nTemplate:\n${JSON.stringify(template)}\n\nPlan the site structure as JSON.`,
          temperature: 0.3,
          maxTokens: 4000,
          jsonMode: true,
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
        });

        return safeValidateAndLog(env.DB, params.orgId, params.siteId, 'structure-plan', 'plan_site_structure', result.output, result.model_used);
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
        step: 'structure-plan',
        error: errorMsg,
        elapsed_ms: elapsed('structure-plan'),
        message: 'Structure planning failed: ' + errorMsg,
        phase: 'generation',
        recoverable: false,
      });
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw err;
    }

    const structurePlan = JSON.parse(structurePlanJson);
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.structure_plan_complete', {
      page_count: structurePlan.pages?.length ?? 0,
      pages: structurePlan.pages?.map((p: { path: string }) => p.path) ?? [],
      elapsed_ms: elapsed('structure-plan'),
      message: 'Site structure planned: ' + (structurePlan.pages?.length ?? 0) + ' pages',
      phase: 'generation',
    });

    // ── Step 4: Claude Code Container Build ──────────────────
    // The container handles EVERYTHING: generation, R2 upload, D1 status update, email notification.
    // No API fallback — Claude Code container is the ONLY acceptable build method.
    startTimer('container-build');
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.container_build_started', {
      step: 'container-build',
      message: 'Dispatching build to Claude Code container (Vite + React + Tailwind + shadcn/ui)',
      phase: 'generation',
    });

    try {
      await step.do('container-build', {
        retries: { limit: 1, delay: '30 seconds', backoff: 'exponential' },
        timeout: '15 minutes',
      }, async () => {
        if (!env.SITE_BUILDER) {
          throw new Error('SITE_BUILDER container not configured — cannot build without Claude Code');
        }

        const siteBaseUrl = `https://${params.slug}.${DOMAINS.SITES_SUFFIX}`;
        const containerId = env.SITE_BUILDER.idFromName(params.slug);
        const container = env.SITE_BUILDER.get(containerId);

        // Pass ALL data including images from /create page
        const buildPayload = {
          slug: params.slug,
          siteId: params.siteId,
          orgId: params.orgId,
          businessName: params.businessName,
          businessAddress: params.businessAddress || '',
          businessPhone: params.businessPhone || '',
          businessWebsite: social.website_url || (params as any).businessWebsite || '',
          additionalContext: params.additionalContext || '',
          researchData: { profile, brand, sellingPoints, social, images },
          assetUrls: assetManifest.map((key: string) => ({
            url: `${siteBaseUrl}/assets/${key.split('/').pop()}`,
            name: key.split('/').pop() || key,
          })),
          structurePlan,
          scrapedContent: typeof scrapedContent === 'string' ? scrapedContent : '',
        };

        const containerRes = await container.fetch('http://container/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPayload),
        });

        if (!containerRes.ok) {
          const errText = await containerRes.text().catch(() => 'Unknown error');
          throw new Error(`Container build failed: ${containerRes.status} ${errText}`);
        }

        return 'container-build-dispatched';
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
        step: 'container-build',
        error: errorMsg,
        elapsed_ms: elapsed('container-build'),
        message: 'Container build dispatch failed: ' + errorMsg,
        phase: 'generation',
        recoverable: false,
      });
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw err;
    }

    // Container handles R2 upload, D1 status update, and email notification.
    // The workflow's job is done after dispatching the build.
    const totalElapsed = elapsed('workflow');
    const totalSeconds = Math.round(totalElapsed / 1000);
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.container_dispatched', {
      slug: params.slug,
      url: `https://${params.slug}${DOMAINS.SITES_SUFFIX}`,
      total_elapsed_ms: totalElapsed,
      total_seconds: totalSeconds,
      message: `Container build dispatched for ${params.businessName} · Research took ${totalSeconds}s · Container will handle generation + upload + publish`,
      phase: 'complete',
    });

    return {
      siteId: params.siteId,
      slug: params.slug,
      model_used: 'claude-code-container',
      status: 'container-building',
    };
  }
}
