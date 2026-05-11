#!/usr/bin/env node
/**
 * Reverse the bogus rewrites from migrate-lmg-assets.mjs.
 *
 * The original URL_PATTERN matched ANY https?: URL, including XML namespaces
 * (xmlns="http://www.w3.org/2000/svg"), JSON-LD @context (https://schema.org),
 * project homepage links (https://photoswipe.com, https://animate.style/), and
 * the sitemap.xml namespace. Those rewrites broke inline SVG icons, structured
 * data, and the sitemap. This script restores them.
 *
 * Real asset URLs (lonemountainglobal.com/wp-content/uploads/*) stay migrated.
 */
import crypto from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, arr) => {
    if (v.startsWith('--')) acc.push([v.slice(2), arr[i + 1]]);
    return acc;
  }, [])
);

const SLUG = args.slug;
const VERSION = args.version;
const BUCKET = args.bucket || 'project-sites-production';
const CF_KEY = process.env.CLOUDFLARE_API_KEY;
const CF_EMAIL = process.env.CLOUDFLARE_EMAIL;
const ACCT = process.env.CLOUDFLARE_ACCOUNT_ID;

if (!SLUG || !VERSION) {
  console.error('usage: restore-non-asset-urls.mjs --slug <slug> --version <ver>');
  process.exit(2);
}
if (!CF_KEY || !CF_EMAIL || !ACCT) {
  console.error('missing env: CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL + CLOUDFLARE_ACCOUNT_ID');
  process.exit(2);
}

const PREFIX = `sites/${SLUG}/${VERSION}/`;
const R2_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/r2/buckets/${BUCKET}`;
const AUTH_HEADERS = { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY };

// URLs that should be RESTORED to their original form (namespaces, project links, page links).
// Maps the wrong "/assets/migrated/..." path back to the original URL.
const BOGUS_REWRITES = {
  '/assets/migrated/220bcb1ca2a00dad.bin': 'https://schema.org',
  '/assets/migrated/eacddea70ee37b7b.bin': 'https://lonemountainglobal.com',
  '/assets/migrated/92d5a9d45b6b8721.html': 'https://reactjs.org/docs/error-decoder.html?invariant=',
  '/assets/migrated/758cd5d0e75d09da.bin': 'http://www.w3.org/1999/xlink',
  '/assets/migrated/444ebf0a8ac33c2f.bin': 'http://www.w3.org/XML/1998/namespace',
  '/assets/migrated/7c5fda4188f3c811.bin': 'http://www.w3.org/2000/svg',
  '/assets/migrated/5edada587ffbb52c.bin': 'http://www.w3.org/1998/Math/MathML',
  '/assets/migrated/e9382e48a51759ba.bin': 'http://www.w3.org/1999/xhtml',
  '/assets/migrated/4f45c9ed07b059af.bin': 'https://photoswipe.com',
  '/assets/migrated/962cc7dd79dc8e7e.bin': 'https://lonemountainglobal.com/about/',
  '/assets/migrated/28a22e83cb3d1a92.bin': 'https://animate.style/',
  '/assets/migrated/3c1e044f823059d5.bin': 'http://opensource.org/licenses/MIT',
  '/assets/migrated/3371753416a24917.9': 'http://www.sitemaps.org/schemas/sitemap/0.9',
};

const TEXT_EXTENSIONS = ['.html', '.htm', '.css', '.js', '.mjs', '.json', '.xml', '.svg', '.txt', '.webmanifest'];
const CONTENT_TYPE_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};
const isText = (p) => TEXT_EXTENSIONS.some((e) => p.toLowerCase().endsWith(e));
const extOf = (p) => {
  const m = p.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
};
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function listAll(prefix) {
  const out = [];
  let cursor = '';
  for (;;) {
    const url = `${R2_BASE}/objects?prefix=${encodeURIComponent(prefix)}&per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(url, { headers: AUTH_HEADERS });
    const j = await res.json();
    if (!j.success) throw new Error(`list failed: ${JSON.stringify(j.errors)}`);
    const objs = Array.isArray(j.result) ? j.result : (j.result?.objects || []);
    out.push(...objs);
    cursor = j.result_info?.cursor || (j.result?.cursor || '');
    if (!cursor) break;
  }
  return out;
}

async function getObject(key) {
  const url = `${R2_BASE}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { headers: AUTH_HEADERS });
  if (!res.ok) throw new Error(`GET ${key} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function putObject(key, body, contentType) {
  const url = `${R2_BASE}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...AUTH_HEADERS, 'Content-Type': contentType || 'application/octet-stream' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PUT ${key} -> ${res.status}: ${txt.slice(0, 200)}`);
  }
}

async function deleteObject(key) {
  const url = `${R2_BASE}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { method: 'DELETE', headers: AUTH_HEADERS });
  if (!res.ok && res.status !== 404) {
    const txt = await res.text().catch(() => '');
    console.warn(JSON.stringify({ stage: 'delete_fail', key, status: res.status, body: txt.slice(0, 200) }));
  }
}

(async () => {
  const t0 = Date.now();
  console.warn(JSON.stringify({ stage: 'start', slug: SLUG, version: VERSION, bogus_count: Object.keys(BOGUS_REWRITES).length }));

  const all = await listAll(PREFIX);
  console.warn(JSON.stringify({ stage: 'listed', total_objects: all.length }));

  const result = {
    scanned_files: 0,
    rewritten_files: 0,
    deleted_bogus_objects: 0,
    replacements_made: 0,
  };

  for (const obj of all) {
    const key = obj.key;
    const rel = key.startsWith(PREFIX) ? key.slice(PREFIX.length).replace(/^\/+/, '') : key;
    if (!isText(rel)) continue;
    if ((obj.size || 0) > 5 * 1024 * 1024) continue;
    result.scanned_files++;

    const buf = await getObject(key);
    let text = buf.toString('utf8');
    const before = text;
    let fileReplacements = 0;
    for (const [migratedPath, originalUrl] of Object.entries(BOGUS_REWRITES)) {
      const re = new RegExp(escapeRegex(migratedPath), 'g');
      const matches = text.match(re);
      if (!matches) continue;
      text = text.replace(re, originalUrl);
      fileReplacements += matches.length;
    }
    if (fileReplacements === 0) continue;
    result.replacements_made += fileReplacements;
    result.rewritten_files++;
    const ext = extOf(rel);
    const ct = CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
    await putObject(key, Buffer.from(text, 'utf8'), ct);
    console.warn(JSON.stringify({ stage: 'rewrote', key, replacements: fileReplacements, before_size: before.length, after_size: text.length }));
  }

  // Delete the bogus migrated objects (e.g. the HTML stored at /assets/migrated/220bcb1ca2a00dad.bin
  // which was scraped from schema.org and serves no purpose).
  for (const migratedPath of Object.keys(BOGUS_REWRITES)) {
    const key = `${PREFIX}${migratedPath.replace(/^\//, '')}`;
    await deleteObject(key);
    result.deleted_bogus_objects++;
    console.warn(JSON.stringify({ stage: 'deleted_bogus', key }));
  }

  console.warn(JSON.stringify({ stage: 'done', elapsed_ms: Date.now() - t0, ...result }));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
