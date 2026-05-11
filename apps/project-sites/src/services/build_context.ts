/**
 * @module services/build_context
 *
 * @description
 * Assembles all research data + asset manifest into a single `BuildContext`
 * JSON document and stores it in R2 at
 * `sites/{slug}/assets/_build-context.json`. The bolt.diy editor iframe
 * fetches this document on load and uses it as the authoritative source
 * of truth for the website-generation prompt — this avoids serializing
 * megabytes of research blobs through `postMessage`, which would blow the
 * structured-clone size budget.
 *
 * Tier-aware: the `instructions` string changes based on the org's
 * `BudgetTier` (`free` | `pro` | `patron`). Free tier ships static
 * imagery + no video; pro tier unlocks Sora hero video + NotebookLM
 * podcast embeds; patron tier additionally unlocks the immersive
 * infographic gallery (Recraft + Vega-Lite).
 *
 * Versioning: every context JSON carries `version: '1'`. Schema changes
 * MUST bump this field; bolt.diy reads it to pick the right adapter.
 *
 * @example
 * ```ts
 * const ctx = generateBuildContext(business, research, assets, slug, 'pro');
 * const url = await storeBuildContext(env, slug, ctx);
 * // → 'https://acme.projectsites.dev/assets/_build-context.json'
 * ```
 *
 * @see {@link module:services/ai_workflows}
 * @see {@link module:services/site_serving}
 */

import type { Env } from '../types/env.js';
import { TIER_CAPS, type BudgetTier } from '@project-sites/shared/schemas';

interface AssetInfo {
  key: string;
  name: string;
  type: string;
  url: string;
  confidence: number;
  source: string;
}

interface BuildContext {
  version: '1';
  business: {
    name: string;
    address?: string;
    phone?: string;
    website?: string;
    category?: string;
  };
  research: {
    profile?: unknown;
    brand?: unknown;
    sellingPoints?: unknown;
    social?: unknown;
    images?: unknown;
  };
  assets: AssetInfo[];
  budget: {
    tier: BudgetTier;
    caps: typeof TIER_CAPS[BudgetTier];
  };
  instructions: string;
  createdAt: string;
}

/**
 * Generate a build context JSON from research data and asset manifest.
 *
 * @param business - Normalized business profile (name, address, phone,
 *   website, category). Required: `name`. All other fields optional but
 *   improve downstream generation quality.
 * @param research - Bundle of research-phase outputs (profile, brand,
 *   selling points, social, images). Shape is intentionally `unknown` —
 *   bolt.diy validates each sub-bundle against its own Zod schema.
 * @param assets - Manifest of R2-hosted assets (logos, hero images,
 *   section images, favicons). URLs are normalized to absolute below.
 * @param slug - Site slug (lowercase, hyphenated). Used to compute the
 *   asset base URL `https://{slug}.projectsites.dev/assets`.
 * @param budgetTier - Plan tier; controls capabilities exposed in
 *   `instructions` (Sora video, NotebookLM podcast, immersive gallery).
 *   Defaults to `'free'`.
 * @returns A fully-populated `BuildContext` ready for R2 upload. Pure
 *   function — no side effects, no async, no I/O.
 *
 * @remarks
 * Asset URL normalization: entries with an existing `url` field are
 * passed through unchanged; bare R2 keys are rewritten to absolute
 * `https://{slug}.projectsites.dev/assets/...` URLs. Callers SHOULD
 * provide either a bare key or a fully-qualified URL — mixing is
 * supported but discouraged.
 *
 * @throws Never — pure function, all inputs are trusted at this boundary.
 */
export function generateBuildContext(
  business: { name: string; address?: string; phone?: string; website?: string; category?: string },
  research: { profile?: unknown; brand?: unknown; sellingPoints?: unknown; social?: unknown; images?: unknown },
  assets: AssetInfo[],
  slug: string,
  budgetTier: BudgetTier = 'free',
): BuildContext {
  const assetBaseUrl = `https://${slug}.projectsites.dev/assets`;

  // Add full URLs to assets
  const enrichedAssets = assets.map((a) => ({
    ...a,
    url: a.url || `${assetBaseUrl}/${a.key.replace(`sites/${slug}/assets/`, '')}`,
  }));

  const caps = TIER_CAPS[budgetTier];
  const tierInstructions = [
    `Budget tier: ${budgetTier} (max ${caps.max_generated_images} AI-generated images this build).`,
    caps.video_enabled ? 'Sora hero video ENABLED — embed one short autoplay-muted hero clip.' : 'No paid video generation — stock footage from Pexels/Pixabay only when needed.',
    caps.podcast_enabled ? 'NotebookLM podcast embed ENABLED — render the episode player on /about.' : 'No podcast embed.',
    caps.immersive_enabled ? 'Immersive infographic gallery ENABLED — generate one Recraft+Vega-Lite explainer per main service.' : 'Static section visuals only.',
  ].join(' ');

  return {
    version: '1',
    business,
    research,
    assets: enrichedAssets,
    budget: { tier: budgetTier, caps },
    instructions: [
      `Build a complete, gorgeous, animated portfolio website for "${business.name}".`,
      'Use the provided brand colors, fonts, and design style from the research data.',
      'Reference the asset URLs directly in <img> tags — they are already hosted and accessible.',
      enrichedAssets.some((a) => a.name.includes('logo')) ? 'Use the provided logo in the header and favicon references.' : 'Generate a text-based logo using the brand fonts and colors.',
      'Include smooth scroll animations, hover micro-interactions, and responsive mobile-first layout.',
      'Create all pages: index.html, privacy.html, terms.html, plus any relevant section pages.',
      'Include favicon references in the <head> linking to the provided favicon assets.',
      tierInstructions,
    ].join('\n'),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Persist a `BuildContext` to R2 and return its public URL.
 *
 * @param env - Worker bindings; `env.SITES_BUCKET` (R2) is required.
 * @param slug - Site slug; determines the R2 key prefix.
 * @param context - Build context produced by `generateBuildContext()`.
 * @returns Absolute URL pointing at the stored JSON document. bolt.diy
 *   will fetch this URL on iframe load.
 *
 * @remarks
 * Side effect: writes 1 object to R2 at
 * `sites/{slug}/assets/_build-context.json`. Idempotent — re-running
 * overwrites the prior version, which is the desired behavior for
 * rebuild flows.
 *
 * Content-Type: `application/json`. JSON is pretty-printed (2-space
 * indent) to keep the document inspectable from the R2 dashboard.
 *
 * @throws {Error} Propagates R2 client errors (auth, quota, network).
 *   Caller SHOULD `try/catch` and route through `error_handler`
 *   middleware so the workflow records the failure to `audit_logs`.
 */
export async function storeBuildContext(
  env: Env,
  slug: string,
  context: BuildContext,
): Promise<string> {
  const key = `sites/${slug}/assets/_build-context.json`;
  await env.SITES_BUCKET.put(key, JSON.stringify(context, null, 2), {
    httpMetadata: { contentType: 'application/json' },
  });

  return `https://${slug}.projectsites.dev/assets/_build-context.json`;
}
