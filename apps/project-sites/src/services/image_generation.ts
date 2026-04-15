/**
 * @module services/image_generation
 * @description AI image generation using OpenAI DALL-E 3 and favicon set creation.
 *
 * Generates logos, section images, and favicon assets for AI-built websites.
 * All generated images are stored to R2 at `sites/{slug}/assets/`.
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
 * Call OpenAI DALL-E 3 to generate an image.
 *
 * @returns The image as an ArrayBuffer (PNG) or null on failure.
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
 * Generate a professional logo for a business using DALL-E 3.
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
 * Generate a section/hero image for the website.
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
 * Generate a minimal favicon set from a source PNG.
 *
 * Produces:
 * - icon-512.png (original or resized to 512x512)
 * - site.webmanifest (JSON references)
 * - browserconfig.xml (MS tile reference)
 * - favicon.ico (PNG-in-ICO wrapper for 32x32)
 *
 * Uses the source image at all sizes — browsers handle downscaling.
 * If Cloudflare Image Resizing is available, it generates true resized variants.
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
 * Build a minimal ICO file wrapping a PNG image.
 * ICO is just a container — modern browsers read the embedded PNG directly.
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
 * Generate multiple images for a website based on research output.
 *
 * @param imageNeeds - Array of { concept, prompt } from research_images step
 * @param maxImages - Maximum number to generate (default from env or 5)
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
