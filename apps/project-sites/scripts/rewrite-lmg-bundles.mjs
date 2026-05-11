#!/usr/bin/env node
/**
 * Targeted JS+CSS bundle rewrite for LMG.
 *
 * migrate-lmg-assets.mjs left the JS bundle untouched (URL_PATTERN matched
 * everything but rewrites never persisted to the bundle). This script
 * downloads ONLY known-image wp-content/uploads URLs, hashes them, uploads to
 * R2 at /assets/migrated/{hash16}.{ext}, then rewrites the JS bundle in place.
 *
 * Page-level URLs (lonemountainglobal.com root, /about/) are left alone — they
 * are real outbound links, not assets.
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
  console.error('usage: rewrite-lmg-bundles.mjs --slug <slug> --version <ver>');
  process.exit(2);
}
if (!CF_KEY || !CF_EMAIL || !ACCT) {
  console.error('missing env: CLOUDFLARE_API_KEY + CLOUDFLARE_EMAIL + CLOUDFLARE_ACCOUNT_ID');
  process.exit(2);
}

const PREFIX = `sites/${SLUG}/${VERSION}/`;
const R2_BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/r2/buckets/${BUCKET}`;
const AUTH_HEADERS = { 'X-Auth-Email': CF_EMAIL, 'X-Auth-Key': CF_KEY };

const REAL_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SOURCE_HEADERS = {
  'User-Agent': REAL_UA,
  Accept: 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Dest': 'image',
};

const SOURCE_URLS = [
  'https://lonemountainglobal.com/wp-content/uploads/2015/06/bribery-1.png',
  'https://lonemountainglobal.com/wp-content/uploads/2015/06/global-1.png',
  'https://lonemountainglobal.com/wp-content/uploads/2015/06/improvement-1.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/03/7431-1920x1280.jpg',
  'https://lonemountainglobal.com/wp-content/uploads/2024/03/logo-text-color-dark.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/03/logo-text-color.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/03/mountain-background-splash-1024x425.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/03/mountain-background-splash-1536x638.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/03/mountain-background-splash-768x319.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/03/mountain-background-splash.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/IMG_1497-1024x768.jpg',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/IMG_1497-1920x1440.jpg',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/IMG_1615-1024x768.jpg',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/IMG_1615-1920x1440.jpg',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/IMG_1721.jpg',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/IMG_4131-560x420.jpg',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/IMG_4131.jpg',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/logo-cipe-e1712029973280.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/logo-council-of-europe-e1712031489763.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/logo-oecd-e1712031136677.jpg',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/logo-transparency-int-e1712031311473.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/logo-u4-1.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/logo-un-e1712030242776.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/logo-usaid-e1712030256513.jpg',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/logo-who-e1712030268984.png',
  'https://lonemountainglobal.com/wp-content/uploads/2024/04/logo-world-bank-e1712030986682.jpg',
];

const BUNDLES = ['assets/index-Cw2cq1Z9.js', 'assets/index-irImpZRH.css'];

const CONTENT_TYPE_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
const extOf = (p) => { const m = p.toLowerCase().match(/\.[a-z0-9]+$/); return m ? m[0] : '.bin'; };
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function r2Get(key) {
  const url = `${R2_BASE}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { headers: AUTH_HEADERS });
  if (!res.ok) throw new Error(`R2 GET ${key} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function r2Put(key, body, contentType) {
  const url = `${R2_BASE}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...AUTH_HEADERS, 'Content-Type': contentType || 'application/octet-stream' },
    body,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`R2 PUT ${key} -> ${res.status}: ${txt.slice(0, 200)}`);
  }
}

async function r2Head(key) {
  const url = `${R2_BASE}/objects/${key.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { method: 'HEAD', headers: AUTH_HEADERS });
  return res.ok;
}

async function downloadSource(url) {
  const res = await fetch(url, { headers: SOURCE_HEADERS, redirect: 'follow' });
  if (!res.ok) throw new Error(`source ${url} -> ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

(async () => {
  const t0 = Date.now();
  console.warn(JSON.stringify({ stage: 'start', slug: SLUG, version: VERSION, source_urls: SOURCE_URLS.length, bundles: BUNDLES.length }));

  const urlMap = {};
  const stats = { downloaded: 0, reused: 0, failed: [] };

  for (const src of SOURCE_URLS) {
    try {
      const ext = extOf(new URL(src).pathname);
      const buf = await downloadSource(src);
      const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
      const r2Path = `assets/migrated/${hash}${ext}`;
      const r2Key = `${PREFIX}${r2Path}`;
      const exists = await r2Head(r2Key);
      if (!exists) {
        await r2Put(r2Key, buf, CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream');
        stats.downloaded++;
      } else {
        stats.reused++;
      }
      urlMap[src] = `/${r2Path}`;
      console.warn(JSON.stringify({ stage: 'mapped', src, dst: `/${r2Path}`, bytes: buf.length, reused: exists }));
    } catch (e) {
      stats.failed.push({ src, error: String(e.message || e) });
      console.warn(JSON.stringify({ stage: 'failed', src, error: String(e.message || e) }));
    }
  }

  // Sort URLs by length desc so longer URLs replace first (avoids partial-match conflicts).
  const sortedSrcs = Object.keys(urlMap).sort((a, b) => b.length - a.length);

  const bundleResults = {};
  for (const bundle of BUNDLES) {
    const key = `${PREFIX}${bundle}`;
    const buf = await r2Get(key);
    let text = buf.toString('utf8');
    const beforeSize = text.length;
    let replacements = 0;
    for (const src of sortedSrcs) {
      const dst = urlMap[src];
      const re = new RegExp(escapeRegex(src), 'g');
      const m = text.match(re);
      if (!m) continue;
      text = text.replace(re, dst);
      replacements += m.length;
    }
    if (replacements > 0) {
      const ext = extOf(bundle);
      const ct = CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
      await r2Put(key, Buffer.from(text, 'utf8'), ct);
    }
    bundleResults[bundle] = { before: beforeSize, after: text.length, replacements };
    console.warn(JSON.stringify({ stage: 'bundle_rewritten', bundle, ...bundleResults[bundle] }));
  }

  console.warn(JSON.stringify({ stage: 'done', elapsed_ms: Date.now() - t0, ...stats, bundles: bundleResults }));
  process.stdout.write(JSON.stringify({ urlMap, stats, bundles: bundleResults }, null, 2) + '\n');
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
