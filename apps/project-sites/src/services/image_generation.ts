/**
 * @module services/image_generation
 *
 * @description
 * AI image generation pipeline for AI-built websites. Wraps OpenAI DALL-E 3
 * for logo / hero / section imagery and synthesizes a complete favicon set
 * (PNG + ICO + webmanifest + browserconfig) from a single source bitmap. All
 * outputs land in R2 under a stable per-site key prefix so the static-site
 * server (`services/site_serving`) can serve them at predictable URLs.
 *
 * ## R2 key conventions
 *
 * | Asset            | Key                                         | Content-Type             |
 * |------------------|---------------------------------------------|--------------------------|
 * | Brand logo       | `sites/{slug}/assets/logo.png`              | `image/png`              |
 * | Section/hero img | `sites/{slug}/assets/generated/{name}.png`  | `image/png`              |
 * | 512px icon       | `sites/{slug}/assets/icon-512.png`          | `image/png`              |
 * | Web manifest     | `sites/{slug}/assets/site.webmanifest`      | `application/manifest+json` |
 * | MS browserconfig | `sites/{slug}/assets/browserconfig.xml`     | `application/xml`        |
 * | Favicon ICO      | `sites/{slug}/assets/favicon.ico`           | `image/x-icon`           |
 *
 * ## Failure model
 *
 * DALL-E calls are best-effort. Missing `OPENAI_API_KEY`, HTTP errors,
 * timeouts, and malformed responses ALL surface as `null` — never a thrown
 * exception. This keeps the upstream workflow forgiving: a partial image
 * set is preferable to a fully-failed build, and the validator step
 * (`build_validators.ts`) catches any missing-asset gaps later.
 *
 * ## Cost
 *
 * DALL-E 3 standard quality: ~$0.04 per 1024×1024 image, ~$0.08 per
 * 1792×1024. `MAX_GENERATED_IMAGES` env var caps the per-build spend
 * (defaults to 5 → ~$0.40/build worst case for sections, plus logo).
 *
 * @example
 * ```ts
 * const logo = await generateLogo(env, slug, 'Acme Coffee', 'cafe', {
 *   primary_color: '#3b2317', accent_color: '#d4a574', font_heading: 'Playfair Display',
 * });
 * if (logo) {
 *   const r2Logo = await env.SITES_BUCKET.get(logo.key);
 *   const favicons = await generateFaviconSet(env, slug, await r2Logo!.arrayBuffer());
 * }
 * ```
 *
 * @see {@link module:services/ai_workflows}
 * @see {@link module:services/image_discovery}
 * @see {@link module:services/build_validators}
 */

import type { Env } from '../types/env.js';

interface GeneratedImage {
  key: string;
  name: string;
  size: number;
  type: string;
  confidence: number;
  source: 'generated' | 'uploaded' | 'discovered';
}

/**
 * Call OpenAI DALL-E 3 to generate an image and fetch its PNG bytes.
 *
 * @param env - Worker bindings; `env.OPENAI_API_KEY` gates the call.
 * @param prompt - DALL-E 3 prompt (free-form English; ≤4000 chars per
 *   OpenAI limits). Caller is responsible for prompt quality — this
 *   helper passes it through verbatim.
 * @param size - One of DALL-E 3's three supported aspect ratios:
 *   `'1024x1024'` (square, default), `'1792x1024'` (landscape — hero),
 *   `'1024x1792'` (portrait — phone splash). Other sizes rejected by
 *   the API.
 * @returns PNG bytes as ArrayBuffer on success; `null` on any failure
 *   (missing key, non-2xx response, malformed JSON, image-download
 *   failure). Never throws.
 *
 * @remarks
 * Side effects: 2 outbound HTTPS calls per invocation — `POST` to
 * `api.openai.com/v1/images/generations` (returns a signed URL), then
 * `GET` against that URL to materialize the bytes. Both count against
 * the Worker subrequest budget.
 *
 * Quality is fixed at `'standard'` (cheaper, faster) rather than `'hd'`
 * — the visual-qa subagent re-scores all images and triggers
 * regeneration if quality is insufficient, so paying for HD upfront is
 * waste.
 *
 * @throws Never — all errors logged via `console.warn` and returned as
 *   `null`. Upstream workflow MUST handle the null case.
 */
async function callDallE3(
  env: Env,
  prompt: string,
  size: '1024x1024' | '1792x1024' | '1024x1792' = '1024x1024',
): Promise<ArrayBuffer | null> {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn('[image_generation] OPENAI_API_KEY not set — skipping image generation');
    return null;
  }

  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size,
        response_format: 'url',
        quality: 'standard',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.warn(`[image_generation] DALL-E 3 error: ${res.status} ${err}`);
      return null;
    }

    const data = (await res.json()) as { data: { url: string }[] };
    const imageUrl = data.data?.[0]?.url;
    if (!imageUrl) return null;

    // Fetch the generated image
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;

    return imgRes.arrayBuffer();
  } catch (err) {
    console.warn('[image_generation] DALL-E 3 call failed:', err);
    return null;
  }
}

/**
 * Generate a professional logo for a business using DALL-E 3 and upload it
 * to R2 at `sites/{slug}/assets/logo.png`.
 *
 * @param env - Worker bindings; requires `OPENAI_API_KEY` + `SITES_BUCKET`.
 * @param slug - Site slug (lowercase, hyphenated) — determines R2 key prefix.
 * @param businessName - Display name to embed in the logo prompt.
 * @param businessType - Free-form category ("cafe", "soup kitchen",
 *   "law firm"); shapes the visual style asked of DALL-E.
 * @param brand - Optional brand cues. `primary_color` / `accent_color`
 *   accept any CSS color spelling (DALL-E interprets the string).
 *   `font_heading` nudges the typography style. `personality`
 *   ("warm + dignified", "bold + modern") adjusts tone.
 * @returns Asset descriptor with R2 key, byte size, and confidence (85,
 *   reflecting DALL-E 3's variability on logo typography) on success;
 *   `null` if DALL-E generation failed (delegated to {@link callDallE3}).
 *
 * @remarks
 * Side effects: 1 DALL-E 3 call (~$0.04) + 1 R2 PUT. R2 object carries
 * `customMetadata` `{ source: 'generated', confidence: '85', prompt }`
 * truncated to 200 chars — useful for later debugging without bloating
 * R2 metadata limits.
 *
 * Confidence is hardcoded to 85: DALL-E 3 produces solid logo art but
 * occasionally mis-renders text glyphs. The validator step asks GPT-4o
 * to score the rendered logo and triggers regeneration when score < 7.
 *
 * @throws Never — DALL-E failures swallowed in {@link callDallE3}; R2
 *   errors propagate as rejected promises (caller MUST handle).
 */
export async function generateLogo(
  env: Env,
  slug: string,
  businessName: string,
  businessType: string,
  brand: { primary_color?: string; accent_color?: string; font_heading?: string; personality?: string },
): Promise<GeneratedImage | null> {
  const prompt = [
    `Professional minimalist logo design for "${businessName}", a ${businessType} business.`,
    `The logo should have a clean symbol/icon representing the brand alongside the business name text.`,
    brand.font_heading ? `Use a ${brand.font_heading}-inspired modern font style for the text.` : '',
    brand.primary_color ? `Primary color: ${brand.primary_color}.` : '',
    brand.accent_color ? `Accent color: ${brand.accent_color}.` : '',
    brand.personality ? `Brand personality: ${brand.personality}.` : '',
    `Clean white or transparent background. Modern, trending design suitable for web and print.`,
    `No mockups, no watermarks, just the logo itself centered in the image.`,
  ].filter(Boolean).join(' ');

  const imageData = await callDallE3(env, prompt);
  if (!imageData) return null;

  const key = `sites/${slug}/assets/logo.png`;
  await env.SITES_BUCKET.put(key, imageData, {
    httpMetadata: { contentType: 'image/png' },
    customMetadata: { source: 'generated', confidence: '85', prompt: prompt.substring(0, 200) },
  });

  return {
    key,
    name: 'logo.png',
    size: imageData.byteLength,
    type: 'image/png',
    confidence: 85,
    source: 'generated',
  };
}

/**
 * Generate a section/hero image and upload it to R2 at
 * `sites/{slug}/assets/generated/{safeName}.png`.
 *
 * @param env - Worker bindings; requires `OPENAI_API_KEY` + `SITES_BUCKET`.
 * @param slug - Site slug; determines R2 key prefix.
 * @param imageName - Logical name (e.g. `'hero-coffee-bar'`). Sanitized
 *   to `[a-zA-Z0-9._-]` and truncated to 60 chars before use as a key
 *   component — callers SHOULD pre-sanitize for cleaner R2 keys.
 * @param prompt - DALL-E 3 prompt; caller composes the full creative
 *   brief (this helper does not augment).
 * @param size - DALL-E 3 aspect ratio (default `'1792x1024'` — landscape
 *   suits hero/banner placements). See {@link callDallE3} for options.
 * @returns Asset descriptor with R2 key, byte size, and confidence (75)
 *   on success; `null` on DALL-E failure.
 *
 * @remarks
 * Side effects: 1 DALL-E 3 call (~$0.04–0.08 depending on size) + 1 R2
 * PUT. R2 customMetadata mirrors {@link generateLogo}.
 *
 * Confidence is 75 (lower than logos at 85) because section imagery is
 * more subjective — what reads as a "hero coffee bar" may not match
 * brand aesthetic. Visual-qa rescore + regenerate covers the gap.
 *
 * @throws Never — DALL-E failures swallowed; R2 errors propagate.
 */
export async function generateSectionImage(
  env: Env,
  slug: string,
  imageName: string,
  prompt: string,
  size: '1024x1024' | '1792x1024' | '1024x1792' = '1792x1024',
): Promise<GeneratedImage | null> {
  const imageData = await callDallE3(env, prompt, size);
  if (!imageData) return null;

  const safeName = imageName.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60);
  const key = `sites/${slug}/assets/generated/${safeName}.png`;
  await env.SITES_BUCKET.put(key, imageData, {
    httpMetadata: { contentType: 'image/png' },
    customMetadata: { source: 'generated', confidence: '75', prompt: prompt.substring(0, 200) },
  });

  return {
    key,
    name: `${safeName}.png`,
    size: imageData.byteLength,
    type: 'image/png',
    confidence: 75,
    source: 'generated',
  };
}

/**
 * Generate a minimal favicon set from a source PNG and upload all four
 * artifacts to R2.
 *
 * @param env - Worker bindings; requires `SITES_BUCKET`.
 * @param slug - Site slug; determines R2 key prefix.
 * @param sourcePngBytes - PNG bytes of the source icon (ideally ≥512×512,
 *   square aspect, transparent background). Used at native size — no
 *   resizing happens inside the Worker. Modern browsers downscale on
 *   render, so a single high-resolution source is sufficient.
 * @returns Array of 4 asset descriptors in this order: `icon-512.png`,
 *   `site.webmanifest`, `browserconfig.xml`, `favicon.ico`. Never null —
 *   pure-compute paths can't fail.
 *
 * @remarks
 * Produces a deliberately minimal set — not the full 11-file RFG output
 * required by the BUILD-BREAKING favicon invariant. The container
 * orchestrator MUST run real-favicongenerator (`generate-favicon-set`
 * step) to produce the complete favicon kit; this helper exists as a
 * cheap fallback when RFG is unavailable.
 *
 * Side effects: 4 R2 PUTs (icon-512.png, site.webmanifest,
 * browserconfig.xml, favicon.ico).
 *
 * The webmanifest is intentionally generic — `theme_color: '#1a1a2e'`
 * and `background_color: '#0a0a1a'` are dark-default placeholders. The
 * container's branding step overwrites this manifest with extracted
 * brand colors before final upload.
 *
 * @throws Propagates R2 PUT errors. Pure-compute steps (ICO assembly,
 *   manifest/XML synthesis) cannot fail.
 */
export async function generateFaviconSet(
  env: Env,
  slug: string,
  sourcePngBytes: ArrayBuffer,
): Promise<GeneratedImage[]> {
  const results: GeneratedImage[] = [];
  const assetBase = `sites/${slug}/assets`;

  // Store the source as icon-512.png
  const icon512Key = `${assetBase}/icon-512.png`;
  await env.SITES_BUCKET.put(icon512Key, sourcePngBytes, {
    httpMetadata: { contentType: 'image/png' },
  });
  results.push({ key: icon512Key, name: 'icon-512.png', size: sourcePngBytes.byteLength, type: 'image/png', confidence: 95, source: 'generated' });

  // Generate site.webmanifest
  const manifest = JSON.stringify({
    name: slug.replace(/-/g, ' '),
    short_name: slug.replace(/-/g, ' '),
    icons: [
      { src: '/assets/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/assets/icon-512.png', sizes: '192x192', type: 'image/png' },
    ],
    theme_color: '#1a1a2e',
    background_color: '#0a0a1a',
    display: 'standalone',
  }, null, 2);
  const manifestKey = `${assetBase}/site.webmanifest`;
  await env.SITES_BUCKET.put(manifestKey, manifest, {
    httpMetadata: { contentType: 'application/manifest+json' },
  });
  results.push({ key: manifestKey, name: 'site.webmanifest', size: manifest.length, type: 'application/manifest+json', confidence: 100, source: 'generated' });

  // Generate browserconfig.xml
  const browserconfig = `<?xml version="1.0" encoding="utf-8"?>
<browserconfig>
  <msapplication>
    <tile>
      <square150x150logo src="/assets/icon-512.png"/>
      <TileColor>#1a1a2e</TileColor>
    </tile>
  </msapplication>
</browserconfig>`;
  const browserconfigKey = `${assetBase}/browserconfig.xml`;
  await env.SITES_BUCKET.put(browserconfigKey, browserconfig, {
    httpMetadata: { contentType: 'application/xml' },
  });
  results.push({ key: browserconfigKey, name: 'browserconfig.xml', size: browserconfig.length, type: 'application/xml', confidence: 100, source: 'generated' });

  // Generate favicon.ico (PNG-in-ICO wrapper)
  // ICO format: 6-byte header + 16-byte directory entry + PNG data
  const icoKey = `${assetBase}/favicon.ico`;
  const ico = buildPngIco(sourcePngBytes);
  await env.SITES_BUCKET.put(icoKey, ico, {
    httpMetadata: { contentType: 'image/x-icon' },
  });
  results.push({ key: icoKey, name: 'favicon.ico', size: ico.byteLength, type: 'image/x-icon', confidence: 90, source: 'generated' });

  return results;
}

/**
 * Build a minimal ICO container that wraps a single PNG entry.
 *
 * @param pngBytes - Source PNG bytes (any dimensions; modern browsers
 *   read embedded PNG directly regardless of declared ICO size).
 * @returns ICO bytes (6-byte header + 16-byte directory entry +
 *   verbatim PNG payload). Total size = 22 + pngBytes.byteLength.
 *
 * @remarks
 * Pure function — no I/O, no environment dependencies. ICO format
 * follows the spec at https://en.wikipedia.org/wiki/ICO_(file_format).
 * The header declares `width=0, height=0` which the spec interprets as
 * 256+ — modern browsers ignore declared dimensions when the payload
 * is a PNG (vs. a raw DIB), so this works for any reasonable input.
 *
 * @throws Never — pure computation over an ArrayBuffer.
 */
function buildPngIco(pngBytes: ArrayBuffer): ArrayBuffer {
  const png = new Uint8Array(pngBytes);
  const size = png.byteLength;

  // ICO header (6 bytes) + 1 directory entry (16 bytes) + PNG data
  const ico = new ArrayBuffer(6 + 16 + size);
  const view = new DataView(ico);
  const out = new Uint8Array(ico);

  // Header: reserved(0), type(1=icon), count(1)
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);

  // Directory entry
  out[6] = 0;  // width (0 = 256+)
  out[7] = 0;  // height
  out[8] = 0;  // color palette
  out[9] = 0;  // reserved
  view.setUint16(10, 1, true);  // color planes
  view.setUint16(12, 32, true); // bits per pixel
  view.setUint32(14, size, true); // image size
  view.setUint32(18, 22, true);  // offset to image data

  // PNG data
  out.set(png, 22);

  return ico;
}

/**
 * Generate the full set of section images for a website based on the
 * `research_images` step's structured output.
 *
 * @param env - Worker bindings; requires `OPENAI_API_KEY` + `SITES_BUCKET`.
 *   `env.MAX_GENERATED_IMAGES` (parsed as int, default `'5'`) caps the
 *   number of images generated this build — controls per-build DALL-E
 *   spend.
 * @param slug - Site slug; determines R2 key prefix.
 * @param businessName - Display name; appended to every prompt to
 *   anchor DALL-E on brand.
 * @param businessType - Free-form category; same role as `businessName`.
 * @param imageNeeds - Ordered list of `{ concept, prompt }` pairs from
 *   the `research_images` prompt output. `concept` becomes the file
 *   name (sanitized); `prompt` is augmented with brand context before
 *   the DALL-E call.
 * @returns Array of successfully-generated asset descriptors. Length
 *   ≤ `min(imageNeeds.length, maxImages)`. Failed generations are
 *   silently dropped (delegated to {@link generateSectionImage}).
 *
 * @remarks
 * Side effects: up to `maxImages` DALL-E 3 calls (sequential — NOT
 * parallel, to avoid OpenAI rate-limit headaches at high concurrency)
 * + same number of R2 PUTs. Worst-case cost at default cap: 5 ×
 * $0.08 = $0.40/build.
 *
 * Sequential ordering preserves prompt creativity — DALL-E doesn't
 * have cross-request state, but a Worker subrequest-budget overrun on
 * a parallel fan-out would cancel pending images mid-flight.
 *
 * @throws Never — individual image failures swallowed; bucket errors
 *   propagate (caller MUST wrap in try/catch if site can't tolerate
 *   partial R2 writes).
 */
export async function generateWebsiteImages(
  env: Env,
  slug: string,
  businessName: string,
  businessType: string,
  imageNeeds: { concept: string; prompt: string }[],
): Promise<GeneratedImage[]> {
  const maxImages = parseInt(env.MAX_GENERATED_IMAGES || '5', 10);
  const results: GeneratedImage[] = [];

  const toGenerate = imageNeeds.slice(0, maxImages);

  for (const need of toGenerate) {
    const fullPrompt = [
      need.prompt,
      `For "${businessName}", a ${businessType} business.`,
      'Professional quality, high resolution, suitable for a modern website.',
      'No text overlays, no watermarks, photorealistic style.',
    ].join(' ');

    const result = await generateSectionImage(env, slug, need.concept, fullPrompt, '1792x1024');
    if (result) results.push(result);
  }

  return results;
}
