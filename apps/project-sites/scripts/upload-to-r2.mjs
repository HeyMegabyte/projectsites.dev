#!/usr/bin/env node
/**
 * upload-to-r2.mjs — Uploads built site files to Cloudflare R2
 *
 * Runs inside the container after npm run build.
 * Uses CF REST API (no Workers bindings available in container).
 *
 * Required env vars:
 *   CF_API_TOKEN, CF_ACCOUNT_ID, R2_BUCKET_NAME, SITE_SLUG, SITE_VERSION
 *
 * Usage: node /home/cuser/upload-to-r2.mjs [buildDir]
 *   buildDir defaults to current working directory
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, extname, relative } from 'path';

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'project-sites-production';
const SITE_SLUG = process.env.SITE_SLUG;
const SITE_VERSION = process.env.SITE_VERSION || 'v1';

if (!CF_API_TOKEN || !CF_ACCOUNT_ID || !SITE_SLUG) {
  console.warn('[upload] Missing required env vars: CF_API_TOKEN, CF_ACCOUNT_ID, SITE_SLUG');
  process.exit(1);
}

const buildDir = process.argv[2] || process.cwd();
const R2_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_BUCKET_NAME}/objects`;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.xml': 'application/xml',
  '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json',
};

function getMimeType(filePath) {
  return MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function collectFiles(dir, base = '') {
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('_') || entry === 'node_modules' || entry === '.git' || entry === '.claude') continue;
    const fullPath = join(dir, entry);
    const relPath = base ? `${base}/${entry}` : entry;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...collectFiles(fullPath, relPath));
    } else if (stat.isFile() && stat.size > 0 && stat.size < 10_000_000) {
      files.push({ path: fullPath, rel: relPath, size: stat.size });
    }
  }
  return files;
}

async function uploadFile(key, filePath, contentType) {
  const body = readFileSync(filePath);
  const res = await fetch(`${R2_BASE}/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': contentType,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    console.warn(`[upload] Failed ${key}: ${res.status} ${text.slice(0, 200)}`);
    return false;
  }
  return true;
}

async function main() {
  const distDir = join(buildDir, 'dist');
  const hasDistDir = (() => { try { return statSync(distDir).isDirectory(); } catch { return false; } })();

  const isViteProject = hasDistDir;
  const sourceDir = isViteProject ? distDir : buildDir;
  const files = collectFiles(sourceDir);

  console.warn(`[upload] ${files.length} files from ${sourceDir} → R2 sites/${SITE_SLUG}/${SITE_VERSION}/`);

  const manifest = {
    slug: SITE_SLUG,
    current_version: SITE_VERSION,
    is_vite_project: isViteProject,
    building: false,
    uploaded_at: new Date().toISOString(),
    files: [],
  };

  let uploaded = 0;
  let failed = 0;

  // Upload serving files (from dist/ or root)
  for (const file of files) {
    const r2Key = `sites/${SITE_SLUG}/${SITE_VERSION}/${file.rel}`;
    const contentType = getMimeType(file.rel);
    const ok = await uploadFile(r2Key, file.path, contentType);
    if (ok) {
      uploaded++;
      manifest.files.push({ name: file.rel, size: file.size, type: contentType });
    } else {
      failed++;
    }
  }

  // If Vite project, also upload source files for reference
  if (isViteProject) {
    const srcFiles = collectFiles(buildDir).filter(f => !f.rel.startsWith('dist/'));
    for (const file of srcFiles) {
      const r2Key = `sites/${SITE_SLUG}/${SITE_VERSION}/_src/${file.rel}`;
      const contentType = getMimeType(file.rel);
      await uploadFile(r2Key, file.path, contentType);
    }
    console.warn(`[upload] Also uploaded ${srcFiles.length} source files to _src/`);
  }

  // Upload manifest
  const manifestJson = JSON.stringify(manifest, null, 2);
  const manifestKey = `sites/${SITE_SLUG}/${SITE_VERSION}/_manifest.json`;
  await fetch(`${R2_BASE}/${encodeURIComponent(manifestKey)}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: manifestJson,
  });

  console.warn(`[upload] Done: ${uploaded} uploaded, ${failed} failed, manifest at ${manifestKey}`);
  // Write result for container to read
  writeFileSync(join(buildDir, '_upload_result.json'), JSON.stringify({
    success: true,
    uploaded,
    failed,
    fileCount: uploaded,
    version: SITE_VERSION,
    manifest_key: manifestKey,
  }));
}

main().catch(err => {
  console.error('[upload] Fatal:', err.message);
  process.exit(1);
});
