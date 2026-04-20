/**
 * @module services/image_discovery
 * @description Discover and download brand images from the web.
 *
 * Uses parallel queries to ALL available multimedia APIs: Google CSE,
 * Unsplash, Pexels (photos + videos), Pixabay, Foursquare, and Yelp.
 * Results are merged, deduplicated, and stored in R2 with confidence scores.
 *
 * @remarks
 * All API calls run in parallel via `Promise.allSettled` so that a failure
 * in one source does not block the others. Each source is optional —
 * if its API key is not configured the source is silently skipped.
 *
 * @example
 * ```ts
 * const images = await discoverBrandImages(env, 'my-biz', 'My Business', 'restaurant', 'https://mybiz.com');
 * ```
 *
 * @see {@link downloadAndStore} for R2 upload logic
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
 * Search for brand-related images from ALL available multimedia APIs in parallel.
 *
 * Sources queried (when API keys are present):
 * - Google Custom Search Images (GOOGLE_CSE_KEY + GOOGLE_CSE_CX)
 * - Unsplash (UNSPLASH_ACCESS_KEY)
 * - Pexels photos AND videos (PEXELS_API_KEY)
 * - Pixabay (PIXABAY_API_KEY)
 * - Foursquare venue photos (FOURSQUARE_API_KEY)
 * - Yelp business photos (YELP_API_KEY)
 *
 * @returns Merged, deduplicated array of discovered images stored in R2.
 */
export async function discoverBrandImages(
  env: Env,
  slug: string,
  businessName: string,
  businessType: string,
  websiteUrl?: string,
): Promise<DiscoveredImage[]> {
  const fetchers: Promise<DiscoveredImage[]>[] = [];

  // ── Google CSE ────────────────────────────────────────────
  const cseKey = (env as any).GOOGLE_CSE_KEY;
  const cseCx = (env as any).GOOGLE_CSE_CX;
  if (cseKey && cseCx) {
    fetchers.push(fetchGoogleCSE(env, slug, businessName, businessType, websiteUrl, cseKey, cseCx));
  }

  // ── Unsplash ──────────────────────────────────────────────
  if ((env as any).UNSPLASH_ACCESS_KEY) {
    fetchers.push(fetchUnsplash(env, slug, businessName, businessType, (env as any).UNSPLASH_ACCESS_KEY));
  }

  // ── Pexels (photos) ───────────────────────────────────────
  if ((env as any).PEXELS_API_KEY) {
    fetchers.push(fetchPexelsPhotos(env, slug, businessName, businessType, (env as any).PEXELS_API_KEY));
  }

  // ── Pexels (videos) ───────────────────────────────────────
  if ((env as any).PEXELS_API_KEY) {
    fetchers.push(fetchPexelsVideos(env, slug, businessName, businessType, (env as any).PEXELS_API_KEY));
  }

  // ── Pixabay ───────────────────────────────────────────────
  if ((env as any).PIXABAY_API_KEY) {
    fetchers.push(fetchPixabay(env, slug, businessName, businessType, (env as any).PIXABAY_API_KEY));
  }

  // ── Foursquare ────────────────────────────────────────────
  if ((env as any).FOURSQUARE_API_KEY) {
    fetchers.push(fetchFoursquare(env, slug, businessName, businessType, (env as any).FOURSQUARE_API_KEY));
  }

  // ── Yelp ──────────────────────────────────────────────────
  if ((env as any).YELP_API_KEY) {
    fetchers.push(fetchYelp(env, slug, businessName, businessType, (env as any).YELP_API_KEY));
  }

  if (fetchers.length === 0) {
    console.warn('[image_discovery] No multimedia API keys configured — skipping image discovery');
    return [];
  }

  // Run ALL sources in parallel — individual failures are isolated
  const settled = await Promise.allSettled(fetchers);
  const results: DiscoveredImage[] = [];
  const seenUrls = new Set<string>();

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      for (const img of outcome.value) {
        if (!seenUrls.has(img.sourceUrl)) {
          seenUrls.add(img.sourceUrl);
          results.push(img);
        }
      }
    } else {
      console.warn('[image_discovery] Source failed:', outcome.reason);
    }
  }

  return results;
}

// ── Source: Google Custom Search ─────────────────────────────

async function fetchGoogleCSE(
  env: Env, slug: string, businessName: string, businessType: string,
  websiteUrl: string | undefined, apiKey: string, cx: string,
): Promise<DiscoveredImage[]> {
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

        let confidence = 40;
        if (sourceUrl.includes(businessName.toLowerCase().replace(/[^a-z]/g, ''))) confidence += 30;
        if (websiteUrl && sourceUrl.includes(new URL(websiteUrl).hostname)) confidence += 25;
        if (title.toLowerCase().includes(businessName.toLowerCase())) confidence += 10;
        confidence = Math.min(confidence, 95);

        const downloaded = await downloadAndStore(env, slug, imageUrl, title, confidence);
        if (downloaded) {
          results.push({ ...downloaded, attribution: sourceUrl || imageUrl, sourceUrl: sourceUrl || imageUrl });
        }
      }
    } catch (err) {
      console.warn(`[image_discovery:cse] Search failed for "${query}":`, err);
    }
  }
  return results;
}

// ── Source: Unsplash ─────────────────────────────────────────

async function fetchUnsplash(
  env: Env, slug: string, businessName: string, businessType: string, accessKey: string,
): Promise<DiscoveredImage[]> {
  const results: DiscoveredImage[] = [];
  const queries = [`${businessType} business`, `${businessName} ${businessType}`];

  for (const query of queries) {
    try {
      const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`;
      const res = await fetch(url, { headers: { 'Authorization': `Client-ID ${accessKey}` } });
      if (!res.ok) continue;

      const data = (await res.json()) as { results?: { urls?: { regular?: string }; description?: string; user?: { name?: string; links?: { html?: string } } }[] };
      if (!data.results) continue;

      for (const photo of data.results.slice(0, 3)) {
        const imageUrl = photo.urls?.regular;
        if (!imageUrl) continue;
        const title = photo.description || `${businessType}-unsplash`;
        const attribution = photo.user?.name ? `Photo by ${photo.user.name} on Unsplash` : 'Unsplash';
        const downloaded = await downloadAndStore(env, slug, imageUrl, `unsplash-${title}`, 55);
        if (downloaded) {
          results.push({ ...downloaded, attribution, sourceUrl: imageUrl });
        }
      }
    } catch (err) {
      console.warn(`[image_discovery:unsplash] Search failed for "${query}":`, err);
    }
  }
  return results;
}

// ── Source: Pexels Photos ───────────────────────────────────

async function fetchPexelsPhotos(
  env: Env, slug: string, businessName: string, businessType: string, apiKey: string,
): Promise<DiscoveredImage[]> {
  const results: DiscoveredImage[] = [];
  try {
    const query = `${businessType} ${businessName}`;
    const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`;
    const res = await fetch(url, { headers: { 'Authorization': apiKey } });
    if (!res.ok) return [];

    const data = (await res.json()) as { photos?: { src?: { large?: string }; alt?: string; photographer?: string }[] };
    if (!data.photos) return [];

    for (const photo of data.photos.slice(0, 4)) {
      const imageUrl = photo.src?.large;
      if (!imageUrl) continue;
      const title = photo.alt || `${businessType}-pexels`;
      const attribution = photo.photographer ? `Photo by ${photo.photographer} on Pexels` : 'Pexels';
      const downloaded = await downloadAndStore(env, slug, imageUrl, `pexels-${title}`, 50);
      if (downloaded) {
        results.push({ ...downloaded, attribution, sourceUrl: imageUrl });
      }
    }
  } catch (err) {
    console.warn('[image_discovery:pexels-photos] Search failed:', err);
  }
  return results;
}

// ── Source: Pexels Videos ───────────────────────────────────

async function fetchPexelsVideos(
  env: Env, slug: string, businessName: string, businessType: string, apiKey: string,
): Promise<DiscoveredImage[]> {
  const results: DiscoveredImage[] = [];
  try {
    const query = `${businessType}`;
    const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`;
    const res = await fetch(url, { headers: { 'Authorization': apiKey } });
    if (!res.ok) return [];

    const data = (await res.json()) as { videos?: { video_files?: { link?: string; quality?: string; file_type?: string }[]; url?: string }[] };
    if (!data.videos) return [];

    for (const video of data.videos.slice(0, 2)) {
      // Pick the HD MP4 file
      const hdFile = video.video_files?.find((f) => f.quality === 'hd' && f.file_type === 'video/mp4')
        || video.video_files?.[0];
      if (!hdFile?.link) continue;

      // Store video metadata as a JSON manifest (videos are too large for R2 direct storage in workflow)
      const safeName = `${businessType}-pexels-video`.toLowerCase().replace(/[^a-z0-9]+/g, '-').substring(0, 50);
      const key = `sites/${slug}/assets/discovered/${safeName}-${Date.now()}.video.json`;
      const manifest = JSON.stringify({ type: 'video', src: hdFile.link, source: 'pexels', pageUrl: video.url || '' });
      await env.SITES_BUCKET.put(key, manifest, {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { source: 'discovered-video', confidence: '45' },
      });
      results.push({
        key, name: `${safeName}.video.json`, size: manifest.length, type: 'application/json',
        confidence: 45, source: 'discovered', attribution: 'Pexels Video', sourceUrl: hdFile.link,
      });
    }
  } catch (err) {
    console.warn('[image_discovery:pexels-videos] Search failed:', err);
  }
  return results;
}

// ── Source: Pixabay ──────────────────────────────────────────

async function fetchPixabay(
  env: Env, slug: string, businessName: string, businessType: string, apiKey: string,
): Promise<DiscoveredImage[]> {
  const results: DiscoveredImage[] = [];
  try {
    const query = `${businessType}`;
    const url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(query)}&image_type=photo&orientation=horizontal&per_page=5&safesearch=true`;
    const res = await fetch(url);
    if (!res.ok) return [];

    const data = (await res.json()) as { hits?: { largeImageURL?: string; tags?: string; user?: string; pageURL?: string }[] };
    if (!data.hits) return [];

    for (const hit of data.hits.slice(0, 3)) {
      const imageUrl = hit.largeImageURL;
      if (!imageUrl) continue;
      const title = hit.tags || `${businessType}-pixabay`;
      const attribution = hit.user ? `Photo by ${hit.user} on Pixabay` : 'Pixabay';
      const downloaded = await downloadAndStore(env, slug, imageUrl, `pixabay-${title}`, 45);
      if (downloaded) {
        results.push({ ...downloaded, attribution, sourceUrl: hit.pageURL || imageUrl });
      }
    }
  } catch (err) {
    console.warn('[image_discovery:pixabay] Search failed:', err);
  }
  return results;
}

// ── Source: Foursquare ──────────────────────────────────────

async function fetchFoursquare(
  env: Env, slug: string, businessName: string, businessType: string, apiKey: string,
): Promise<DiscoveredImage[]> {
  const results: DiscoveredImage[] = [];
  try {
    // Step 1: Search for the venue
    const searchUrl = `https://api.foursquare.com/v3/places/search?query=${encodeURIComponent(businessName)}&limit=1`;
    const searchRes = await fetch(searchUrl, { headers: { 'Authorization': apiKey, 'Accept': 'application/json' } });
    if (!searchRes.ok) return [];

    const searchData = (await searchRes.json()) as { results?: { fsq_id?: string; name?: string }[] };
    const venue = searchData.results?.[0];
    if (!venue?.fsq_id) return [];

    // Step 2: Get venue photos
    const photosUrl = `https://api.foursquare.com/v3/places/${venue.fsq_id}/photos?limit=5`;
    const photosRes = await fetch(photosUrl, { headers: { 'Authorization': apiKey, 'Accept': 'application/json' } });
    if (!photosRes.ok) return [];

    const photos = (await photosRes.json()) as { prefix?: string; suffix?: string }[];
    if (!Array.isArray(photos)) return [];

    for (const photo of photos.slice(0, 3)) {
      if (!photo.prefix || !photo.suffix) continue;
      const imageUrl = `${photo.prefix}original${photo.suffix}`;
      const downloaded = await downloadAndStore(env, slug, imageUrl, `foursquare-${venue.name || businessName}`, 65);
      if (downloaded) {
        results.push({ ...downloaded, attribution: `Foursquare — ${venue.name || businessName}`, sourceUrl: imageUrl });
      }
    }
  } catch (err) {
    console.warn('[image_discovery:foursquare] Search failed:', err);
  }
  return results;
}

// ── Source: Yelp ────────────────────────────────────────────

async function fetchYelp(
  env: Env, slug: string, businessName: string, businessType: string, apiKey: string,
): Promise<DiscoveredImage[]> {
  const results: DiscoveredImage[] = [];
  try {
    const searchUrl = `https://api.yelp.com/v3/businesses/search?term=${encodeURIComponent(businessName)}&limit=1`;
    const searchRes = await fetch(searchUrl, { headers: { 'Authorization': `Bearer ${apiKey}` } });
    if (!searchRes.ok) return [];

    const searchData = (await searchRes.json()) as { businesses?: { id?: string; name?: string; image_url?: string; photos?: string[] }[] };
    const biz = searchData.businesses?.[0];
    if (!biz) return [];

    // Collect main image + photos array
    const photoUrls = new Set<string>();
    if (biz.image_url) photoUrls.add(biz.image_url);
    if (biz.photos) for (const p of biz.photos) photoUrls.add(p);

    // Fetch detailed business info for more photos
    if (biz.id) {
      try {
        const detailRes = await fetch(`https://api.yelp.com/v3/businesses/${biz.id}`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (detailRes.ok) {
          const detail = (await detailRes.json()) as { photos?: string[] };
          if (detail.photos) for (const p of detail.photos) photoUrls.add(p);
        }
      } catch { /* ignore detail fetch failure */ }
    }

    for (const imageUrl of [...photoUrls].slice(0, 4)) {
      const downloaded = await downloadAndStore(env, slug, imageUrl, `yelp-${biz.name || businessName}`, 60);
      if (downloaded) {
        results.push({ ...downloaded, attribution: `Yelp — ${biz.name || businessName}`, sourceUrl: imageUrl });
      }
    }
  } catch (err) {
    console.warn('[image_discovery:yelp] Search failed:', err);
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
