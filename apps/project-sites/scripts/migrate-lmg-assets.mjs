#!/usr/bin/env node
/**
 * One-shot migration: self-host external assets for a published site by calling
 * Cloudflare R2 REST API directly (bypasses wrangler-dev preview-bucket issues).
 *
 * Mirrors src/services/asset_migration.ts algorithm exactly. Idempotent.
 *
 * Required env: CLOUDFLARE_API_KEY, CLOUDFLARE_EMAIL, CLOUDFLARE_ACCOUNT_ID
 * Required args: --slug <slug> --version <version> [--bucket project-sites-production]
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
  console.error('usage: migrate-lmg-assets.mjs --slug <slug> --version <ver> [--bucket <bucket>]');
  process.exit(2);
}
if (!CF_KEY || !CF_EMAIL || !ACCT) {
  console.error('missing env: CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL + CLOUDFLARE_ACCOUNT_ID');
  process.exit(2);
}

const PREFIX = `sites/${SLUG}/${VERSION}/`;
const R2_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/r2/buckets/${BUCKET}`;
const AUTH_HEADERS = { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY };

const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FETCH_HEADERS = {
  'User-Agent': REAL_UA,
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Dest': 'image',
};

const ALLOWED_HOSTS = new Set([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'images.unsplash.com',
  'images.pexels.com',
  'res.cloudinary.com',
  'api.mapbox.com',
  'www.google.com',
  'maps.googleapis.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'i.ytimg.com',
  'img.youtube.com',
  'www.youtube.com',
  'player.vimeo.com',
  'www.gstatic.com',
  'projectsites.dev',
]);

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

const URL_PATTERN = /https?:\/\/[^\s"'`<>()\[\]{},;\\]+/g;

const extractExternalUrls = (text) => {
  const m = text.match(URL_PATTERN);
  if (!m) return [];
  return m.map((u) => u.replace(/[.,;:!?)\]}>'"`]+$/, ''));
};

const isAllowed = (url) => {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  if (ALLOWED_HOSTS.has(host)) return true;
  if (host.endsWith('.projectsites.dev') || host === 'projectsites.dev') return true;
  return false;
};

const sha256Hex = (buf) => crypto.createHash('sha256').update(Buffer.from(buf)).digest('hex');

const guessExtFromContentType = (ct) => {
  const base = (ct.split(';')[0] || '').trim().toLowerCase();
  return {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/avif': '.avif',
    'image/gif': '.gif',
    'image/svg+xml': '.svg',
    'image/x-icon': '.ico',
    'image/vnd.microsoft.icon': '.ico',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'application/pdf': '.pdf',
    'font/woff2': '.woff2',
    'application/font-woff2': '.woff2',
    'font/woff': '.woff',
  }[base] || '';
};

const guessExtFromUrl = (u) => {
  try {
    const m = new URL(u).pathname.toLowerCase().match(/\.[a-z0-9]{1,5}$/);
    return m ? m[0] : '';
  } catch {
    return '';
  }
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ─── R2 REST helpers ───

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

// ─── Main ───

(async () => {
  const t0 = Date.now();
  console.warn(JSON.stringify({ stage: 'start', slug: SLUG, version: VERSION, bucket: BUCKET }));

  // Phase 1: list + load text files
  const all = await listAll(PREFIX);
  console.warn(JSON.stringify({ stage: 'listed', total_objects: all.length }));

  const result = {
    scanned_files: all.length,
    text_files_with_urls: 0,
    external_urls_found: 0,
    unique_urls: 0,
    downloaded: 0,
    uploaded: 0,
    rewritten_files: 0,
    skipped_already_migrated: false,
    failed: [],
    url_map: {},
  };

  const textFiles = [];
  for (const obj of all) {
    const key = obj.key;
    const rel = key.startsWith(PREFIX) ? key.slice(PREFIX.length).replace(/^\/+/, '') : key;
    if (!isText(rel)) continue;
    if ((obj.size || 0) > 5 * 1024 * 1024) continue;
    try {
      const buf = await getObject(key);
      textFiles.push({ key, rel, text: buf.toString('utf8') });
    } catch (e) {
      console.warn(JSON.stringify({ stage: 'read_skip', key, err: String(e).slice(0, 200) }));
    }
  }
  console.warn(JSON.stringify({ stage: 'text_loaded', count: textFiles.length }));

  // Phase 2: collect unique external URLs
  const uniqueUrls = new Set();
  for (const tf of textFiles) {
    const urls = extractExternalUrls(tf.text);
    if (!urls.length) continue;
    let hadExternal = false;
    for (const u of urls) {
      if (isAllowed(u)) continue;
      if (u.includes('/assets/migrated/')) continue;
      uniqueUrls.add(u);
      result.external_urls_found++;
      hadExternal = true;
    }
    if (hadExternal) result.text_files_with_urls++;
  }
  result.unique_urls = uniqueUrls.size;
  console.warn(JSON.stringify({ stage: 'urls_extracted', unique: uniqueUrls.size }));

  if (uniqueUrls.size === 0) {
    result.skipped_already_migrated = true;
    console.warn(JSON.stringify({ stage: 'done_no_op', ...result, elapsed_ms: Date.now() - t0 }));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // Phase 3: download + upload to R2
  const urlMap = new Map();
  let idx = 0;
  for (const upstream of uniqueUrls) {
    idx++;
    try {
      const res = await fetch(upstream, { method: 'GET', headers: FETCH_HEADERS, redirect: 'follow' });
      if (!res.ok) {
        result.failed.push({ url: upstream, reason: `http_${res.status}`, status: res.status });
        console.warn(JSON.stringify({ stage: 'fetch_fail', i: idx, url: upstream, status: res.status }));
        continue;
      }
      const ct = res.headers.get('content-type') || 'application/octet-stream';
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0) {
        result.failed.push({ url: upstream, reason: 'empty_body' });
        continue;
      }
      result.downloaded++;

      const hash = sha256Hex(bytes).slice(0, 16);
      const ext = guessExtFromContentType(ct) || guessExtFromUrl(upstream) || '.bin';
      const localRel = `assets/migrated/${hash}${ext}`;
      const localKey = `${PREFIX}${localRel}`;

      await putObject(localKey, bytes, ct);
      result.uploaded++;
      urlMap.set(upstream, `/${localRel}`);
      console.warn(JSON.stringify({ stage: 'migrated', i: idx, bytes: bytes.length, ct, key: localKey }));
    } catch (e) {
      result.failed.push({ url: upstream, reason: `fetch_error: ${String(e).slice(0, 200)}` });
      console.warn(JSON.stringify({ stage: 'fetch_throw', i: idx, url: upstream, err: String(e).slice(0, 200) }));
    }
  }

  result.url_map = Object.fromEntries(urlMap);
  console.warn(JSON.stringify({ stage: 'r2_uploaded', downloaded: result.downloaded, uploaded: result.uploaded, failed: result.failed.length }));

  if (urlMap.size === 0) {
    console.warn(JSON.stringify({ stage: 'done_no_uploads', ...result, elapsed_ms: Date.now() - t0 }));
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  // Phase 4: rewrite text files
  for (const tf of textFiles) {
    let rewritten = tf.text;
    let changed = false;
    for (const [upstream, local] of urlMap) {
      const pattern = new RegExp(escapeRegex(upstream), 'g');
      if (!pattern.test(rewritten)) continue;
      rewritten = rewritten.replace(new RegExp(escapeRegex(upstream), 'g'), local);
      changed = true;
    }
    if (!changed) continue;
    const ext = extOf(tf.rel);
    const ct = CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
    await putObject(tf.key, Buffer.from(rewritten, 'utf8'), ct);
    result.rewritten_files++;
    console.warn(JSON.stringify({ stage: 'rewrote', key: tf.key, before: tf.text.length, after: rewritten.length }));
  }

  console.warn(JSON.stringify({ stage: 'done', elapsed_ms: Date.now() - t0, ...result }));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
