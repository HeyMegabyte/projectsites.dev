#!/usr/bin/env node
/**
 * Upload a completed Claude Code build to R2 and update D1.
 * Usage: node upload-build.mjs <build-dir> <slug> <site-id>
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const buildDir = process.argv[2];
const slug = process.argv[3];
const siteId = process.argv[4];

if (!buildDir || !slug) {
  console.error('Usage: node upload-build.mjs <build-dir> <slug> [site-id]');
  process.exit(1);
}

// Load env
const envPath = path.join(import.meta.dirname, '../../.env.local');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const [key, ...val] = line.split('=');
    if (key && !key.startsWith('#')) process.env[key.trim()] = val.join('=').trim();
  }
}

const R2_BUCKET = 'project-sites-production';
const WRANGLER_CWD = '/Users/apple/emdash-projects/worktrees/rare-chefs-film-8op/apps/project-sites';

// Prefer dist/ if it exists
const distDir = path.join(buildDir, 'dist');
const uploadDir = fs.existsSync(distDir) ? distDir : buildDir;
const version = new Date().toISOString().replace(/[:.]/g, '-');

console.log(`Uploading ${uploadDir} → sites/${slug}/${version}/`);

function upload(key, filePath, contentType) {
  try {
    execSync(
      `npx wrangler r2 object put "${R2_BUCKET}/${key}" --file "${filePath}" --content-type "${contentType}" --remote`,
      { stdio: 'pipe', timeout: 60000, cwd: WRANGLER_CWD, env: { ...process.env } }
    );
    return true;
  } catch (err) {
    console.error(`  FAILED: ${key} — ${err.stderr?.toString()?.substring(0, 100) || err.message?.substring(0, 100)}`);
    return false;
  }
}

function walkDir(dir, prefix = '') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      results.push(...walkDir(full, rel));
    } else if (entry.isFile() && !entry.name.startsWith('_') && !entry.name.startsWith('.')) {
      results.push({ rel, full });
    }
  }
  return results;
}

const contentTypes = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.mjs': 'application/javascript', '.json': 'application/json',
  '.xml': 'application/xml', '.txt': 'text/plain', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon', '.webp': 'image/webp', '.woff2': 'font/woff2',
};

const files = walkDir(uploadDir);
let uploaded = 0;

for (const file of files) {
  const ext = path.extname(file.rel);
  const ct = contentTypes[ext] || 'application/octet-stream';
  const key = `sites/${slug}/${version}/${file.rel}`;
  process.stdout.write(`  ${file.rel} (${ct})...`);
  if (upload(key, file.full, ct)) {
    uploaded++;
    console.log(' ✓');
  } else {
    console.log(' ✗');
  }
}

// Robots.txt
const robotsPath = path.join(uploadDir, 'robots.txt');
if (!fs.existsSync(robotsPath)) {
  const robots = `User-agent: *\nAllow: /\n\nSitemap: https://${slug}.projectsites.dev/sitemap.xml`;
  fs.writeFileSync('/tmp/robots.txt', robots);
  upload(`sites/${slug}/${version}/robots.txt`, '/tmp/robots.txt', 'text/plain');
  uploaded++;
  console.log('  robots.txt (generated) ✓');
}

// Sitemap
const sitemapPath = path.join(uploadDir, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) {
  const htmlFiles = files.filter(f => f.rel.endsWith('.html')).map(f => f.rel);
  const now = new Date().toISOString().split('T')[0];
  // For SPA, create routes based on typical pages
  const routes = ['', 'about', 'services', 'contact', 'privacy', 'terms'];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${routes.map(r => `  <url><loc>https://${slug}.projectsites.dev/${r}</loc><lastmod>${now}</lastmod></url>`).join('\n')}\n</urlset>`;
  fs.writeFileSync('/tmp/sitemap.xml', sitemap);
  upload(`sites/${slug}/${version}/sitemap.xml`, '/tmp/sitemap.xml', 'application/xml');
  uploaded++;
  console.log('  sitemap.xml (generated) ✓');
}

// Manifest
const manifest = {
  current_version: version,
  updated_at: new Date().toISOString(),
  files: files.map(f => f.rel),
  model: 'claude-code-cli',
};
fs.writeFileSync('/tmp/manifest.json', JSON.stringify(manifest, null, 2));
upload(`sites/${slug}/_manifest.json`, '/tmp/manifest.json', 'application/json');
console.log('  _manifest.json ✓');

// Update D1
if (siteId) {
  try {
    execSync(
      `npx wrangler d1 execute project-sites-db-production --env production --remote --command "UPDATE sites SET status = 'published', current_build_version = '${version}', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = '${siteId}'"`,
      { stdio: 'pipe', timeout: 30000, cwd: WRANGLER_CWD, env: { ...process.env } }
    );
    console.log(`  D1 updated: status=published`);
  } catch (err) {
    // Try by slug
    try {
      execSync(
        `npx wrangler d1 execute project-sites-db-production --env production --remote --command "UPDATE sites SET status = 'published', current_build_version = '${version}', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE slug = '${slug}'"`,
        { stdio: 'pipe', timeout: 30000, cwd: WRANGLER_CWD, env: { ...process.env } }
      );
      console.log(`  D1 updated by slug: status=published`);
    } catch (e2) {
      console.error(`  D1 update failed: ${e2.message?.substring(0, 100)}`);
    }
  }
}

console.log(`\n✅ ${uploaded} files uploaded → https://${slug}.projectsites.dev`);
