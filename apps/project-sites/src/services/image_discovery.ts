/**
 * @module services/image_discovery
 * @description Discover and download brand images from the web.
 *
 * Uses Google Custom Search Images API to find images attributable
 * to a business, with confidence scoring based on source relevance.
 */

import type { Env } from '../types/env.js';

interface DiscoveredImage {
  key: string;
  name: string;
  size: number;
  type: string;
  confidence: number;
  source: 'discovered';
  attribution: string;
  sourceUrl: string;
}

/**
 * Search for brand-related images using Google Custom Search API.
 *
 * Requires `GOOGLE_CSE_KEY` and `GOOGLE_CSE_CX` env vars.
 * If not configured, returns empty array (non-blocking).
 */
export async function discoverBrandImages(
  env: Env,
  slug: string,
  businessName: string,
  businessType: string,
  websiteUrl?: string,
): Promise<DiscoveredImage[]> {
  const apiKey = (env as any).GOOGLE_CSE_KEY;
  const cx = (env as any).GOOGLE_CSE_CX;

  if (!apiKey || !cx) {
    console.warn('[image_discovery] Google CSE not configured — skipping image discovery');
    return [];
  }

  const results: DiscoveredImage[] = [];
  const queries = [
    `"${businessName}" logo`,
    `"${businessName}" ${businessType} storefront`,
    `"${businessName}" ${businessType} interior`,
  ];

  for (const query of queries) {
    try {
      const url = new URL('https://www.googleapis.com/customsearch/v1');
      url.searchParams.set('key', apiKey);
      url.searchParams.set('cx', cx);
      url.searchParams.set('q', query);
      url.searchParams.set('searchType', 'image');
      url.searchParams.set('num', '3');
      url.searchParams.set('imgSize', 'large');
      url.searchParams.set('safe', 'active');

      const res = await fetch(url.toString());
      if (!res.ok) continue;

      const data = (await res.json()) as {
        items?: { link: string; image?: { contextLink?: string }; title?: string }[];
      };

      if (!data.items) continue;

      for (const item of data.items.slice(0, 2)) {
        const imageUrl = item.link;
        const sourceUrl = item.image?.contextLink || '';
        const title = item.title || 'untitled';

        // Calculate confidence based on source relevance
        let confidence = 40; // base
        if (sourceUrl.includes(businessName.toLowerCase().replace(/[^a-z]/g, ''))) confidence += 30;
        if (websiteUrl && sourceUrl.includes(new URL(websiteUrl).hostname)) confidence += 25;
        if (title.toLowerCase().includes(businessName.toLowerCase())) confidence += 10;
        confidence = Math.min(confidence, 95);

        const downloaded = await downloadAndStore(env, slug, imageUrl, title, confidence);
        if (downloaded) {
          results.push({
            ...downloaded,
            attribution: sourceUrl || imageUrl,
            sourceUrl: sourceUrl || imageUrl,
          });
        }
      }
    } catch (err) {
      console.warn(`[image_discovery] Search failed for "${query}":`, err);
    }
  }

  return results;
}

/**
 * Download an image from a URL and store it in R2.
 */
async function downloadAndStore(
  env: Env,
  slug: string,
  imageUrl: string,
  title: string,
  confidence: number,
): Promise<Omit<DiscoveredImage, 'attribution' | 'sourceUrl'> | null> {
  try {
    const res = await fetch(imageUrl, { headers: { 'User-Agent': 'ProjectSites/1.0 ImageDiscovery' } });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;

    const data = await res.arrayBuffer();
    if (data.byteLength > 10 * 1024 * 1024) return null; // Skip images > 10MB
    if (data.byteLength < 1000) return null; // Skip tiny images (likely tracking pixels)

    const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
    const safeName = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .substring(0, 50) || 'discovered';
    const fileName = `${safeName}-${confidence}pct.${ext}`;
    const key = `sites/${slug}/assets/discovered/${fileName}`;

    await env.SITES_BUCKET.put(key, data, {
      httpMetadata: { contentType },
      customMetadata: {
        source: 'discovered',
        confidence: String(confidence),
        originalUrl: imageUrl.substring(0, 500),
      },
    });

    return {
      key,
      name: fileName,
      size: data.byteLength,
      type: contentType,
      confidence,
      source: 'discovered',
    };
  } catch (err) {
    console.warn('[image_discovery] Download failed:', err);
    return null;
  }
}
