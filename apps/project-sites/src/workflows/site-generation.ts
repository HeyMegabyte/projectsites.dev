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

    // ── Step 1: Profile Research ──────────────────────────────
    // Returns JSON-stringified validated profile data
    const profileJson = await step.do('research-profile', RETRY_3, async () => {
      const { runPrompt } = await import('../services/ai_workflows.js');
      const { validatePromptOutput } = await import('../prompts/schemas.js');

      const result = await runPrompt(env, 'research_profile', 1, {
        business_name: params.businessName,
        business_address: params.businessAddress ?? '',
        business_phone: params.businessPhone ?? '',
        google_place_id: params.googlePlaceId ?? '',
        additional_context: params.additionalContext ?? '',
      });

      const validated = validatePromptOutput('research_profile', JSON.parse(result.output));
      return JSON.stringify(validated);
    });

    const profile = JSON.parse(profileJson) as ProfileData;

    // ── Step 2: Parallel Research ─────────────────────────────
    const servicesJson = JSON.stringify(profile.services.map((s) => s.name));

    const socialJsonPromise = step.do('research-social', RETRY_3, async () => {
      const { runPrompt } = await import('../services/ai_workflows.js');
      const { validatePromptOutput } = await import('../prompts/schemas.js');
      const result = await runPrompt(env, 'research_social', 1, {
        business_name: params.businessName,
        business_address: params.businessAddress ?? '',
        business_type: profile.business_type,
      });
      return JSON.stringify(validatePromptOutput('research_social', JSON.parse(result.output)));
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
      return JSON.stringify(validatePromptOutput('research_brand', JSON.parse(result.output)));
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
        validatePromptOutput('research_selling_points', JSON.parse(result.output)),
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
      return JSON.stringify(validatePromptOutput('research_images', JSON.parse(result.output)));
    });

    const [socialJson, brandJson, sellingPointsJson, imagesJson] = await Promise.all([
      socialJsonPromise,
      brandJsonPromise,
      sellingPointsJsonPromise,
      imagesJsonPromise,
    ]);

    const social = JSON.parse(socialJson) as SocialData;
    const brand = JSON.parse(brandJson) as Record<string, unknown>;
    const sellingPoints = JSON.parse(sellingPointsJson) as Record<string, unknown>;
    const images = JSON.parse(imagesJson) as Record<string, unknown>;
    const research = { profile, social, brand, sellingPoints, images };

    // ── Step 3: Generate Website HTML ─────────────────────────
    const html = await step.do('generate-website', RETRY_HTML, async () => {
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

    // ── Step 4: Legal Pages + Quality Score (parallel) ────────
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
          validatePromptOutput('score_website', JSON.parse(result.output)),
        );
      },
    );

    const [privacyHtml, termsHtml, qualityJson] = await Promise.all([
      privacyPromise,
      termsPromise,
      qualityJsonPromise,
    ]);

    const quality = JSON.parse(qualityJson) as QualityData;

    // ── Step 5: Upload to R2 ──────────────────────────────────
    const version = await step.do(
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

    // ── Step 6: Update D1 status ──────────────────────────────
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

    return {
      siteId: params.siteId,
      slug: params.slug,
      version,
      quality: quality.overall,
      pages: ['index.html', 'privacy.html', 'terms.html', 'research.json'],
    };
  }
}
