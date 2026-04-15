/**
 * @module routes/assets
 * @description Asset upload and management routes for site creation.
 *
 * Handles file uploads (logo, favicon, images) to R2 before site creation.
 * Also serves build asset listings during the AI generation workflow.
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types/env.js';

const assets = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Upload assets before site creation.
 *
 * Accepts multipart form data with fields:
 * - `logo` (single file, image/*)
 * - `favicon` (single file, image/png)
 * - `images` (multiple files, image/*)
 *
 * Stores to R2 at `uploads/{upload_id}/{filename}`.
 * Returns `upload_id` and asset metadata.
 */
assets.post('/api/assets/upload', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401);
  }

  const uploadId = crypto.randomUUID();
  const formData = await c.req.formData();
  const uploadedAssets: { key: string; name: string; size: number; type: string; url: string }[] = [];

  const allowedTypes = new Set([
    'image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/svg+xml',
    'image/webp', 'image/x-icon', 'image/ico',
  ]);
  const maxFileSize = 10 * 1024 * 1024; // 10MB per file
  const maxFiles = 25;

  const processFile = async (file: File, category: string): Promise<void> => {
    if (uploadedAssets.length >= maxFiles) return;
    if (file.size > maxFileSize) return;
    if (!allowedTypes.has(file.type) && !file.name.match(/\.(png|jpe?g|gif|svg|webp|ico)$/i)) return;

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 100);
    const key = `uploads/${uploadId}/${category}/${safeName}`;

    const arrayBuffer = await file.arrayBuffer();
    await c.env.SITES_BUCKET.put(key, arrayBuffer, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { originalName: file.name, category, uploadId },
    });

    uploadedAssets.push({
      key,
      name: file.name,
      size: file.size,
      type: file.type,
      url: key, // Will be moved to sites/{slug}/assets/ by workflow
    });
  };

  // Process logo
  const logo = formData.get('logo');
  if (logo instanceof File && logo.size > 0) {
    await processFile(logo, 'logo');
  }

  // Process favicon
  const favicon = formData.get('favicon');
  if (favicon instanceof File && favicon.size > 0) {
    await processFile(favicon, 'favicon');
  }

  // Process additional images
  const images = formData.getAll('images');
  for (const img of images) {
    if (img instanceof File && img.size > 0) {
      await processFile(img, 'images');
    }
  }

  return c.json({
    data: {
      upload_id: uploadId,
      assets: uploadedAssets,
    },
  });
});

/**
 * List build assets for a site (generated/discovered/uploaded during workflow).
 */
assets.get('/api/sites/:id/build-assets', async (c) => {
  const orgId = c.get('orgId');
  if (!orgId) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } }, 401);
  }

  const siteId = c.req.param('id');

  // Look up site to get slug
  const site = await c.env.DB.prepare(
    'SELECT slug FROM sites WHERE id = ? AND org_id = ? AND deleted_at IS NULL',
  ).bind(siteId, orgId).first<{ slug: string }>();

  if (!site) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Site not found' } }, 404);
  }

  // List assets from R2
  const prefix = `sites/${site.slug}/assets/`;
  const listed = await c.env.SITES_BUCKET.list({ prefix, limit: 100 });

  const assets = listed.objects
    .filter((obj) => !obj.key.endsWith('/_build-context.json') && !obj.key.endsWith('/_manifest.json'))
    .map((obj) => {
      const name = obj.key.split('/').pop() || obj.key;
      const ext = name.split('.').pop()?.toLowerCase() || '';
      return {
        key: obj.key,
        name,
        type: ext,
        size: obj.size,
        url: `https://${site.slug}.projectsites.dev/assets/${obj.key.replace(prefix, '')}`,
        uploaded: obj.uploaded.toISOString(),
      };
    });

  return c.json({ data: assets });
});

export { assets };
