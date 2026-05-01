/**
 * Build validators — programmatic enforcement of post-build quality gates.
 *
 * @remarks
 * Runs after the container uploads to R2 and before D1 status flips to `published`.
 * Each gate maps 1:1 to a BUILD-BREAKING entry in skill 15 quality-gates.md and the
 * audit recommendations (megabyte-labs + nyfb retro).
 *
 * Modes:
 * - `strict` — any error-severity violation throws → site stays in `error` status
 * - `report` — collect violations, log to D1 audit, never throw
 *
 * @see ~/.agentskills/15-site-generation/quality-gates.md
 * @see ~/.agentskills/06-build-and-slice-loop/web-manifest-system.md
 */

export type Severity = 'error' | 'warn' | 'info';

export interface Violation {
  code: string;
  severity: Severity;
  message: string;
  file?: string;
  detail?: string;
}

export interface BuildFile {
  /** Path relative to dist root, e.g. "index.html", "assets/index-abc.js" */
  path: string;
  /** Decoded text content for HTML/JS/CSS/JSON/XML/SVG/TXT, undefined for binary */
  text?: string;
  /** Byte length of the original file. */
  size: number;
}

export interface ValidationReport {
  ok: boolean;
  errors: Violation[];
  warnings: Violation[];
  infos: Violation[];
  summary: string;
}

const BANNED_WORDS = [
  'limitless',
  'revolutionize',
  'game-changing',
  'cutting-edge',
  'next-generation',
  'world-class',
  'best-in-class',
  'turnkey',
  'synergy',
  'leverage',
  'utilize',
  'seamless',
  'robust',
  'state-of-the-art',
  'paradigm',
  'holistic',
  'spearhead',
  'tapestry',
  'plethora',
  'myriad',
  'supercharge',
];

const ALLOWED_EXTERNAL_HOSTS = new Set([
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

const HTML_EXTENSIONS = ['.html', '.htm'];
const TEXT_EXTENSIONS = [
  '.html', '.htm', '.css', '.js', '.mjs', '.json',
  '.xml', '.txt', '.svg', '.webmanifest',
];

const isHtml = (p: string) => HTML_EXTENSIONS.some(e => p.toLowerCase().endsWith(e));
const isText = (p: string) => TEXT_EXTENSIONS.some(e => p.toLowerCase().endsWith(e));
const isPng = (p: string) => p.toLowerCase().endsWith('.png');
const isFavicon = (p: string) => /favicon|apple-touch-icon|icon-\d+x\d+/i.test(p);
const isOgImage = (p: string) => /og-image|opengraph|social-card/i.test(p);

const stripScripts = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

const matchAll = (html: string, re: RegExp): string[] => {
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
};

const isInternalRef = (ref: string): boolean => {
  if (!ref || ref.startsWith('data:') || ref.startsWith('blob:') || ref.startsWith('#')) return false;
  if (ref.startsWith('mailto:') || ref.startsWith('tel:') || ref.startsWith('javascript:')) return false;
  if (ref.startsWith('//') || ref.match(/^https?:\/\//i)) return false;
  return true;
};

const normalizeRef = (ref: string): string => {
  let p = ref.split('?')[0].split('#')[0];
  if (p.startsWith('./')) p = p.slice(2);
  if (p.startsWith('/')) p = p.slice(1);
  return p;
};

const externalHost = (ref: string): string | null => {
  const m = ref.match(/^https?:\/\/([^/]+)/i);
  return m ? m[1].toLowerCase() : null;
};

const collectRefs = (html: string): string[] => {
  const refs: string[] = [];
  refs.push(...matchAll(html, /<(?:img|source|video|audio|iframe|script|link)[^>]+(?:src|href)=["']([^"']+)["']/gi));
  refs.push(...matchAll(html, /url\(["']?([^"')]+)["']?\)/gi));
  return refs;
};

/** Asset existence — every internal ref MUST have a matching file. */
export const validateAssetExistence = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  const fileSet = new Set(files.map(f => f.path));
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const refs = collectRefs(file.text);
    for (const ref of refs) {
      const host = externalHost(ref);
      if (host) {
        if (!ALLOWED_EXTERNAL_HOSTS.has(host) && !host.endsWith('.projectsites.dev')) {
          out.push({
            code: 'asset.external_host_not_allowed',
            severity: 'warn',
            message: `External host not in allowlist: ${host}`,
            file: file.path,
            detail: ref,
          });
        }
        continue;
      }
      if (!isInternalRef(ref)) continue;
      const norm = normalizeRef(ref);
      if (!norm) continue;
      if (!fileSet.has(norm)) {
        out.push({
          code: 'asset.missing',
          severity: 'error',
          message: `Referenced asset not in build output: /${norm}`,
          file: file.path,
          detail: ref,
        });
      }
    }
  }
  return out;
};

/** Image format vs size — PNG > 200KB must be re-encoded WebP/JPEG. */
export const validateImageFormat = (files: BuildFile[]): Violation[] =>
  files
    .filter(f => isPng(f.path) && !isFavicon(f.path) && f.size > 200 * 1024)
    .map(f => ({
      code: 'image.png_too_large',
      severity: 'error' as Severity,
      message: `PNG > 200KB must be WebP/JPEG: ${f.path} (${Math.round(f.size / 1024)}KB)`,
      file: f.path,
    }));

/** OG image — must exist, ≤100KB, branded card (not raw photo). */
export const validateOgImage = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  const og = files.find(f => isOgImage(f.path));
  if (!og) {
    out.push({
      code: 'og.missing',
      severity: 'error',
      message: 'No og-image found (need 1200×630 branded card)',
    });
    return out;
  }
  if (og.size > 100 * 1024) {
    out.push({
      code: 'og.too_large',
      severity: 'error',
      message: `og-image > 100KB: ${og.path} (${Math.round(og.size / 1024)}KB)`,
      file: og.path,
    });
  }
  return out;
};

/** apple-touch-icon — 180×180 mandatory at root. */
export const validateAppleTouchIcon = (files: BuildFile[]): Violation[] => {
  const has = files.some(f => f.path === 'apple-touch-icon.png');
  return has ? [] : [{
    code: 'icon.apple_touch_missing',
    severity: 'error',
    message: 'apple-touch-icon.png (180×180) required at root',
  }];
};

const titleLength = (html: string): number => {
  const m = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return m ? m[1].trim().length : 0;
};

const metaDescLength = (html: string): number => {
  const m = html.match(/<meta\s+name=["']description["'][^>]*content=["']([^"']*)["']/i);
  return m ? m[1].trim().length : 0;
};

/** Title 50-60, description 120-156. */
export const validateMetaLengths = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const t = titleLength(file.text);
    if (t < 50 || t > 60) {
      out.push({
        code: 'meta.title_length',
        severity: 'error',
        message: `<title> must be 50-60 chars (got ${t})`,
        file: file.path,
      });
    }
    const d = metaDescLength(file.text);
    if (d < 120 || d > 156) {
      out.push({
        code: 'meta.description_length',
        severity: 'error',
        message: `meta description must be 120-156 chars (got ${d})`,
        file: file.path,
      });
    }
  }
  return out;
};

/** JSON-LD — at least 4 blocks per HTML page. */
export const validateJsonLdCount = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const count = (file.text.match(/application\/ld\+json/gi) || []).length;
    if (count < 4) {
      out.push({
        code: 'jsonld.count_below_threshold',
        severity: 'error',
        message: `JSON-LD blocks below 4 (got ${count}). Need WebSite+Organization+WebPage+BreadcrumbList minimum.`,
        file: file.path,
      });
    }
  }
  return out;
};

/** Exactly one <h1> in HTML shell (prerender). */
export const validateH1InShell = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const stripped = stripScripts(file.text);
    const count = (stripped.match(/<h1[\s>]/gi) || []).length;
    if (count !== 1) {
      out.push({
        code: 'html.h1_count',
        severity: 'error',
        message: `Exactly 1 <h1> required in HTML shell (got ${count})`,
        file: file.path,
      });
    }
  }
  return out;
};

/** color-scheme meta required for dark sites. */
export const validateColorScheme = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    if (!/<meta\s+name=["']color-scheme["']/i.test(file.text)) {
      out.push({
        code: 'meta.color_scheme_missing',
        severity: 'warn',
        message: 'Missing <meta name="color-scheme"> (use "dark" or "dark light")',
        file: file.path,
      });
    }
  }
  return out;
};

/** Sitemap — every <url> must have <lastmod>. */
export const validateSitemapLastmod = (files: BuildFile[]): Violation[] => {
  const sitemap = files.find(f => f.path === 'sitemap.xml');
  if (!sitemap?.text) return [{
    code: 'sitemap.missing',
    severity: 'error',
    message: 'sitemap.xml not found in build output',
  }];
  const urlBlocks = sitemap.text.match(/<url>[\s\S]*?<\/url>/g) || [];
  const out: Violation[] = [];
  for (const block of urlBlocks) {
    if (!/<lastmod>/i.test(block)) {
      const loc = block.match(/<loc>([^<]+)<\/loc>/);
      out.push({
        code: 'sitemap.missing_lastmod',
        severity: 'error',
        message: `<url> missing <lastmod>: ${loc ? loc[1] : 'unknown'}`,
        file: 'sitemap.xml',
      });
    }
  }
  return out;
};

/** Banned slop words anywhere in HTML body text. */
export const validateBannedWords = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const stripped = stripScripts(file.text);
    for (const word of BANNED_WORDS) {
      const re = new RegExp(`\\b${word}\\b`, 'gi');
      const matches = stripped.match(re);
      if (matches?.length) {
        out.push({
          code: 'copy.banned_word',
          severity: 'warn',
          message: `Banned slop word "${word}" appears ${matches.length}× — replace with concrete language`,
          file: file.path,
        });
      }
    }
  }
  return out;
};

/** JS code-splitting — no single chunk > 250KB gzipped (we proxy via raw size). */
export const validateJsBundleSize = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!file.path.toLowerCase().endsWith('.js')) continue;
    if (file.size > 750 * 1024) {
      out.push({
        code: 'js.chunk_too_large',
        severity: 'error',
        message: `JS chunk > 750KB raw (~250KB gzipped): ${file.path} (${Math.round(file.size / 1024)}KB)`,
        file: file.path,
      });
    }
  }
  return out;
};

/** Lightbox presence — bundle must contain data-zoomable AND data-gallery markers. */
export const validateLightboxPresence = (files: BuildFile[]): Violation[] => {
  const jsFiles = files.filter(f => f.path.toLowerCase().endsWith('.js') && f.text);
  if (!jsFiles.length) return [];
  const haystack = jsFiles.map(f => f.text || '').join('\n');
  const hasZoomable = haystack.includes('data-zoomable');
  const hasGallery = haystack.includes('data-gallery');
  const out: Violation[] = [];
  if (!hasZoomable) {
    out.push({
      code: 'lightbox.zoomable_missing',
      severity: 'error',
      message: 'No data-zoomable string in JS bundle — lightbox component not shipping',
    });
  }
  if (!hasGallery) {
    out.push({
      code: 'lightbox.gallery_missing',
      severity: 'error',
      message: 'No data-gallery string in JS bundle — gallery wrappers/lightbox missing',
    });
  }
  return out;
};

/** Required well-known files. */
export const validateRequiredFiles = (files: BuildFile[]): Violation[] => {
  const required = [
    'site.webmanifest',
    'robots.txt',
    'humans.txt',
    'sitemap.xml',
    'browserconfig.xml',
    '.well-known/security.txt',
    'favicon.ico',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'apple-touch-icon.png',
  ];
  const set = new Set(files.map(f => f.path));
  return required
    .filter(p => !set.has(p))
    .map(p => ({
      code: 'manifest.required_file_missing',
      severity: 'error' as Severity,
      message: `Required file missing: ${p}`,
    }));
};

/**
 * Fail builds that under-recreate the source sitemap.
 *
 * @remarks
 * Skill 15 mandates 1:N route mapping (max 1000) — never cap a 200-page source at 4–8.
 * `sourceRouteCount` comes from `_scraped_content.json.routes[].length` (priority chain:
 * sitemap.xml → wp-sitemap.xml → robots.txt Sitemap: → Wayback CDX → BFS depth ≤ 6).
 *
 * Floor: thin sources (< 4 routes) skip the check — the 4-page floor handles those.
 * Ceiling: sourceRouteCount > 1000 is clamped to 1000 (sanity cap).
 */
export const validateRouteCount = (
  files: BuildFile[],
  sourceRouteCount: number,
): Violation[] => {
  if (sourceRouteCount < 4) return [];
  const expected = Math.min(sourceRouteCount, 1000);
  const builtRoutes = files.filter(
    f =>
      f.path.endsWith('.html') &&
      !/(^|\/)(404|500|offline)\.html$/i.test(f.path) &&
      !f.path.startsWith('admin/'),
  );
  if (builtRoutes.length >= expected) return [];
  return [
    {
      code: 'route.count_below_source_count',
      severity: 'error' as Severity,
      message: `Built ${builtRoutes.length} HTML route(s); source has ${sourceRouteCount} (expected ≥ ${expected}). Skill 15 requires 1:N source-sitemap mapping up to 1000 — never cap at 4–8 pages.`,
      detail: `built=${builtRoutes.length} expected=${expected} source=${sourceRouteCount}`,
    },
  ];
};

/** Run every gate and return a structured report. */
export const validateBuild = (
  files: BuildFile[],
  opts: { sourceRouteCount?: number } = {},
): ValidationReport => {
  const all: Violation[] = [
    ...validateRequiredFiles(files),
    ...validateAssetExistence(files),
    ...validateImageFormat(files),
    ...validateOgImage(files),
    ...validateAppleTouchIcon(files),
    ...validateMetaLengths(files),
    ...validateJsonLdCount(files),
    ...validateH1InShell(files),
    ...validateColorScheme(files),
    ...validateSitemapLastmod(files),
    ...validateBannedWords(files),
    ...validateJsBundleSize(files),
    ...validateLightboxPresence(files),
    ...(typeof opts.sourceRouteCount === 'number'
      ? validateRouteCount(files, opts.sourceRouteCount)
      : []),
  ];
  const errors = all.filter(v => v.severity === 'error');
  const warnings = all.filter(v => v.severity === 'warn');
  const infos = all.filter(v => v.severity === 'info');
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    infos,
    summary: `${errors.length} error(s), ${warnings.length} warning(s), ${infos.length} info`,
  };
};

/**
 * Read every file under `prefix` from R2 into memory as BuildFile[].
 *
 * @remarks
 * Used by site-generation workflow after the container's HMAC callback confirms upload.
 * Decodes text-ish files (HTML/JS/CSS/JSON/XML/SVG/TXT) with TextDecoder; binary files
 * (PNG/JPG/WebP/etc.) are returned with `text: undefined` and only their byte size.
 */
export const loadBuildFromR2 = async (
  bucket: R2Bucket,
  prefix: string,
): Promise<BuildFile[]> => {
  const files: BuildFile[] = [];
  let cursor: string | undefined;
  const decoder = new TextDecoder();
  do {
    const list = await bucket.list({ prefix, cursor, limit: 1000 });
    cursor = list.truncated ? list.cursor : undefined;
    for (const obj of list.objects) {
      const path = obj.key.startsWith(prefix) ? obj.key.slice(prefix.length).replace(/^\/+/, '') : obj.key;
      const size = obj.size;
      let text: string | undefined;
      if (isText(path) && size < 1.5 * 1024 * 1024) {
        try {
          const got = await bucket.get(obj.key);
          if (got) {
            const buf = await got.arrayBuffer();
            text = decoder.decode(buf);
          }
        } catch {}
      }
      files.push({ path, size, text });
    }
  } while (cursor);
  return files;
};
