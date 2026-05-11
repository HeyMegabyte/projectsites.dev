/**
 * @module services/build_context
 * @description Assembles all research + assets into a build context JSON for bolt.diy.
 *
 * The build context is stored in R2 and referenced by URL when
 * bolt.diy is loaded in an iframe. bolt.diy fetches the context
 * and uses it to generate the website — avoiding large postMessage payloads.
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
 * Store the build context JSON to R2 and return its URL.
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
