/**
 * @module services/build_context
 * @description Assembles all research + assets into a build context JSON for bolt.diy.
 *
 * The build context is stored in R2 and referenced by URL when
 * bolt.diy is loaded in an iframe. bolt.diy fetches the context
 * and uses it to generate the website — avoiding large postMessage payloads.
 */

import type { Env } from '../types/env.js';

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
): BuildContext {
  const assetBaseUrl = `https://${slug}.projectsites.dev/assets`;

  // Add full URLs to assets
  const enrichedAssets = assets.map((a) => ({
    ...a,
    url: a.url || `${assetBaseUrl}/${a.key.replace(`sites/${slug}/assets/`, '')}`,
  }));

  return {
    version: '1',
    business,
    research,
    assets: enrichedAssets,
    instructions: [
      `Build a complete, gorgeous, animated portfolio website for "${business.name}".`,
      'Use the provided brand colors, fonts, and design style from the research data.',
      'Reference the asset URLs directly in <img> tags — they are already hosted and accessible.',
      enrichedAssets.some((a) => a.name.includes('logo')) ? 'Use the provided logo in the header and favicon references.' : 'Generate a text-based logo using the brand fonts and colors.',
      'Include smooth scroll animations, hover micro-interactions, and responsive mobile-first layout.',
      'Create all pages: index.html, privacy.html, terms.html, plus any relevant section pages.',
      'Include favicon references in the <head> linking to the provided favicon assets.',
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
