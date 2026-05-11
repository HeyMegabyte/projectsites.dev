/**
 * @module services/asset_migration
 * @description Self-host external assets discovered in a published R2 build.
 *
 * @remarks
 * Closes the loop on skill 12 BUILD-BREAKING rule
 * "Every migrated source-site asset R2 self-hosting": the orchestrator captures source
 * image metadata but never downloads bytes, and the source host typically blocks
 * cross-origin hotlinking via Referer (Cloudflare hotlink protection). The result is
 * 21/21 broken `<img>` tags on the published site — see incident 2026-05-10 for
 * lonemountainglobal.projectsites.dev (28+ unique `lonemountainglobal.com/wp-content/...`
 * URLs hard-coded into the Vite JS bundle).
 *
 * The function scans every text file in `sites/{slug}/{version}/`, identifies external
 * URLs whose host is NOT in the validator allowlist, fetches each unique URL with a
 * realistic browser UA but **NO Referer header** (the server-side worker has no browser
 * context, so omitting Referer cleanly bypasses hotlink protection without spoofing
 * cookies, IPs, or CF-internal headers), stores the bytes in R2 under
 * `assets/migrated/{hashPrefix}.{ext}`, then rewrites every text file in-place to point
 * at the self-hosted path. Content-type round-trips from upstream `Content-Type` header.
 *
 * Idempotent: a second run yields zero migrations (no external URLs left to rewrite).
 *
 * Designed to be called from two places:
 * 1. `step.do('migrate-external-assets')` in `workflows/site-generation.ts` — runs
 *    automatically on every future build between `finalize-build` and `validate-build`.
 * 2. `POST /api/admin/sites/:slug/migrate-assets` admin endpoint — fixes already-published
 *    builds without burning a $5-15 container rebuild (R2 reads/writes only, ~$0).
 *
 * @see apps/project-sites/CLAUDE.md "Mandatory Site-Generation Invariants"
 * @see src/services/build_validators.ts ALLOWED_EXTERNAL_HOSTS
 * @see ~/.claude/rules/fetch-defaults.md (realistic UA + omit-Referer guidance)
 */

const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FETCH_HEADERS: HeadersInit = {
  'User-Agent': REAL_UA,
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-Mode': 'no-cors',
  'Sec-Fetch-Dest': 'image',
};

/**
 * Mirror of {@link build_validators.ALLOWED_EXTERNAL_HOSTS}. Kept inline (not imported)
 * to avoid a circular dependency — `build_validators` is loaded by every workflow step
 * and shouldn't depend on a service that itself walks R2.
 */
const ALLOWED_EXTERNAL_HOSTS = new Set<string>([
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

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
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

const isText = (path: string): boolean =>
  TEXT_EXTENSIONS.some((ext) => path.toLowerCase().endsWith(ext));

const extOf = (path: string): string => {
  const m = path.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : '';
};

/**
 * Extract every `https?://...` URL from a chunk of text.
 *
 * @remarks
 * Greedy match on protocol + host + path; stops at quote, whitespace, backtick, paren,
 * bracket, brace, comma, semicolon, or backslash. Captures both HTML `src=`/`href=`
 * attributes and arbitrary JS string literals (Vite bundles inline image URLs as
 * `"https://..."` inside the chunk).
 */
const URL_PATTERN = /https?:\/\/[^\s"'`<>()\[\]{},;\\]+/g;

/**
 * Recognized asset file extensions. Used by {@link looksLikeAssetUrl} to confirm
 * a URL points to a downloadable binary, not a page/namespace/link.
 */
const ASSET_EXTENSIONS = new Set<string>([
  '.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.ico', '.bmp', '.tiff',
  '.mp4', '.webm', '.mov', '.m4v', '.ogg', '.ogv', '.mp3', '.wav', '.m4a', '.flac',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.zip', '.tar', '.gz',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.css', '.js', '.mjs', '.map',
]);

/**
 * Path-segment hints that indicate "this URL serves an asset, not a page".
 * Matches anywhere in the URL path: `/wp-content/uploads/2024/03/foo.png`,
 * `/assets/migrated/abc.png`, `/static/media/hero.jpg`, etc.
 */
const ASSET_PATH_HINTS = [
  '/uploads/',
  '/wp-content/',
  '/assets/',
  '/images/',
  '/img/',
  '/media/',
  '/static/',
  '/cdn/',
  '/files/',
  '/photos/',
  '/gallery/',
  '/thumbnails/',
  '/_next/static/',
  '/_assets/',
];

/**
 * True when a URL looks like a downloadable asset (image/font/video/doc/CSS/JS),
 * NOT a page link, XML namespace, or JSON-LD `@context`. Used to filter the
 * raw `URL_PATTERN` matches so we only attempt to migrate genuine assets.
 *
 * @remarks
 * Two-tier check:
 * 1. Path ends with a recognized asset extension (e.g. `.png`, `.woff2`).
 * 2. OR the path contains a well-known asset prefix (`/wp-content/`, `/uploads/`,
 *    `/assets/`, etc.) even when the filename has no extension (CDN URLs sometimes
 *    serve `https://cdn.example.com/files/abc123` with content-type set server-side).
 *
 * Reject (return false):
 * - XML namespaces: `http://www.w3.org/2000/svg`, `http://www.w3.org/1999/xlink`
 * - JSON-LD @context: `https://schema.org`, `https://schema.org/`
 * - Project homepage links: `https://lonemountainglobal.com/about/`
 * - Sitemap namespaces: `http://www.sitemaps.org/schemas/sitemap/0.9`
 * - React error decoder: `https://reactjs.org/docs/error-decoder.html?invariant=...`
 */
/** @internal — exported for unit tests only. */
export const looksLikeAssetUrl = (url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const pathLower = parsed.pathname.toLowerCase();
  const m = pathLower.match(/\.[a-z0-9]{2,5}$/);
  if (m && ASSET_EXTENSIONS.has(m[0])) return true;
  for (const hint of ASSET_PATH_HINTS) {
    if (pathLower.includes(hint)) return true;
  }
  return false;
};

const extractExternalUrls = (text: string): string[] => {
  const matches = text.match(URL_PATTERN);
  if (!matches) return [];
  return matches
    .map((u) => u.replace(/[.,;:!?)\]}>'"`]+$/, ''))
    .filter(looksLikeAssetUrl);
};

const isAllowed = (url: string): boolean => {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true; // malformed URL — skip migration but don't crash
  }
  if (ALLOWED_EXTERNAL_HOSTS.has(host)) return true;
  if (host.endsWith('.projectsites.dev') || host === 'projectsites.dev') return true;
  return false;
};

const sha256Hex = async (input: ArrayBuffer | string): Promise<string> => {
  const data =
    typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const guessExtFromContentType = (ct: string): string => {
  const base = ct.split(';')[0].trim().toLowerCase();
  switch (base) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/avif':
      return '.avif';
    case 'image/gif':
      return '.gif';
    case 'image/svg+xml':
      return '.svg';
    case 'image/x-icon':
    case 'image/vnd.microsoft.icon':
      return '.ico';
    case 'video/mp4':
      return '.mp4';
    case 'video/webm':
      return '.webm';
    case 'application/pdf':
      return '.pdf';
    case 'font/woff2':
    case 'application/font-woff2':
      return '.woff2';
    case 'font/woff':
      return '.woff';
    default:
      return '';
  }
};

const guessExtFromUrl = (url: string): string => {
  try {
    const path = new URL(url).pathname;
    const m = path.toLowerCase().match(/\.[a-z0-9]{1,5}$/);
    return m ? m[0] : '';
  } catch {
    return '';
  }
};

/**
 * Escape a string for use inside a `RegExp`.
 *
 * @remarks
 * Asset URLs frequently contain regex metacharacters (`.`, `?`, `+`, parentheses).
 * Used to build a global replace pattern per discovered URL.
 */
const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Per-failure detail in {@link MigrationResult.failed}. */
export interface MigrationFailure {
  url: string;
  reason: string;
  status?: number;
}

/** Summary returned to the workflow audit log and admin endpoint response. */
export interface MigrationResult {
  scanned_files: number;
  text_files_with_urls: number;
  external_urls_found: number;
  unique_urls: number;
  downloaded: number;
  uploaded: number;
  rewritten_files: number;
  skipped_already_migrated: boolean;
  failed: MigrationFailure[];
  url_map: Record<string, string>;
}

/**
 * Walk the R2 prefix `sites/{slug}/{version}/` for one site, self-host every external
 * asset, and rewrite text files to point at the new local paths.
 *
 * @param bucket - R2 bucket binding (`env.SITES_BUCKET`).
 * @param slug - Site slug, e.g. `lonemountainglobal`.
 * @param version - Build version directory, e.g. `v-1715387940123` (omit trailing slash).
 *
 * @example
 * ```ts
 * const result = await migrateExternalAssets(env.SITES_BUCKET, 'lonemountainglobal', 'v-...');
 * console.warn(JSON.stringify(result));
 * // → { downloaded: 28, uploaded: 28, rewritten_files: 1, failed: [] }
 * ```
 *
 * @throws Never — failures are accumulated in {@link MigrationResult.failed} so a partial
 *   migration still rewrites whatever DID download successfully.
 */
export const migrateExternalAssets = async (
  bucket: R2Bucket,
  slug: string,
  version: string,
): Promise<MigrationResult> => {
  const prefix = `sites/${slug}/${version}/`;
  const result: MigrationResult = {
    scanned_files: 0,
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

  // ── Phase 1: list + load every text file under the prefix ──
  type TextFile = { key: string; relativePath: string; text: string };
  const textFiles: TextFile[] = [];
  let cursor: string | undefined;
  const decoder = new TextDecoder();
  do {
    const list = await bucket.list({ prefix, cursor, limit: 1000 });
    cursor = list.truncated ? list.cursor : undefined;
    for (const obj of list.objects) {
      result.scanned_files++;
      const relativePath = obj.key.startsWith(prefix)
        ? obj.key.slice(prefix.length).replace(/^\/+/, '')
        : obj.key;
      if (!isText(relativePath)) continue;
      if (obj.size > 5 * 1024 * 1024) continue; // skip absurdly large text
      try {
        const got = await bucket.get(obj.key);
        if (!got) continue;
        const buf = await got.arrayBuffer();
        textFiles.push({ key: obj.key, relativePath, text: decoder.decode(buf) });
      } catch {
        // unreadable — skip
      }
    }
  } while (cursor);

  // ── Phase 2: collect unique external URLs across all text files ──
  const uniqueUrls = new Set<string>();
  for (const tf of textFiles) {
    const urls = extractExternalUrls(tf.text);
    if (urls.length === 0) continue;
    let hadExternal = false;
    for (const u of urls) {
      if (isAllowed(u)) continue;
      // Skip self-references that already point at the migrated tree
      if (u.includes('/assets/migrated/')) continue;
      uniqueUrls.add(u);
      result.external_urls_found++;
      hadExternal = true;
    }
    if (hadExternal) result.text_files_with_urls++;
  }
  result.unique_urls = uniqueUrls.size;

  if (uniqueUrls.size === 0) {
    result.skipped_already_migrated = true;
    return result;
  }

  // ── Phase 3: download each unique URL and upload to R2 ──
  const urlMap = new Map<string, string>(); // upstream URL → local /assets/migrated/... path
  for (const upstreamUrl of uniqueUrls) {
    try {
      const res = await fetch(upstreamUrl, {
        method: 'GET',
        headers: FETCH_HEADERS,
        redirect: 'follow',
      });
      if (!res.ok) {
        result.failed.push({ url: upstreamUrl, reason: `http_${res.status}`, status: res.status });
        continue;
      }
      const ct = res.headers.get('content-type') || 'application/octet-stream';
      const bytes = await res.arrayBuffer();
      if (bytes.byteLength === 0) {
        result.failed.push({ url: upstreamUrl, reason: 'empty_body' });
        continue;
      }
      result.downloaded++;

      const hash = (await sha256Hex(bytes)).slice(0, 16);
      const ext = guessExtFromContentType(ct) || guessExtFromUrl(upstreamUrl) || '.bin';
      const localRelative = `assets/migrated/${hash}${ext}`;
      const localKey = `${prefix}${localRelative}`;

      await bucket.put(localKey, bytes, {
        httpMetadata: {
          contentType: ct,
          cacheControl: 'public, max-age=31536000, immutable',
        },
        customMetadata: {
          source_url: upstreamUrl.slice(0, 1024),
          migrated_at: new Date().toISOString(),
          source_slug: slug,
          source_version: version,
        },
      });
      result.uploaded++;
      urlMap.set(upstreamUrl, `/${localRelative}`);
    } catch (err) {
      result.failed.push({
        url: upstreamUrl,
        reason: `fetch_error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  result.url_map = Object.fromEntries(urlMap);

  if (urlMap.size === 0) return result;

  // ── Phase 4: rewrite every text file that references any migrated URL ──
  for (const tf of textFiles) {
    let rewritten = tf.text;
    let changed = false;
    for (const [upstream, local] of urlMap) {
      const pattern = new RegExp(escapeRegex(upstream), 'g');
      if (!pattern.test(rewritten)) continue;
      // RegExp.test advances lastIndex on /g — rebuild for replace
      rewritten = rewritten.replace(new RegExp(escapeRegex(upstream), 'g'), local);
      changed = true;
    }
    if (!changed) continue;

    const ext = extOf(tf.relativePath);
    const contentType = CONTENT_TYPE_BY_EXT[ext] || 'application/octet-stream';
    await bucket.put(tf.key, new TextEncoder().encode(rewritten), {
      httpMetadata: { contentType },
    });
    result.rewritten_files++;
  }

  return result;
};
