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

// Step callbacks return JSON-stringified data (string is always Serializable).
// We parse it back after the step completes.

const RETRY_3 = { retries: { limit: 3, delay: '10 seconds' as const, backoff: 'exponential' as const }, timeout: '2 minutes' as const };

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
    // Fallback: provide sensible defaults when JSON extraction fails
    // This prevents entire workflow from crashing due to LLM returning prose
    const defaults: Record<string, unknown> = {
      'research-brand': {
        logo: { found_online: false, search_query: '', fallback_design: { text: '', font: 'Inter', accent_shape: 'circle', accent_color: '#64ffda' } },
        colors: { primary: '#2563eb', secondary: '#7c3aed', accent: '#64ffda', background: '#ffffff', surface: '#f8fafc', text_primary: '#1e293b', text_secondary: '#64748b' },
        fonts: { heading: 'Inter', body: 'Source Sans Pro' },
        brand_personality: 'professional, warm, approachable',
        style_notes: 'Clean modern design with warm accents',
      },
      'research-selling-points': {
        selling_points: [
          { headline: 'Quality Service', description: 'We deliver exceptional quality in everything we do.', icon: 'star' },
          { headline: 'Community Focused', description: 'Deeply rooted in our local community.', icon: 'heart' },
          { headline: 'Trusted Choice', description: 'Trusted by our customers for years.', icon: 'shield-check' },
        ],
        hero_slogans: [{ headline: 'Welcome', subheadline: 'Serving our community with pride', cta_primary: { text: 'Contact Us', action: 'scroll_to_contact' }, cta_secondary: { text: 'Learn More', action: 'scroll_to_about' } }],
        benefit_bullets: ['Quality service', 'Community focused', 'Trusted by locals'],
      },
      'structure-plan': {
        pages: [
          { path: '/', title: 'Home', purpose: 'Main landing page', sections: ['hero', 'features', 'about', 'services', 'testimonials', 'contact', 'faq', 'footer'] },
          { path: '/about', title: 'About', purpose: 'About the business', sections: ['hero', 'story', 'team', 'values', 'cta'] },
          { path: '/services', title: 'Services', purpose: 'Detailed services', sections: ['hero', 'services-grid', 'pricing', 'cta'] },
          { path: '/contact', title: 'Contact', purpose: 'Contact information', sections: ['hero', 'form', 'map', 'hours'] },
        ],
        design: { primary_color: '#2563eb', secondary_color: '#7c3aed', accent_color: '#64ffda', font_heading: 'Inter', font_body: 'Source Sans Pro', style_notes: 'Clean modern design' },
        nav_links: [{ label: 'Home', href: '/' }, { label: 'About', href: '/about' }, { label: 'Services', href: '/services' }, { label: 'Contact', href: '/contact' }],
        seo: { site_title: 'Business Name', default_description: 'Professional services for the community' },
      },
    };
    if (defaults[stepName]) {
      await workflowLog(db, orgId, siteId, 'workflow.debug.using_defaults', {
        step: stepName, message: 'JSON extraction failed — using sensible defaults for ' + stepName,
      });
      extracted = defaults[stepName];
    } else {
      throw new Error('JSON extraction failed for ' + stepName + ': ' + (jsonErr instanceof Error ? jsonErr.message : String(jsonErr)));
    }
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

    // Use Promise.allSettled so individual failures don't crash the entire research phase
    const defaultBrand = JSON.stringify({
      logo: { found_online: false, search_query: '', fallback_design: { text: '', font: 'Inter', accent_shape: 'circle', accent_color: '#64ffda' } },
      colors: { primary: '#2563eb', secondary: '#7c3aed', accent: '#64ffda', background: '#ffffff', surface: '#f8fafc', text_primary: '#1e293b', text_secondary: '#64748b' },
      fonts: { heading: 'Inter', body: 'Source Sans Pro' },
      brand_personality: 'professional, warm, approachable',
      style_notes: 'Clean modern design',
    });
    const defaultSelling = JSON.stringify({
      selling_points: [
        { headline: 'Quality Service', description: 'Exceptional quality in everything we do.', icon: 'star' },
        { headline: 'Community Focus', description: 'Deeply rooted in our local community.', icon: 'heart' },
        { headline: 'Trusted Choice', description: 'Trusted by customers for years.', icon: 'shield-check' },
      ],
      hero_slogans: [{ headline: 'Welcome', subheadline: 'Serving our community', cta_primary: { text: 'Contact Us', action: 'scroll_to_contact' }, cta_secondary: { text: 'Learn More', action: 'scroll_to_about' } }],
      benefit_bullets: ['Quality service', 'Community focused', 'Trusted locally'],
    });
    const defaultSocial = JSON.stringify({ social_links: [], website_url: params.businessWebsite || '', review_platforms: [] });
    const defaultImages = JSON.stringify({ hero_images: [], service_images: [], placeholder_strategy: 'gradient' });

    const results = await Promise.allSettled([
      socialJsonPromise,
      brandJsonPromise,
      sellingPointsJsonPromise,
      imagesJsonPromise,
    ]);

    const socialJson = results[0].status === 'fulfilled' ? results[0].value : defaultSocial;
    const brandJson = results[1].status === 'fulfilled' ? results[1].value : defaultBrand;
    const sellingPointsJson = results[2].status === 'fulfilled' ? results[2].value : defaultSelling;
    const imagesJson = results[3].status === 'fulfilled' ? results[3].value : defaultImages;

    const failedSteps = results.filter(r => r.status === 'rejected').map((r, i) => ['social', 'brand', 'selling-points', 'images'][i]);
    if (failedSteps.length > 0) {
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.partial_failure', {
        step: 'parallel-research',
        failed_streams: failedSteps,
        errors: results.filter(r => r.status === 'rejected').map(r => (r as PromiseRejectedResult).reason?.message || String((r as PromiseRejectedResult).reason)),
        message: 'Research partially failed (' + failedSteps.join(', ') + ') — using defaults. Build continues.',
        phase: 'data_collection',
      });
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

    // Discover brand images from ALL available APIs in parallel (optional, non-blocking)
    // The discoverBrandImages function internally checks which API keys are available
    // and uses Promise.allSettled to query all sources simultaneously.
    {
      try {
        const discoveredResult = await step.do('discover-brand-images', {
          retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
          timeout: '3 minutes',
        }, async () => {
          const { discoverBrandImages } = await import('../services/image_discovery.js');
          const results = await discoverBrandImages(env, params.slug, params.businessName,
            profile.business_type, social.website_url || undefined);
          return JSON.stringify(results);
        });
        const discovered = JSON.parse(discoveredResult);
        for (const d of discovered) assetManifest.push(d.key);
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.complete', {
          step: 'discover-brand-images',
          source_count: discovered.length,
          sources: [...new Set(discovered.map((d: any) => d.attribution?.split(' — ')[0] || 'unknown'))],
          message: `Discovered ${discovered.length} brand images from parallel API queries`,
        });
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
          step: 'discover-brand-images', error: String(err), message: 'Image discovery failed (non-blocking)',
        });
      }
    }

    // Discover videos for the business (optional, non-blocking)
    let discoveredVideos: any[] = [];
    let videoAttribution: any[] = [];
    if (env.YOUTUBE_API_KEY || env.PEXELS_API_KEY || env.PIXABAY_API_KEY) {
      try {
        const videoResult = await step.do('discover-videos', {
          retries: { limit: 1, delay: '5 seconds', backoff: 'exponential' },
          timeout: '1 minute',
        }, async () => {
          const videoSearchUrl = `https://${DOMAINS.SITES_BASE}/api/ai/discover-videos`;
          const res = await fetch(videoSearchUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: params.businessName,
              address: params.businessAddress,
              business_type: profile.business_type,
            }),
          });
          if (res.ok) {
            const data = await res.json() as { data: { videos: any[]; attribution: any[] } };
            return JSON.stringify(data.data);
          }
          return JSON.stringify({ videos: [], attribution: [] });
        });
        const parsed = JSON.parse(videoResult);
        discoveredVideos = parsed.videos || [];
        videoAttribution = parsed.attribution || [];
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.complete', {
          step: 'discover-videos', message: `Discovered ${discoveredVideos.length} videos`,
        });
      } catch (err) {
        await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
          step: 'discover-videos', error: String(err), message: 'Video discovery failed (non-blocking)',
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

    // ── Step 2.5b: Deep-crawl existing website (Firecrawl-style) ─────
    // Crawls ALL pages (up to 20), extracts all text + images + videos,
    // and uses AI vision to extract brand colors from the homepage screenshot.
    let scrapedContent = '';
    if (social.website_url || params.businessWebsite) {
      try {
        const websiteUrl = params.businessWebsite || social.website_url || '';
        const siteUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
        scrapedContent = await step.do('scrape-website', {
          retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' },
          timeout: '8 minutes',
        }, async () => {
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.scrape_started', {
            url: siteUrl, message: `Deep-crawling ${siteUrl} (all pages)`, phase: 'research',
          });

          const UA = 'Mozilla/5.0 (compatible; ProjectSites/1.0; +https://projectsites.dev)';
          let domain = '';
          try { domain = new URL(siteUrl).hostname; } catch { /* ignore */ }

          // Helper: fetch a page and extract content
          async function scrapePage(url: string): Promise<{
            url: string; title: string; headings: string[]; paragraphs: string[];
            images: string[]; links: string[];
          } | null> {
            try {
              const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
              if (!res.ok) return null;
              const ct = res.headers.get('content-type') || '';
              if (!ct.includes('text/html')) return null;
              const html = await res.text();

              const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
              const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
              const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
              const h3s = [...html.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)].map(m => m[1].replace(/<[^>]+>/g, '').trim()).filter(Boolean);
              const paragraphs = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
                .map(m => m[1].replace(/<[^>]+>/g, '').trim())
                .filter(t => t.length > 20);
              // Also grab list items for more content
              const listItems = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
                .map(m => m[1].replace(/<[^>]+>/g, '').trim())
                .filter(t => t.length > 10 && t.length < 500);
              const images = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)]
                .map(m => m[1])
                .filter(u => !u.includes('data:') && !u.includes('pixel') && !u.includes('spacer') && !u.includes('tracking'))
                .map(u => u.startsWith('/') ? `https://${domain}${u}` : u.startsWith('http') ? u : `https://${domain}/${u}`);
              // Find internal links to crawl next
              const internalLinks = [...html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi)]
                .map(m => m[1])
                .filter(href => {
                  if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return false;
                  if (href.startsWith('/')) return true;
                  try { return new URL(href).hostname === domain; } catch { return false; }
                })
                .map(href => href.startsWith('/') ? `https://${domain}${href}` : href);

              return {
                url,
                title: titleMatch?.[1]?.trim() || '',
                headings: [...h1s, ...h2s, ...h3s],
                paragraphs: [...paragraphs, ...listItems],
                images: [...new Set(images)],
                links: [...new Set(internalLinks)],
              };
            } catch { return null; }
          }

          // Crawl homepage first
          const homepage = await scrapePage(siteUrl);
          if (!homepage) return '';

          // Crawl internal pages (up to 50 total for thorough content extraction)
          const visited = new Set<string>([siteUrl, siteUrl + '/']);
          const pages = [homepage];
          let queue = homepage.links.filter(l => !visited.has(l)).slice(0, 1000);

          for (const link of queue) {
            if (visited.size >= 500) break;
            const normalized = link.replace(/\/$/, '');
            if (visited.has(normalized) || visited.has(normalized + '/')) continue;
            visited.add(normalized);
            visited.add(normalized + '/');
            const page = await scrapePage(link);
            if (page) pages.push(page);
          }

          // Second pass: scan all discovered pages for MORE internal links not yet visited
          if (visited.size < 500) {
            const secondPassLinks: string[] = [];
            for (const page of pages) {
              for (const link of page.links) {
                const normalized = link.replace(/\/$/, '');
                if (!visited.has(normalized) && !visited.has(normalized + '/')) {
                  secondPassLinks.push(link);
                }
              }
            }
            const uniqueSecondPass = [...new Set(secondPassLinks)];
            for (const link of uniqueSecondPass) {
              if (visited.size >= 500) break;
              const normalized = link.replace(/\/$/, '');
              if (visited.has(normalized) || visited.has(normalized + '/')) continue;
              visited.add(normalized);
              visited.add(normalized + '/');
              const page = await scrapePage(link);
              if (page) pages.push(page);
            }
          }

          // Collect all unique images across the site
          const allImages = [...new Set(pages.flatMap(p => p.images))];

          // Build image profiles with page context (up to 30 for prompt budget)
          const imageProfiles = allImages.slice(0, 30).map(imgUrl => {
            // Find which page this image appeared on and what text was near it
            const sourcePage = pages.find(p => p.images.includes(imgUrl));
            return {
              url: imgUrl,
              source_page: sourcePage?.url || '',
              source_title: sourcePage?.title || '',
              // Get text context: headings and paragraphs from the section where the image appeared
              context: sourcePage ? sourcePage.headings.slice(0, 3).join(', ') + '. ' + sourcePage.paragraphs.slice(0, 2).join(' ').slice(0, 200) : '',
            };
          });

          // Build comprehensive scraped content
          const scraped = {
            site_url: siteUrl,
            pages_crawled: pages.length,
            homepage: {
              title: homepage.title,
              headings: homepage.headings,
              paragraphs: homepage.paragraphs,
            },
            all_pages: pages.map(p => ({
              url: p.url,
              title: p.title,
              headings: p.headings,
              content: p.paragraphs.join('\n'),
            })),
            all_images: allImages.slice(0, 500), // Up to 500 images across the site
            image_profiles: imageProfiles, // Images with page context for correct placement
            all_text: pages.flatMap(p => p.paragraphs).join('\n\n'),
            ogImage: homepage.paragraphs.length > 0 ? '' : '', // Will be set from meta
          };

          // Extract og:image and logo from homepage HTML
          let logoUrl = '';
          try {
            const homepageRes = await fetch(siteUrl, { headers: { 'User-Agent': UA }, redirect: 'follow' });
            if (homepageRes.ok) {
              const html = await homepageRes.text();
              const ogMatch = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
              if (ogMatch) scraped.ogImage = ogMatch[1];

              // Extract logo: look in header, nav, .logo class, img with logo in src/alt/class
              const logoPatterns = [
                // Common logo patterns in HTML
                /<(?:a|div|span)[^>]*(?:class|id)=["'][^"']*logo[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/gi,
                /<img[^>]+(?:class|id)=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/gi,
                /<img[^>]+src=["']([^"']*logo[^"']*)["']/gi,
                /<img[^>]+alt=["'][^"']*logo[^"']*["'][^>]+src=["']([^"']+)["']/gi,
                // Header images (often logos)
                /<header[\s\S]*?<img[^>]+src=["']([^"']+)["']/gi,
                /<nav[\s\S]*?<img[^>]+src=["']([^"']+)["']/gi,
              ];
              for (const pattern of logoPatterns) {
                const match = pattern.exec(html);
                if (match?.[1] && !match[1].includes('data:') && !match[1].includes('pixel')) {
                  let url = match[1];
                  if (url.startsWith('/')) url = `https://${domain}${url}`;
                  else if (!url.startsWith('http')) url = `https://${domain}/${url}`;
                  logoUrl = url;
                  break;
                }
              }

              // Also extract favicon as fallback logo/icon source
              const faviconMatch = html.match(/<link[^>]+rel=["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]+href=["']([^"']+)["']/i);
              if (faviconMatch?.[1]) {
                let favUrl = faviconMatch[1];
                if (favUrl.startsWith('/')) favUrl = `https://${domain}${favUrl}`;
                else if (!favUrl.startsWith('http')) favUrl = `https://${domain}/${favUrl}`;
                (scraped as any).favicon_url = favUrl;
              }
            }
          } catch { /* ignore */ }

          // Store extracted logo
          if (logoUrl) {
            (scraped as any).logo_url = logoUrl;
            // Upload logo to R2 for use in generated site
            try {
              const logoRes = await fetch(logoUrl, { headers: { 'User-Agent': UA } });
              if (logoRes.ok) {
                const logoData = await logoRes.arrayBuffer();
                const ext = logoUrl.split('.').pop()?.split('?')[0] || 'png';
                const logoKey = `sites/${params.slug}/assets/logo.${ext}`;
                await env.SITES_BUCKET.put(logoKey, logoData, {
                  httpMetadata: { contentType: logoRes.headers.get('content-type') || `image/${ext}` },
                });
                (scraped as any).logo_r2_url = `https://${params.slug}.${DOMAINS.SITES_SUFFIX}/assets/logo.${ext}`;
              }
            } catch { /* non-critical */ }
          }

          // ── Extract brand colors via AI vision ──
          // Strategy: Use a screenshot API to capture the homepage as an image,
          // then send that image to GPT-4o vision for color extraction.
          // Fallback: Use Cloudflare Browser Rendering or a free screenshot service.
          if (env.OPENAI_API_KEY && domain) {
            try {
              // Use a free screenshot service to capture the homepage
              // microlink.io provides free screenshot API (no key needed)
              const screenshotUrl = `https://api.microlink.io/?url=${encodeURIComponent(siteUrl)}&screenshot=true&meta=false&embed=screenshot.url`;
              const ssRes = await fetch(screenshotUrl, { headers: { 'User-Agent': 'ProjectSites/1.0' } });
              let imageUrl = '';
              if (ssRes.ok) {
                const ssData = await ssRes.json() as { data?: { screenshot?: { url?: string } } };
                imageUrl = ssData.data?.screenshot?.url || '';
              }

              // Fallback: use Google's PageSpeed API thumbnail (if PAGESPEED_API_KEY available)
              if (!imageUrl && env.PAGESPEED_API_KEY) {
                const psUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(siteUrl)}&key=${env.PAGESPEED_API_KEY}&category=PERFORMANCE&strategy=DESKTOP`;
                const psRes = await fetch(psUrl);
                if (psRes.ok) {
                  const psData = await psRes.json() as { lighthouseResult?: { audits?: { 'final-screenshot'?: { details?: { data?: string } } } } };
                  const b64 = psData.lighthouseResult?.audits?.['final-screenshot']?.details?.data;
                  if (b64) imageUrl = b64; // base64 data URI
                }
              }

              if (imageUrl) {
                const colorRes = await fetch('https://api.openai.com/v1/chat/completions', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: [{
                      role: 'user',
                      content: [
                        { type: 'text', text: 'Analyze this website screenshot carefully. Extract the EXACT brand colors used in the design. Look at:\n1. The logo colors (most important)\n2. Header/nav background color\n3. Button and link colors\n4. Text colors (headings vs body)\n5. Background colors (main page bg)\n6. Accent/highlight colors\n\nReturn ONLY valid JSON:\n{"primary":"#hex","secondary":"#hex","accent":"#hex","background":"#hex","text":"#hex","header_bg":"#hex","design_spirit":"one sentence describing the visual feel and mood of this website"}' },
                        { type: 'image_url', image_url: { url: imageUrl, detail: 'low' } },
                      ],
                    }],
                    max_tokens: 300,
                    temperature: 0.1,
                  }),
                });
                if (colorRes.ok) {
                  const colorData = await colorRes.json() as { choices: { message: { content: string } }[] };
                  const colorJson = colorData.choices?.[0]?.message?.content?.replace(/```json\n?/g, '').replace(/```/g, '').trim();
                  if (colorJson) {
                    try {
                      const extractedColors = JSON.parse(colorJson);
                      (scraped as any).extracted_brand_colors = extractedColors;
                      // Store design spirit from AI vision analysis
                      if (extractedColors.design_spirit) {
                        (scraped as any).design_spirit = extractedColors.design_spirit;
                      }
                      // Override research brand colors with visually extracted ones
                      if (extractedColors.primary) {
                        (brand as any).colors = { ...(brand as any).colors, ...extractedColors };
                      }
                      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.brand_colors_extracted', {
                        colors: extractedColors,
                        design_spirit: extractedColors.design_spirit || null,
                        source: 'ai_vision_screenshot',
                        message: `Brand colors extracted: primary=${extractedColors.primary}, accent=${extractedColors.accent}${extractedColors.design_spirit ? `, spirit: ${extractedColors.design_spirit}` : ''}`,
                        phase: 'research',
                      });
                    } catch { /* ignore parse errors */ }
                  }
                }
              }
            } catch { /* non-critical — brand research colors will be used as fallback */ }
          }

          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.scrape_complete', {
            pages_crawled: pages.length,
            total_paragraphs: pages.flatMap(p => p.paragraphs).length,
            total_images: allImages.length,
            extracted_colors: (scraped as any).extracted_brand_colors || null,
            message: `Deep-crawled ${pages.length} pages — ${pages.flatMap(p => p.paragraphs).length} paragraphs, ${allImages.length} images`,
            phase: 'research',
          });

          return JSON.stringify(scraped);
        });
      } catch {
        // Scraping failed — continue without it
      }
    }

    // ── Step 2.6: Seed per-site D1 data tables from research ──
    let siteDataJson = '{}';
    try {
      await step.do('seed-site-data', RETRY_3, async () => {
        const siteId = params.siteId;
        const rows: { id: string; table_name: string; data_json: string; sort_order: number }[] = [];

        // Services from profile
        if (profile.services && Array.isArray(profile.services)) {
          profile.services.forEach((svc: any, i: number) => {
            rows.push({
              id: `svc-${siteId.slice(0, 8)}-${i}`,
              table_name: 'services',
              data_json: JSON.stringify({ name: svc.name || svc, description: svc.description || '', price: svc.price || '', duration: svc.duration || '' }),
              sort_order: i,
            });
          });
        }

        // Team from profile
        if (profile.team && Array.isArray(profile.team)) {
          profile.team.forEach((member: any, i: number) => {
            rows.push({
              id: `team-${siteId.slice(0, 8)}-${i}`,
              table_name: 'team_members',
              data_json: JSON.stringify({ name: member.name || '', role: member.role || member.title || '', bio: member.bio || '', photo_url: member.photo || '' }),
              sort_order: i,
            });
          });
        }

        // Business hours from profile
        if (profile.hours || profile.opening_hours) {
          const hours = profile.hours || profile.opening_hours;
          if (typeof hours === 'object') {
            const days = Array.isArray(hours) ? hours : Object.entries(hours as Record<string, any>).map(([day, h]: [string, any]) => ({ day, open: h.open || h, close: h.close || '' }));
            days.forEach((h: any, i: number) => {
              rows.push({
                id: `hours-${siteId.slice(0, 8)}-${i}`,
                table_name: 'business_hours',
                data_json: JSON.stringify({ day: h.day || '', open: h.open || '', close: h.close || '', closed: h.closed || false }),
                sort_order: i,
              });
            });
          }
        }

        // FAQ from selling points
        if (sellingPoints.faq_questions && Array.isArray(sellingPoints.faq_questions)) {
          sellingPoints.faq_questions.forEach((faq: any, i: number) => {
            rows.push({
              id: `faq-${siteId.slice(0, 8)}-${i}`,
              table_name: 'faq',
              data_json: JSON.stringify({ question: faq.question || '', answer: faq.answer || '' }),
              sort_order: i,
            });
          });
        }

        // Social links from social research
        if (social.social_links && Array.isArray(social.social_links)) {
          social.social_links.filter((s: any) => s.url).forEach((s: any, i: number) => {
            rows.push({
              id: `social-${siteId.slice(0, 8)}-${i}`,
              table_name: 'social_links',
              data_json: JSON.stringify({ platform: s.platform || '', url: s.url || '', handle: s.handle || '' }),
              sort_order: i,
            });
          });
        }

        // Brand config from brand research
        if (brand) {
          const brandEntries = [
            { key: 'primary_color', value: (brand as any).colors?.primary || '' },
            { key: 'secondary_color', value: (brand as any).colors?.secondary || '' },
            { key: 'accent_color', value: (brand as any).colors?.accent || '' },
            { key: 'font_heading', value: (brand as any).fonts?.heading || '' },
            { key: 'font_body', value: (brand as any).fonts?.body || '' },
            { key: 'brand_personality', value: (brand as any).brand_personality || '' },
          ].filter(e => e.value);
          brandEntries.forEach((entry, i) => {
            rows.push({
              id: `brand-${siteId.slice(0, 8)}-${i}`,
              table_name: 'brand_config',
              data_json: JSON.stringify(entry),
              sort_order: i,
            });
          });
        }

        // Insert all rows in batches
        if (rows.length > 0) {
          const batchSize = 20;
          for (let i = 0; i < rows.length; i += batchSize) {
            const batch = rows.slice(i, i + batchSize);
            const stmts = batch.map(row =>
              env.DB.prepare(
                `INSERT OR REPLACE INTO site_data (id, site_id, table_name, data_json, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
              ).bind(row.id, siteId, row.table_name, row.data_json, row.sort_order),
            );
            await env.DB.batch(stmts);
          }
        }

        // Build site data JSON for the generation prompt
        const grouped: Record<string, any[]> = {};
        for (const row of rows) {
          if (!grouped[row.table_name]) grouped[row.table_name] = [];
          grouped[row.table_name].push({ id: row.id, ...JSON.parse(row.data_json) });
        }

        return JSON.stringify(grouped);
      });

      // Store the result for use in the build payload
      siteDataJson = await step.do('read-site-data-json', RETRY_3, async () => {
        const result = await env.DB.prepare(
          `SELECT table_name, id, data_json FROM site_data WHERE site_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC`,
        ).bind(params.siteId).all();
        const grouped: Record<string, any[]> = {};
        for (const row of (result.results || []) as any[]) {
          if (!grouped[row.table_name]) grouped[row.table_name] = [];
          grouped[row.table_name].push({ id: row.id, ...JSON.parse(row.data_json || '{}') });
        }
        return JSON.stringify(grouped);
      });

      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.complete', {
        step: 'seed-site-data', message: `Seeded D1 data tables from research`,
        phase: 'data_collection',
      });
    } catch (err) {
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
        step: 'seed-site-data', error: String(err), message: 'D1 data seeding failed (non-blocking)',
      });
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
        try {
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
          });

          return safeValidateAndLog(env.DB, params.orgId, params.siteId, 'structure-plan', 'plan_site_structure', result.output, result.model_used);
        } catch (llmErr) {
          // If LLM call fails (quota, network, etc), use the default structure plan
          await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.debug.structure_plan_fallback', {
            error: llmErr instanceof Error ? llmErr.message : String(llmErr),
            message: 'Structure plan LLM call failed, using default structure',
          });
          const defaultPlan = {
            pages: [
              { path: '/', title: `${params.businessName} - Home`, purpose: 'Main landing page', sections: ['hero', 'features', 'about', 'services', 'testimonials', 'contact', 'faq', 'footer'] },
              { path: '/about', title: 'About', purpose: 'About the business', sections: ['hero', 'story', 'team', 'values'] },
              { path: '/services', title: 'Services', purpose: 'Services offered', sections: ['hero', 'services-grid', 'pricing'] },
              { path: '/contact', title: 'Contact', purpose: 'Contact information', sections: ['hero', 'form', 'map', 'hours'] },
            ],
            design: { primary_color: '#2563eb', secondary_color: '#7c3aed', accent_color: '#64ffda', font_heading: 'Inter', font_body: 'Source Sans Pro', style_notes: 'Clean modern design' },
            nav_links: [{ label: 'Home', href: '/' }, { label: 'About', href: '#about' }, { label: 'Services', href: '#services' }, { label: 'Contact', href: '#contact' }],
            seo: { site_title: params.businessName, default_description: `${params.businessName} - ${params.businessCategory || 'Professional services'}` },
          };
          return JSON.stringify(defaultPlan);
        }
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

    // ── Steps 4-6: Multi-Stage Container Build ──────────────
    // Container is a stateless Claude Code executor. Each step sends prompts +
    // existing files, receives back updated files. Workflow handles R2/D1.
    // Each step is under 20 min to stay within the 25-min workflow step timeout.

    if (!env.SITE_BUILDER) {
      await updateSiteStatus(env.DB, params.siteId, 'error');
      throw new Error('SITE_BUILDER container not configured');
    }

    // Use a stage-specific container ID so each stage gets a fresh container.
    // This avoids "container not running" errors when the container idles between stages.
    let stageCounter = 0;
    function getContainer() {
      stageCounter++;
      const id = env.SITE_BUILDER!.idFromName(`${params.slug}-stage-${stageCounter}`);
      return env.SITE_BUILDER!.get(id);
    }
    const safeName = (params.businessName || 'Business').replace(/[^\w\s\-'.]/g, '').slice(0, 100);
    const category = profile.business_type || params.businessCategory || '';
    const colors = (brand.colors || {}) as Record<string, string>;
    const primary = colors.primary || '#1a1a2e';
    const secondary = colors.secondary || '#16213e';
    const accent = colors.accent || '#e94560';

    // Prepare context files that Claude will read
    const contextFiles: Record<string, unknown> = {
      'research.json': { profile, brand, sellingPoints, social, images },
      'params.json': {
        businessName: safeName, slug: params.slug, category,
        colors, assets: assetManifest, structure: structurePlan,
        siteData: siteDataJson ? JSON.parse(siteDataJson) : {},
      },
    };
    if (typeof scrapedContent === 'string' && scrapedContent.length > 0) {
      contextFiles['scraped.txt'] = scrapedContent;
    }

    /** Helper: call container with prompts, return files */
    async function callContainer(
      prompts: { text: string; label: string; timeoutMin: number }[],
      existingFiles: { name: string; content: string }[],
      stepLabel: string,
    ): Promise<{ name: string; content: string }[]> {
      const payload = {
        slug: params.slug,
        _anthropicKey: env.ANTHROPIC_API_KEY || '',
        contextFiles,
        existingFiles,
        prompts,
      };

      const container = getContainer();
      const res = await container.fetch('http://container/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => 'Unknown');
        throw new Error(`Container ${stepLabel} failed: ${res.status} ${errText}`);
      }

      const result = await res.json() as {
        status: string;
        files?: { name: string; content: string }[];
        error?: string;
        results?: { label: string; success: boolean }[];
      };

      if (result.error) throw new Error(`Container ${stepLabel}: ${result.error}`);

      // Log diagnostics from container
      const diag = (result as any).diag;
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.complete', {
        step: stepLabel,
        files: (result.files || []).length,
        results: result.results,
        diag: diag ? {
          apiKeySet: diag.apiKeySet,
          apiKeyLen: diag.apiKeyLen,
          claudeInstalled: diag.claudeInstalled,
          filesOnDisk: diag.filesOnDisk,
        } : null,
        message: `${stepLabel}: ${(result.files || []).length} files | API key: ${diag?.apiKeySet ? 'YES(' + diag.apiKeyLen + ')' : 'NO'} | Claude: ${diag?.claudeInstalled ? 'YES' : 'NO'} | Disk: ${(diag?.filesOnDisk || []).length} files`,
        phase: 'generation',
      });

      return result.files || [];
    }

    /** Helper: upload files to R2 */
    async function uploadToR2(files: { name: string; content: string }[], isInterim: boolean): Promise<string> {
      const version = new Date().toISOString().replace(/[:.]/g, '-') + (isInterim ? '-interim' : '');
      for (const f of files) {
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        const ct = { html: 'text/html', xml: 'application/xml', json: 'application/json',
          svg: 'image/svg+xml', css: 'text/css', js: 'application/javascript',
          ts: 'text/plain', tsx: 'text/plain', jsx: 'text/plain',
          png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
          webp: 'image/webp', ico: 'image/x-icon', txt: 'text/plain',
        }[ext] || 'text/plain';
        await env.SITES_BUCKET.put(`sites/${params.slug}/${version}/${f.name}`, f.content, {
          httpMetadata: { contentType: ct },
        });
      }
      await env.SITES_BUCKET.put(`sites/${params.slug}/_manifest.json`,
        JSON.stringify({ current_version: version, files: files.map(f => f.name), building: isInterim }),
        { httpMetadata: { contentType: 'application/json' } });
      await env.DB.prepare(
        isInterim
          ? "UPDATE sites SET current_build_version = ?, updated_at = datetime('now') WHERE id = ?"
          : "UPDATE sites SET status = 'published', current_build_version = ?, updated_at = datetime('now') WHERE id = ?",
      ).bind(version, params.siteId).run();
      return version;
    }

    // Scraped content note for prompts
    // Parse scraped content to extract page URLs, logo, and content
    let scrapedNote = '';
    let scrapedPages: { url: string; title: string; content: string }[] = [];
    let scrapedLogoUrl = '';
    let scrapedAllImages: string[] = [];
    let scrapedImageProfiles: { url: string; source_page: string; source_title: string; context: string }[] = [];
    let scrapedDesignSpirit = '';
    if (typeof scrapedContent === 'string' && scrapedContent.length > 0) {
      try {
        const parsed = JSON.parse(scrapedContent);
        scrapedPages = parsed.all_pages || [];
        scrapedLogoUrl = parsed.logo_r2_url || parsed.logo_url || '';
        scrapedAllImages = parsed.all_images || [];
        scrapedImageProfiles = parsed.image_profiles || [];
        scrapedDesignSpirit = parsed.design_spirit || '';

        // Build content note — include page structure + key content (cap at 30KB to avoid prompt overflow)
        const contentSections = scrapedPages.map((p: any) => {
          const content = (p.content || '').slice(0, 1500); // First 1500 chars per page
          return `--- PAGE: ${p.url} ---\nTitle: ${p.title}\nHeadings: ${(p.headings || []).join(' | ')}\n${content}`;
        }).join('\n\n');
        const cappedContent = contentSections.slice(0, 30000);
        scrapedNote = '\n\n=== ORIGINAL WEBSITE CONTENT (recreate ALL pages with this content) ===\n' +
          `Total pages scraped: ${scrapedPages.length}\n` +
          `Total images found: ${scrapedAllImages.length}\n\n` + cappedContent;
      } catch {
        scrapedNote = '\n\nORIGINAL WEBSITE CONTENT:\n' + scrapedContent.slice(0, 20000);
      }
    }

    let currentFiles: { name: string; content: string }[] = [];

    try {
      // ── STAGE A: Foundation (1 big prompt, ~15 min) ──
      startTimer('container-build');
      const stageAResult = await step.do('stage-a-foundation', {
        retries: { limit: 1, delay: '10 seconds', backoff: 'exponential' },
        timeout: '20 minutes',
      }, async () => {
        // Build a comprehensive prompt using ALL research data
        const brandLogo = (brand.logo || {}) as Record<string, any>;
        const logoUrl = brandLogo.found_online ? (brandLogo.url || '') : '';
        const allAssets = (assetManifest || []).map((key: string) => `https://${params.slug}.${DOMAINS.SITES_SUFFIX}/assets/${key.split('/').pop()}`);

        const foundationPrompt = [
          `You are RECREATING the website for "${safeName}" as a SUPED-UP CLONE — same brand identity, same content, but DRAMATICALLY more beautiful.`,
          'IMPORTANT: You MUST use the Write tool to create files in the current directory.',
          'Read ALL _ prefixed files for full research context.',
          '',
          '=== BRAND IDENTITY (CRITICAL — use REAL brand from the original site) ===',
          `Name: ${safeName}`,
          `Category: ${category || 'general business'}`,
          `Brand Colors (extracted from original site via AI vision): primary:${primary}; secondary:${secondary}; accent:${accent}`,
          'IMPORTANT: These colors were extracted from the original website. USE THEM as the primary palette.',
          'THEME DECISION: Look at the original site background. If it uses white/light backgrounds (like njsk.org), use a LIGHT theme:',
          '- White (#FFFFFF) or off-white (#F8F9FA) main background',
          '- Dark text (#1A1A2E) for body copy',
          '- Brand primary color for accents, buttons, headings',
          '- Dark header/footer with white logo version',
          '- This creates the best brand continuity with the original site',
          'Let the logo\'s visual style (colors, shapes, mood) guide the ENTIRE design direction.',
          '',
          scrapedLogoUrl ? `LOGO (MUST USE — downloaded from original site): ${scrapedLogoUrl}` : logoUrl ? `Logo URL: ${logoUrl} — Download and embed this logo.` : '',
          scrapedLogoUrl || logoUrl ? 'Use <img> tag with the logo URL. Do NOT create a generic SVG when a real logo exists.' : 'No logo found — create a professional inline SVG using brand colors.',
          'LOGO HANDLING:',
          '- Download the original logo and use it as-is for the primary version',
          '- Create a white-only version (all elements white, transparent bg) for dark headers/footers',
          '- Create a dark version for light backgrounds if the site uses a light theme',
          '- The logo should appear in the header of EVERY page',
          '- Derive a favicon/app icon from the logo (monogram or key symbol)',
          `Brand personality: ${brand.brand_personality || 'professional, warm, approachable'}`,
          scrapedDesignSpirit ? `Design spirit (from AI analysis of original site): ${scrapedDesignSpirit}` : '',
          '',
          '=== MULTI-PAGE ARCHITECTURE ===',
          'Create MULTIPLE HTML files with CLEAN URLs (use descriptive filenames):',
          scrapedPages.length > 0
            ? (() => {
                // Intelligently group pages — combine thin pages, keep substantial ones
                const pageList = scrapedPages.map((p: any, i: number) => {
                  const pageName = p.url.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '') || '/';
                  const fileName = pageName === '/' ? 'index.html' : pageName.replace(/^\//, '').replace(/\//g, '-').replace(/[^a-z0-9-]/gi, '') + '.html';
                  return `${i + 1}. ${fileName} — "${p.title || pageName}" (original: ${p.url})`;
                });
                return pageList.join('\n');
              })()
            : structurePlan.pages ? structurePlan.pages.map((p: any, i: number) => `${i + 1}. ${p.path} — ${p.title}: ${p.purpose}`).join('\n') : 'index.html, about.html, services.html, contact.html',
          '',
          'RULES for page organization:',
          '- Combine thin pages into richer, more comprehensive pages',
          'NAVIGATION (max 5-6 top-level items):',
          '- Home, About, Services, Get Involved, Blog, Contact',
          '- Use dropdown menus for sub-sections under Services and Get Involved',
          '- Don\'t list every page in the top nav — keep it clean and scannable',
          '- You have FULL CREATIVITY to reorganize URLs for better keywords',
          '- Every page must have unique images — NEVER reuse the same image across pages',
          '- Each page must be a COMPELLING MULTIMEDIA EXPERIENCE',
          '- Consistent header (logo + nav) and footer across all pages',
          '',
          '=== HERO BACKGROUND VIDEO ===',
          'The homepage hero MUST use a background VIDEO (not just an image):',
          '- Use a relevant video from Pexels: https://player.vimeo.com/video/{ID} or direct MP4',
          '- Style: muted, autoplay, loop, playsinline, object-fit:cover, position:absolute',
          '- Add a dark overlay gradient on top for text readability',
          '- Fallback: <img> for browsers that dont support video',
          '- Choose video relevant to: ' + (category || 'community service'),
          '',
          discoveredVideos.length > 0 ? `Discovered videos:\n${discoveredVideos.map((v: any) => v.url || v.embed_url || JSON.stringify(v)).join('\n')}` : '',
          '',
          '=== DESIGN (Stripe / Linear / Vercel quality) ===',
          '- Dark theme preferred with vibrant brand accent colors',
          '- Font: Inter or Satoshi (Google Fonts, display=swap)',
          '- Typography: 48-64px hero, 24-32px sections, 16px body',
          '- 10+ @keyframes animations per page. Glassmorphism. Gradient text.',
          '- IntersectionObserver scroll reveals on ALL sections',
          '- Every page must be BREATHTAKINGLY GORGEOUS and masterfully animated',
          '',
          '=== HOMEPAGE SECTIONS ===',
          '1. Sticky header: real logo (or SVG) + nav to all pages',
          '2. Full-viewport hero: stunning gradient overlay on high-res image, compelling headline, primary CTA',
          '3. Mission/value proposition (brief, compelling)',
          '4. Services/programs overview (cards with images, linking to detail pages)',
          '5. Impact section (counters, stats, testimonials)',
          '6. Latest news/blog preview (if source has blog content)',
          '7. Call to action (donate/volunteer/contact based on category)',
          '8. Footer: full business info, nav links, social, "Built by ProjectSites.dev"',
          '',
          '=== DONATION PAGE (for non-profits and causes) ===',
          'If this is a non-profit or organization that accepts donations, create a donate.html page:',
          '- Full-screen split layout at desktop (two panes side by side)',
          '- LEFT PANE: Large compelling cause photo + description of why donations matter + vivid animations',
          '- RIGHT PANE: Simple donation form like givedirectly.org — monthly by default, $50/month default',
          '- Amount options: $25, $50, $100, $250, Custom',
          '- Monthly/One-time toggle (monthly selected by default)',
          '- Simple name + email fields, then "Donate Now" button',
          '- Button links to Stripe checkout (use data attributes for JS integration)',
          '- Below the form: "Recent donors" section (placeholder for last 50 anonymous donations)',
          '- The whole page should be emotionally compelling with stunning imagery and animation',
          '',
          '=== CONTENT (use ALL original website content) ===',
          'The _scraped.txt file contains the COMPLETE content from the original website.',
          'You MUST use this real content — do NOT make up placeholder text.',
          'Include ALL programs, services, team members, history, and details from the original.',
          'Augment with researched facts about affiliated organizations.',
          '',
          '=== IMAGES & MULTIMEDIA (15-20 per page, professional quality) ===',
          scrapedImageProfiles.length > 0
            ? `Images from original site (with context for correct placement):\n${scrapedImageProfiles.map((img, i) => `${i + 1}. ${img.url} — From page "${img.source_title || img.source_page}", context: "${img.context}"`).join('\n')}`
            : scrapedAllImages.length > 0 ? `Images scraped from original website (USE THESE FIRST):\n${scrapedAllImages.slice(0, 40).join('\n')}` : '',
          allAssets.length > 0 ? `Additional discovered/generated assets:\n${allAssets.slice(0, 20).join('\n')}` : '',
          'QUANTITY: 15-20 unique images per page. Use galleries, grids, carousels.',
          'QUALITY RULES:',
          '- NEVER use images with baked-in text, white borders, montage layouts, or watermarks',
          '- Crop images that have embedded text/banners — extract just the photograph',
          '- Crop images with large empty/solid-color areas to focus on the content',
          '- Replace generic icons with quality stock photography or DALL-E art',
          '- Every section header should have a relevant photo, not just an icon',
          'FORMAT:',
          '- Use <picture> element with WebP source + PNG/JPG fallback:',
          '  <picture><source srcset="image.webp" type="image/webp"><img src="image.jpg"></picture>',
          '- All images: loading="lazy" below fold, explicit width/height for CLS',
          '- Alt text with keywords on every image',
          '- ALL asset paths ABSOLUTE (start with /)',
          'SOURCES (in priority order):',
          '1. Original business photos (from scraped site)',
          '2. Unsplash: https://images.unsplash.com/photo-{ID}?w={W}&h={H}&fit=crop&auto=format',
          '3. Pexels: https://images.pexels.com/photos/{ID}/pexels-photo-{ID}.jpeg?auto=compress&w={W}',
          '4. DALL-E: generate ultra-realistic images for any gaps',
          'VIDEO:',
          '- Homepage hero: background video (muted, autoplay, loop, playsinline)',
          '- Service pages: relevant video if available',
          '- Use Pexels videos: https://player.vimeo.com/video/{ID} or direct MP4',
          '- Embed YouTube videos where business has relevant content',
          '- Use video ANYWHERE it makes sense — testimonials, tours, demonstrations',
          'ICONS → PHOTOS:',
          '- Instead of SVG icons for feature cards, use small stock photos or DALL-E art',
          '- Feature cards should have a photo that represents the feature, not a generic icon',
          '- Use photos for testimonial avatars, team members, service illustrations',
          '',
          'CRITICAL: Match images to their content context:',
          '- A photo of a person must be used where that person is discussed',
          '- A photo of a building must be used in location/about sections',
          '- A photo of food must be used in meal/service sections',
          '- NEVER place a building photo next to a person\'s name',
          '- If an image doesn\'t match any section, don\'t use it',
          '- Check image_profiles in _research.json for context about each image',
          '- NO empty image holders — if no image available, use a relevant Unsplash photo',
          '- NEVER reuse the same image on multiple pages',
          '- TEXT OVER IMAGES: Never place text over the focal point of a background image.',
          '  Position text in low-complexity areas (sky, edges, solid colors). Use gradient overlays that fade from one side.',
          '',
          '=== AI IMAGE GENERATION ===',
          'After placing all discovered/stock images, identify sections that still need better imagery.',
          'For each gap, generate a DALL-E prompt that creates an ultra-realistic photo matching:',
          '- The business category and mood',
          '- The section content and purpose',
          '- The brand color palette',
          'Use: https://api.openai.com/v1/images/generations with model dall-e-3, size 1792x1024',
          'Style: photorealistic, professional, warm lighting, high quality',
          '',
          '=== SEO ===',
          `<title>: ${safeName} — primary keyword + location`,
          `canonical: https://${params.slug}.projectsites.dev/`,
          'JSON-LD LocalBusiness with geo, hours, sameAs. og tags. FAQPage schema.',
          'Semantic HTML. robots.txt. sitemap.xml listing ALL pages.',
          '',
          `=== GOOGLE MAPS ===`,
          `Address: ${params.businessAddress || ''}`,
          `Link address text to: https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(params.businessAddress || safeName)}`,
          '',
          'OUTPUT: Write index.html + all sub-pages + robots.txt + sitemap.xml.',
          'URL STRUCTURE:',
          '- Use directory-style URLs: /about/ not about.html',
          '- Each page should be in its own directory: about/index.html',
          '- Internal links should use /page-name/ format (trailing slash)',
          '- ALL asset paths must be ABSOLUTE (start with /): use /assets/style.css NOT assets/style.css',
          '- CSS, JS, and image references must use absolute paths from root so they work on sub-pages',
          '- Create a _redirects file mapping old .html URLs to clean URLs',
          'Every file must be production-ready. No placeholders. No lorem ipsum.',
          scrapedNote,
          params.additionalContext ? `\nADDITIONAL CONTEXT: ${params.additionalContext}` : '',
        ].filter(Boolean).join('\n');

        return callContainer([{
          label: 'A-foundation',
          timeoutMin: 15,
          text: foundationPrompt,
        }], [], 'stage-a');
      });
      currentFiles = (stageAResult as { name: string; content: string }[]) || [];

      // Upload interim v1
      if (currentFiles.length > 0) {
        await step.do('upload-interim-v1', RETRY_3, async () => {
          await uploadToR2(currentFiles, true);
          return 'uploaded';
        });
      }

      // Visual inspection after Stage A — feed critique into Stage B
      let visualCritique = '';
      if (env.OPENAI_API_KEY && currentFiles.length > 0) {
        try {
          const inspectResult = await step.do('inspect-after-a', RETRY_3, async () => {
            const ssUrl = `https://api.microlink.io/?url=https://${params.slug}.${DOMAINS.SITES_SUFFIX}&screenshot=true&meta=false&embed=screenshot.url`;
            const ssRes = await fetch(ssUrl);
            if (!ssRes.ok) return '';
            const ssData = await ssRes.json() as any;
            const imageUrl = ssData?.data?.screenshot?.url;
            if (!imageUrl) return '';

            const critiqueRes = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{
                  role: 'user',
                  content: [
                    { type: 'text', text: 'You are reviewing a website screenshot. List the TOP 5 visual/design issues to fix. Be specific about CSS changes needed. Focus on: image placement, color consistency, text readability, spacing, and overall polish. Return a concise numbered list.' },
                    { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
                  ],
                }],
                max_tokens: 400,
                temperature: 0.3,
              }),
            });
            if (!critiqueRes.ok) return '';
            const critiqueData = await critiqueRes.json() as any;
            return critiqueData.choices?.[0]?.message?.content || '';
          });
          visualCritique = (inspectResult as string) || '';
          if (visualCritique) {
            await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.visual_critique', {
              stage: 'after-a', critique: visualCritique.slice(0, 500),
              message: 'AI visual critique after Stage A: ' + visualCritique.slice(0, 200),
            });
          }
        } catch { /* non-critical */ }
      }

      // ── STAGE B: Enhancement (individual steps to avoid timeout) ──
      if (currentFiles.some(f => f.name === 'index.html')) {
        const b1 = await step.do('stage-b1-beauty', {
          retries: { limit: 1, delay: '10 seconds', backoff: 'exponential' },
          timeout: '15 minutes',
        }, async () => {
          return callContainer([
            { label: 'B1-beauty', timeoutMin: 10, text: 'Make ALL pages MORE BEAUTIFUL. Do NOT rewrite from scratch — enhance what exists.\n\nFor ALL HTML files:\n- 10+ @keyframes animations (fadeInUp, slideInLeft, scaleIn, subtleFloat, gradientShift, glowPulse)\n- IntersectionObserver: sections start opacity:0 translateY:30px, animate to visible on scroll\n- Glassmorphism on cards (backdrop-filter:blur(20px))\n- Use the BRAND COLORS from the original site (check _research.json for extracted colors)\n- Gradient text on hero headings using brand primary color\n- Smooth hover transforms on cards (translateY -4px + shadow)\n- @media prefers-reduced-motion\n- Check every image: is it RELEVANT to its section? Is it duplicated on another page? Fix any mismatches.\n- Scan every image: does it have baked-in text, white borders, or montage styling? If so, remove it or replace with a clean photo.\n- Every section should have 3-5 images minimum, arranged in grids or galleries.\n- Fill any empty image placeholders with relevant Unsplash photos.\n- ALL asset paths must be ABSOLUTE (start with /) so they work on sub-pages\n- Replace ALL generic SVG icons with relevant stock photos or DALL-E-generated images\n- Add image galleries (3-4 photos) to sections that only have 1 image\n- Use <picture> with WebP source for all images\n- SELF-PROMPT: Look at each page critically. What would make it more stunning? Do it.' + (visualCritique ? '\n\nAI VISUAL INSPECTION FOUND THESE ISSUES (fix ALL of them):\n' + visualCritique : '') },
          ], currentFiles, 'stage-b1');
        });
        const b1Arr = b1 as { name: string; content: string }[];
        if (b1Arr?.length > 0) currentFiles = b1Arr;

        const b2 = await step.do('stage-b2-seo-content', {
          retries: { limit: 1, delay: '10 seconds', backoff: 'exponential' },
          timeout: '15 minutes',
        }, async () => {
          return callContainer([
            { label: 'B2-seo-content', timeoutMin: 10, text: 'SEO + content audit on ALL HTML files. Do NOT rewrite from scratch.\n\n1. SEO: Verify meta description, og tags, canonical URL, heading hierarchy on every page. JSON-LD LocalBusiness on index.html. FAQPage schema. Internal links between ALL pages. robots.txt + sitemap.xml listing ALL pages.\n2. CONTENT: Read _scraped.txt and _research.json. Ensure ALL original website content is present. If any services, programs, team members, or details are missing — add them. Every page should have images. No empty background-image. loading=lazy. Alt text with keywords.\n3. IMAGE COMPLETENESS: Count images per page — if any page has fewer than 15, add more from Unsplash/Pexels. Verify no image appears on more than one page.' },
          ], currentFiles, 'stage-b2');
        });
        const b2Arr = b2 as { name: string; content: string }[];
        if (b2Arr?.length > 0) currentFiles = b2Arr;

        // Upload interim v2
        await step.do('upload-interim-v2', RETRY_3, async () => {
          await uploadToR2(currentFiles, true);
          return 'uploaded';
        });
      }

      // ── STAGE C: Quality (3 prompts, ~10 min) ──
      if (currentFiles.some(f => f.name === 'index.html')) {
        let domainPrompt = 'Add domain-specific features to index.html. ';
        const catLower = category.toLowerCase();
        if (catLower.includes('non-profit') || catLower.includes('community') || catLower.includes('church') || catLower.includes('soup')) {
          domainPrompt += 'NON-PROFIT: Add prominent donation CTA (gradient button), impact counters (meals served, volunteers, years active), volunteer signup section. Warm, dignified tone.';
        } else if (catLower.includes('restaurant') || catLower.includes('food')) {
          domainPrompt += 'RESTAURANT: Add menu section, hours widget, reservation/order CTA.';
        } else if (catLower.includes('salon') || catLower.includes('spa')) {
          domainPrompt += 'SALON: Add services+prices, staff profiles, booking CTA.';
        } else {
          domainPrompt += 'Add appropriate features for this business type.';
        }

        const stageC = await step.do('stage-c-quality', {
          retries: { limit: 1, delay: '10 seconds', backoff: 'exponential' },
          timeout: '20 minutes',
        }, async () => {
          return callContainer([
            { label: 'C1-visual', timeoutMin: 5, text: 'Visual quality audit on ALL HTML files.\n\n1. Check EVERY image: is it relevant to the section content? Remove/replace irrelevant ones.\n2. Check for DUPLICATE images across pages — each page must have unique imagery.\n3. Fill any empty image placeholders with relevant Unsplash photos.\n4. Ensure the LOGO from the original site is visible in the header of every page.\n5. Verify brand colors match the original site (not generic blue/cyan).\n6. Text contrast: readable on all backgrounds.\n7. Grid partial rows centered.\n8. Nav should have max 5-7 top-level links, use dropdowns for sub-pages.\n9. Google Maps address should link to directions URL.\n10. AUDIT every image: no white space, no text overlays, no borders, no montage styling.\n11. Replace any montage/collage images with clean individual photographs.\n12. Verify all images use <picture> with WebP + fallback.\n13. Check that icons have been replaced with photos where appropriate.\n14. Each page should have 15+ images — add more if under that count.\n15. SELF-PROMPT: What else would make each page more stunning? Do it.' },
            { label: 'C2-domain', timeoutMin: 5, text: domainPrompt },
          ], currentFiles, 'stage-c');
        });
        const stageCArr = stageC as { name: string; content: string }[];
        if (stageCArr?.length > 0) currentFiles = stageCArr;
      }

      // ── STAGE D: Final (2 prompts, ~5 min) ──
      if (currentFiles.some(f => f.name === 'index.html')) {
        const stageD = await step.do('stage-d-final', {
          retries: { limit: 1, delay: '10 seconds', backoff: 'exponential' },
          timeout: '15 minutes',
        }, async () => {
          return callContainer([
            { label: 'D1-production', timeoutMin: 5, text: 'Final production polish on ALL files.\n\n1. No console.log. Valid HTML. All URLs use HTTPS.\n2. Google Fonts preconnect + display=swap.\n3. Back-to-top button. Smooth scroll. Copyright ' + new Date().getFullYear() + '.\n4. Address text links to Google Maps directions URL.\n5. Verify logo appears in header of EVERY page.\n6. Verify app icon/favicon is set.\n7. Every page must look pixel-perfect at 1280px and 375px.\n8. SELF-PROMPT: Browse every page as a user would. What feels incomplete or ugly? Fix it now.' },
            { label: 'D2-safety', timeoutMin: 2, text: 'Safety + SEO final check.\n1. Privacy notice on contact/donation forms.\n2. Footer: Privacy + Terms links on every page.\n3. External links: rel=noopener noreferrer.\n4. FAQ last item: Built by ProjectSites.dev.\n5. Verify sitemap.xml lists ALL pages.\n6. Verify robots.txt allows crawling.' },
          ], currentFiles, 'stage-d');
        });
        const stageDArr = stageD as { name: string; content: string }[];
        if (stageDArr?.length > 0) currentFiles = stageDArr;
      }

      // ── FINAL DEPLOY ──
      if (currentFiles.length > 0) {
        await step.do('upload-final', RETRY_3, async () => {
          const version = await uploadToR2(currentFiles, false);
          await env.DB.prepare(
            "INSERT OR IGNORE INTO site_snapshots (id, site_id, snapshot_name, build_version, description) VALUES (?, ?, 'initial', ?, 'First published version')",
          ).bind(crypto.randomUUID(), params.siteId, version).run();
          return version;
        });
        // ── VISUAL INSPECTION (non-blocking) ──────────────────
        await step.do('visual-inspection', RETRY_3, async () => {
          try {
            // 1. Take a screenshot of the published site via microlink.io
            const screenshotUrl = `https://api.microlink.io/?url=https://${params.slug}.projectsites.dev&screenshot=true&meta=false&embed=screenshot.url`;
            const ssRes = await fetch(screenshotUrl, {
              headers: { 'User-Agent': 'ProjectSites/1.0' },
            });

            if (!ssRes.ok) {
              await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.visual_inspection_skipped', {
                step: 'visual-inspection',
                reason: 'screenshot_failed',
                status: ssRes.status,
                message: `Visual inspection skipped: screenshot API returned ${ssRes.status}`,
              });
              return JSON.stringify({ skipped: true, reason: 'screenshot_failed' });
            }

            const ssData = await ssRes.json() as { data?: { screenshot?: { url?: string } } };
            const imageUrl = ssData.data?.screenshot?.url;

            if (!imageUrl) {
              await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.visual_inspection_skipped', {
                step: 'visual-inspection',
                reason: 'no_screenshot_url',
                message: 'Visual inspection skipped: no screenshot URL in response',
              });
              return JSON.stringify({ skipped: true, reason: 'no_screenshot_url' });
            }

            // 2. Send screenshot to GPT-4o vision for web design critique
            if (!env.OPENAI_API_KEY) {
              await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.visual_inspection_skipped', {
                step: 'visual-inspection',
                reason: 'no_openai_key',
                message: 'Visual inspection skipped: OPENAI_API_KEY not configured',
              });
              return JSON.stringify({ skipped: true, reason: 'no_openai_key' });
            }

            const critiqueRes = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'gpt-4o',
                messages: [{
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: 'You are a senior web designer reviewing this website screenshot. Provide a concise critique:\n1. Overall visual quality (1-10)\n2. Color consistency with brand\n3. Typography quality\n4. Image placement and relevance\n5. Mobile-readiness assessment\n6. Top 3 specific issues to fix\n7. Is the logo visible and properly placed?\nReturn JSON: { score: number, issues: string[], logo_visible: boolean, brand_colors_correct: boolean }',
                    },
                    {
                      type: 'image_url',
                      image_url: { url: imageUrl, detail: 'high' },
                    },
                  ],
                }],
                max_tokens: 500,
                temperature: 0.2,
              }),
            });

            if (!critiqueRes.ok) {
              const errText = await critiqueRes.text().catch(() => 'unknown');
              await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.visual_inspection_failed', {
                step: 'visual-inspection',
                reason: 'gpt4o_api_error',
                status: critiqueRes.status,
                error: errText.substring(0, 500),
                message: `Visual inspection GPT-4o call failed: ${critiqueRes.status}`,
              });
              return JSON.stringify({ skipped: true, reason: 'gpt4o_api_error', status: critiqueRes.status });
            }

            const critiqueData = await critiqueRes.json() as {
              choices?: { message?: { content?: string } }[];
            };
            const rawContent = critiqueData.choices?.[0]?.message?.content ?? '';
            const cleanedContent = rawContent.replace(/```json\n?/g, '').replace(/```/g, '').trim();

            let critique: { score?: number; issues?: string[]; logo_visible?: boolean; brand_colors_correct?: boolean } = {};
            try {
              critique = JSON.parse(cleanedContent);
            } catch {
              // GPT-4o returned non-JSON — log the raw content
              await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.visual_inspection_complete', {
                step: 'visual-inspection',
                raw_critique: cleanedContent.substring(0, 1000),
                parse_error: true,
                message: 'Visual inspection complete but critique was not valid JSON',
              });
              return JSON.stringify({ raw_critique: cleanedContent.substring(0, 1000), parse_error: true });
            }

            // 3. Log the critique to D1 via workflowLog
            const score = typeof critique.score === 'number' ? critique.score : 0;
            const issues = Array.isArray(critique.issues) ? critique.issues : [];
            const hasCriticalIssues = !critique.logo_visible || !critique.brand_colors_correct;

            await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.visual_inspection_complete', {
              step: 'visual-inspection',
              score,
              issues,
              logo_visible: critique.logo_visible ?? null,
              brand_colors_correct: critique.brand_colors_correct ?? null,
              has_critical_issues: hasCriticalIssues,
              needs_improvement: score < 7 || hasCriticalIssues,
              screenshot_url: imageUrl,
              message: `Visual inspection: score=${score}/10, ${issues.length} issues, logo=${critique.logo_visible ? 'visible' : 'missing'}, colors=${critique.brand_colors_correct ? 'correct' : 'incorrect'}`,
            });

            // 4. Return critique for future improvement
            return JSON.stringify({
              score,
              issues,
              logo_visible: critique.logo_visible ?? null,
              brand_colors_correct: critique.brand_colors_correct ?? null,
              needs_improvement: score < 7 || hasCriticalIssues,
            });
          } catch (inspectionErr) {
            // Non-blocking: log the failure but don't fail the workflow
            const errMsg = inspectionErr instanceof Error ? inspectionErr.message : String(inspectionErr);
            await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.visual_inspection_failed', {
              step: 'visual-inspection',
              error: errMsg,
              message: 'Visual inspection failed (non-blocking): ' + errMsg,
            });
            return JSON.stringify({ skipped: true, reason: 'exception', error: errMsg });
          }
        });
      } else {
        await updateSiteStatus(env.DB, params.siteId, 'error');
      }

    } catch (containerErr) {
      const containerErrMsg = containerErr instanceof Error ? containerErr.message : String(containerErr);
      await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.step.failed', {
        step: 'container-build',
        error: containerErrMsg,
        elapsed_ms: elapsed('container-build'),
        message: 'Container build failed: ' + containerErrMsg,
        phase: 'generation',
        recoverable: false,
      });
      await updateSiteStatus(env.DB, params.siteId, 'error');

      // Non-critical notification — we don't have user email in workflow params
      throw containerErr;
    }

    const totalElapsed = elapsed('workflow');
    const totalSeconds = Math.round(totalElapsed / 1000);
    await workflowLog(env.DB, params.orgId, params.siteId, 'workflow.complete', {
      slug: params.slug,
      url: `https://${params.slug}.${DOMAINS.SITES_SUFFIX}`,
      total_elapsed_ms: totalElapsed,
      total_seconds: totalSeconds,
      files: currentFiles.length,
      message: `Published ${params.businessName} with ${currentFiles.length} files in ${totalSeconds}s`,
      phase: 'complete',
    });

    return {
      siteId: params.siteId,
      slug: params.slug,
      model_used: 'claude-code-container',
      status: 'published',
      files: currentFiles.length,
      elapsed_seconds: totalSeconds,
    };
  }
}
