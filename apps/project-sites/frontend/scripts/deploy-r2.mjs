#!/usr/bin/env node
/**
 * Deploys the Angular production build to Cloudflare R2.
 * Usage: node scripts/deploy-r2.mjs [staging|production]
 * Requires CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL env vars.
 */
import { execSync } from 'child_process';
import { readdirSync, statSync } from 'fs';
import { join, extname, relative } from 'path';

const env = process.argv[2] || 'production';
const BUCKET = env === 'staging' ? 'project-sites-staging' : 'project-sites-production';
const DIST = join(import.meta.dirname, '..', 'dist', 'project-sites-frontend', 'browser');

const MIME = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
};

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(full));
    } else {
      files.push(full);
    }
  }
  return files;
}

const files = walk(DIST);
console.warn(`Deploying ${files.length} files to R2 bucket: ${BUCKET}`);

let uploaded = 0;
for (const file of files) {
  const rel = relative(DIST, file);
  const key = `marketing/${rel}`;
  const ext = extname(file);
  const ct = MIME[ext] || 'application/octet-stream';

  try {
    execSync(
      `npx wrangler r2 object put "${BUCKET}/${key}" --file "${file}" --content-type "${ct}" --remote`,
      { stdio: 'pipe' }
    );
    uploaded++;
    process.stderr.write(`  [${uploaded}/${files.length}] ${key}\n`);
  } catch (err) {
    console.error(`  FAILED: ${key} - ${err.message}`);
  }
}

console.warn(`\nDone: ${uploaded}/${files.length} files uploaded to ${BUCKET}`);
