/**
 * Recursive R2 upload script for Angular frontend deployment.
 * Uploads all files from dist/project-sites-frontend/browser/ to R2 marketing/* prefix.
 *
 * Usage: node scripts/deploy-r2.mjs <staging|production>
 */
import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const env = process.argv[2];
if (!env || !['staging', 'production'].includes(env)) {
  console.error('Usage: node scripts/deploy-r2.mjs <staging|production>');
  process.exit(1);
}

const bucket = env === 'staging' ? 'project-sites-staging' : 'project-sites';
const distDir = join(import.meta.dirname, '..', 'dist', 'project-sites-frontend', 'browser');

const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.webmanifest': 'application/manifest+json',
};

function getContentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

function walkDir(dir, base = '') {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relativePath = base ? `${base}/${entry}` : entry;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, relativePath);
    } else {
      const ct = getContentType(entry);
      const r2Key = `${bucket}/marketing/${relativePath}`;
      console.warn(`Uploading: ${relativePath} (${ct})`);
      execSync(
        `npx wrangler r2 object put "${r2Key}" --file "${fullPath}" --content-type "${ct}" --remote`,
        { stdio: 'inherit', cwd: join(import.meta.dirname, '..', '..') }
      );
    }
  }
}

console.warn(`Deploying to ${env} (bucket: ${bucket})...`);
walkDir(distDir);
console.warn('Deploy complete!');
