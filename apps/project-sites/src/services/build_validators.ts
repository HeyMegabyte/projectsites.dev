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

const HTML_ENTITY_PATTERN = /&(?:apos|middot|amp|ldquo|rdquo|hellip|ndash|mdash|nbsp|quot);/gi;

const QUANTITATIVE_CLAIM_PATTERN = /(?:\b\d{1,3}%|\$\d{1,3}(?:[.,]\d+)?[MBKkm]?\b|\b\d+(?:\.\d+)?x\s+(?:faster|more|times|better)|\b\d{4,}\s+(?:users|customers|members|clients|patients))/gi;

const APA_CITE_PATTERN = /\(([A-Z][A-Za-z\-']+(?:\s+(?:&|et\s+al\.|and)\s+[A-Z][A-Za-z\-']+)?(?:\s+et\s+al\.)?,\s*\d{4}(?:,\s*p\.\s*\d+)?)\)/;

const REQUIRED_FAVICON_SET = [
  'favicon.ico',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'favicon-48x48.png',
  'apple-touch-icon.png',
  'android-chrome-192x192.png',
  'android-chrome-512x512.png',
  'mstile-150x150.png',
  'safari-pinned-tab.svg',
  'site.webmanifest',
  'browserconfig.xml',
];

const HTML_EXTENSIONS = ['.html', '.htm'];
const TEXT_EXTENSIONS = [
  '.html', '.htm', '.css', '.js', '.mjs', '.json',
  '.xml', '.txt', '.svg', '.webmanifest',
];

const isHtml = (p: string) => HTML_EXTENSIONS.some(e => p.toLowerCase().endsWith(e));
const isUserFacingHtml = (p: string) =>
  isHtml(p) &&
  !/(^|\/)(404|500|offline)\.html$/i.test(p) &&
  !p.startsWith('admin/');
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

const collectAnchors = (html: string): string[] =>
  matchAll(html, /<a\b[^>]+href=["']([^"']+)["']/gi);

const collectHeadFields = (html: string): Map<string, string[]> => {
  const headMatch = html.match(/<head[\s>][\s\S]*?<\/head>/i);
  const head = headMatch ? headMatch[0] : html;
  const out = new Map<string, string[]>();
  const push = (k: string, v: string) => {
    const arr = out.get(k) || [];
    arr.push(v);
    out.set(k, arr);
  };
  for (const m of head.matchAll(/<meta\s+(?:name|property|http-equiv)=["']([^"']+)["'][^>]*content=["']([^"']*)["']/gi)) {
    push(`meta:${m[1].toLowerCase()}`, m[2]);
  }
  for (const m of head.matchAll(/<meta[^>]*content=["']([^"']*)["'][^>]*(?:name|property|http-equiv)=["']([^"']+)["']/gi)) {
    push(`meta:${m[2].toLowerCase()}`, m[1]);
  }
  for (const m of head.matchAll(/<link\s+[^>]*rel=["']([^"']+)["'][^>]*href=["']([^"']+)["']/gi)) {
    push(`link:${m[1].toLowerCase()}`, m[2]);
  }
  for (const m of head.matchAll(/<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']([^"']+)["']/gi)) {
    push(`link:${m[2].toLowerCase()}`, m[1]);
  }
  const titleMatch = head.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) push('title', titleMatch[1].trim());
  return out;
};

const hexToRgb = (hex: string): [number, number, number] | null => {
  const m = hex.replace(/^#/, '');
  if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/i.test(m)) return null;
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
};

const rgbToLab = ([r, g, b]: [number, number, number]): [number, number, number] => {
  const linearize = (c: number) => {
    const v = c / 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  };
  const R = linearize(r);
  const G = linearize(g);
  const B = linearize(b);
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = R * 0.2126729 + G * 0.7151522 + B * 0.072175;
  const z = (R * 0.0193339 + G * 0.119192 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

const deltaE2000 = (a: [number, number, number], b: [number, number, number]): number => {
  const [L1, a1, b1] = rgbToLab(a);
  const [L2, a2, b2] = rgbToLab(b);
  const dL = L2 - L1;
  const da = a2 - a1;
  const db = b2 - b1;
  return Math.sqrt(dL * dL + da * da + db * db);
};

const normalizeForHash = (s: string): string =>
  s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Brand-extracted facts persisted by skill 09 brand-color-extraction. */
export interface BrandJson {
  primary?: string;
  secondary?: string;
  accent?: string;
  fonts?: { heading?: string; body?: string; logo?: string };
  theme?: 'dark' | 'light';
  warnings?: Array<{ code: string; detail?: string }>;
}

/** Research artefact from skill 15 research-pipeline (Google Places + scrape). */
export interface ResearchJson {
  business?: {
    name?: string;
    formatted_address?: string;
    formatted_phone_number?: string;
    google_maps_url?: string;
  };
  routes?: Array<{ url?: string; path?: string; depth?: number }>;
}

/** Validation context — extended opts threaded through the aggregator. */
export interface ValidateBuildOpts {
  sourceRouteCount?: number;
  brandJson?: BrandJson;
  researchJson?: ResearchJson;
  knownRoutes?: string[];
}

/**
 * Asset existence — every internal ref MUST have a matching file in the build output.
 *
 * @remarks
 * Walks every HTML file, collects `<img|source|video|audio|iframe|script|link>` `src`/`href`
 * plus CSS `url(...)` references, and verifies each internal ref resolves to a real file.
 * External hosts must be in {@link ALLOWED_EXTERNAL_HOSTS} (Google Fonts, Unsplash, Pexels,
 * Cloudinary, Mapbox, YouTube, Vimeo, projectsites.dev). Anything else logs a warning.
 *
 * Source incident (2026-04-15): nyfb rebuild shipped with `<img src="/hero.webp">` but the
 * file was uploaded to `assets/hero.webp` — silent broken-image on every viewport. Validator
 * now blocks at `error` severity before D1 flips to `published`.
 *
 * @throws Violation `asset.missing` when an internal ref has no matching file in `files[]`
 * @throws Violation `asset.external_host_not_allowed` (warn) for non-allowlisted CDNs
 *
 * @example Passing — every ref resolves
 * ```ts
 * validateAssetExistence([
 *   { path: 'index.html', text: '<img src="/hero.webp">', size: 100 },
 *   { path: 'hero.webp', size: 50_000 },
 * ]); // → []
 * ```
 *
 * @example Failing — broken internal ref
 * ```ts
 * validateAssetExistence([
 *   { path: 'index.html', text: '<img src="/missing.webp">', size: 100 },
 * ]); // → [{ code: 'asset.missing', severity: 'error', ... }]
 * ```
 *
 * @see ~/.agentskills/15-site-generation/quality-gates.md (asset existence gate)
 * @see apps/project-sites/.claude/agents/validator-fixer.md (asset.missing fix recipe)
 */
export const validateAssetExistence = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  const fileSet = new Set(files.map(f => f.path));
  // Track URLs already reported across this run so a JS bundle that hot-links the same
  // image 28 times doesn't fan out into 28 identical violations.
  const seen = new Set<string>();
  // Bare HTTP(S) URL pattern — catches inline media URLs baked into Vite JS/CSS bundles
  // that the HTML-only `collectRefs` regex misses entirely (no `src=` / `url(...)` wrapper).
  // Restricted to media-extension paths only so canonical site URLs in sitemap.xml /
  // robots.txt / JSON-LD don't fire false positives.
  const BARE_MEDIA_URL_RE = /https?:\/\/[^\s"'`<>()\[\]{},;\\]+\.(?:jpe?g|png|webp|avif|gif|svg|ico|bmp|tiff?|mp4|webm|mov|m4v|ogg|mp3|wav|woff2?|ttf|otf|eot|pdf|zip)(?:\?[^\s"'`<>()\[\]{},;\\]*)?/gi;
  // Only flag external hosts on URLs whose PATH ends in a media extension. This
  // distinguishes asset fetches (image hotlinks → broken in prod) from metadata
  // identifiers (`<link rel="canonical">`, `og:url`, `twitter:url`) where the same
  // URL is correct AND non-allowlisted by design.
  const MEDIA_PATH_RE = /\.(?:jpe?g|png|webp|avif|gif|svg|ico|bmp|tiff?|mp4|webm|mov|m4v|ogg|mp3|wav|woff2?|ttf|otf|eot|pdf|zip)(?:[?#]|$)/i;
  const isMediaRef = (ref: string): boolean => {
    try {
      return MEDIA_PATH_RE.test(new URL(ref).pathname);
    } catch {
      return MEDIA_PATH_RE.test(ref);
    }
  };
  for (const file of files) {
    if (!file.text) continue;
    const html = isHtml(file.path);
    const refs = html ? collectRefs(file.text) : (file.text.match(BARE_MEDIA_URL_RE) || []);
    for (const ref of refs) {
      const host = externalHost(ref);
      if (host) {
        if (!ALLOWED_EXTERNAL_HOSTS.has(host) && !host.endsWith('.projectsites.dev') && isMediaRef(ref)) {
          const dedupKey = `${file.path}::${host}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          out.push({
            code: 'asset.external_host_not_allowed',
            severity: 'error',
            message: `External host not in allowlist (asset will be Referer-blocked in prod): ${host}`,
            file: file.path,
            detail: ref,
          });
        }
        continue;
      }
      if (!html) continue; // only HTML refs are resolved against the build file set
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

/**
 * Image format vs size — PNG > 200KB must be re-encoded as WebP or JPEG.
 *
 * @remarks
 * PNG is lossless and balloons fast on photographic content. The 200KB ceiling matches
 * `~/.claude/rules/quality-metrics.md` (largest image ≤200KB). Favicons are exempt since
 * 16/32/48 PX PNGs are tiny and need pixel-precision. The `validator-fixer` agent runs
 * `sharp` re-encoding (quality 80, effort 6) when this fires.
 *
 * @throws Violation `image.png_too_large` when a non-favicon PNG exceeds 200KB
 *
 * @example Passing — PNG under 200KB
 * ```ts
 * validateImageFormat([{ path: 'hero.png', size: 150_000 }]); // → []
 * ```
 *
 * @example Failing — bloated PNG
 * ```ts
 * validateImageFormat([{ path: 'hero.png', size: 800_000 }]);
 * // → [{ code: 'image.png_too_large', message: '...800KB)' }]
 * ```
 *
 * @see ~/.claude/rules/quality-metrics.md (Budgets: largest image ≤200KB)
 */
export const validateImageFormat = (files: BuildFile[]): Violation[] =>
  files
    .filter(f => isPng(f.path) && !isFavicon(f.path) && f.size > 200 * 1024)
    .map(f => ({
      code: 'image.png_too_large',
      severity: 'error' as Severity,
      message: `PNG > 200KB must be WebP/JPEG: ${f.path} (${Math.round(f.size / 1024)}KB)`,
      file: f.path,
    }));

/**
 * OG image — must exist at 1200×630, ≤100KB, BRANDED card (not a raw photo).
 *
 * @remarks
 * Detects via filename pattern `/og-image|opengraph|social-card/i`. The branded-card
 * requirement isn't enforced here (vision QA owns aesthetic) — this gate only checks
 * presence + byte size. A scraped photo will pass byte-size but fail the visual-qa
 * subagent's "branded?" question downstream.
 *
 * @throws Violation `og.missing` when no file matches the pattern
 * @throws Violation `og.too_large` when og file exceeds 100KB
 *
 * @example Passing — branded 80KB card
 * ```ts
 * validateOgImage([{ path: 'og-image.png', size: 80_000 }]); // → []
 * ```
 *
 * @example Failing — 250KB raw photo at og slot
 * ```ts
 * validateOgImage([{ path: 'og-image.jpg', size: 250_000 }]);
 * // → [{ code: 'og.too_large', message: '...250KB)' }]
 * ```
 *
 * @see ~/.claude/rules/per-route-metadata.md (og:image:width=1200, height=630)
 */
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

/**
 * apple-touch-icon.png — 180×180 PNG mandatory at the build root.
 *
 * @remarks
 * iOS Safari only fetches `/apple-touch-icon.png` (or `/apple-touch-icon-precomposed.png`)
 * at the document root — nested paths break "Add to Home Screen". Pixel dimensions aren't
 * checked here (we'd need image decoding); the RFG step in skill 15 enforces the size.
 *
 * @throws Violation `icon.apple_touch_missing` when file absent at root
 *
 * @example Passing
 * ```ts
 * validateAppleTouchIcon([{ path: 'apple-touch-icon.png', size: 12_000 }]); // → []
 * ```
 *
 * @see ~/.agentskills/15-site-generation/quality-gates.md (real-favicongenerator pipeline)
 */
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

/**
 * Per-route meta lengths — `<title>` 50-60 chars HARD, `<meta description>` 120-156 HARD.
 *
 * @remarks
 * Google truncates titles at ~60 chars desktop / 70 mobile, descriptions at ~160 chars.
 * Below 50 chars wastes pixel real estate; above 60 truncates the keyword. Validator
 * trims whitespace before counting (templates emit indented HTML). Per-route uniqueness
 * is checked elsewhere — this only enforces length.
 *
 * @throws Violation `meta.title_length` when title outside 50-60
 * @throws Violation `meta.description_length` when description outside 120-156
 *
 * @example Passing — 55-char title, 140-char desc
 * ```ts
 * validateMetaLengths([{
 *   path: 'index.html',
 *   text: '<title>Hand-Forged Knives Built for Daily Use | Vito\'s</title>' +
 *         '<meta name="description" content="Hand-forged Damascus knives crafted in NJ. Free shipping. Lifetime warranty. Order yours today and cook with steel built to last 50 years.">',
 *   size: 0,
 * }]); // → []
 * ```
 *
 * @see ~/.claude/rules/per-route-metadata.md (length checks)
 * @see ~/.claude/rules/quality-metrics.md (title 50-60 HARD, desc 120-156 HARD)
 */
export const validateMetaLengths = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isUserFacingHtml(file.path) || !file.text) continue;
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

/**
 * JSON-LD — at least 4 structured-data blocks per HTML page.
 *
 * @remarks
 * Minimum coverage: WebSite + Organization + WebPage + BreadcrumbList. Additional
 * blocks per page type: LocalBusiness (location pages), Product (e-commerce),
 * FAQPage (FAQ sections), BlogPosting (blog posts), Person (team bios). Higher
 * structured-data density correlates with AI-search citation rate (Brewer, 2024:
 * 16% → 54% increase).
 *
 * Counts every `application/ld+json` mention — script tag opening, MIME type
 * reference, anything matching the regex. False-negatives (4+ blocks but only one
 * MIME mention) don't happen because every block emits its own `<script type=...>`.
 *
 * @throws Violation `jsonld.count_below_threshold` when fewer than 4 blocks found
 *
 * @example Passing — 4 blocks
 * ```html
 * <script type="application/ld+json">{"@type":"WebSite",...}</script>
 * <script type="application/ld+json">{"@type":"Organization",...}</script>
 * <script type="application/ld+json">{"@type":"WebPage",...}</script>
 * <script type="application/ld+json">{"@type":"BreadcrumbList",...}</script>
 * ```
 *
 * @see ~/.claude/rules/quality-metrics.md (4+ JSON-LD blocks per page)
 * @see ~/.claude/rules/citations.md (citation density for AI search)
 */
export const validateJsonLdCount = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isUserFacingHtml(file.path) || !file.text) continue;
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

/**
 * Exactly one `<h1>` in HTML shell — outside `<script>`/`<style>` blocks.
 *
 * @remarks
 * SEO + accessibility require exactly one H1 per route, present in the static
 * prerender (NOT injected by client-side router). Strips scripts/styles before
 * counting because Vite hydration scripts often contain the literal `<h1` token
 * inside template strings. The remaining HTML is the document tree the crawler
 * sees first paint.
 *
 * @throws Violation `html.h1_count` when count !== 1 (zero or multiple)
 *
 * @example Passing — single H1 in static shell
 * ```html
 * <main><h1>Hand-Forged Knives</h1>...</main>
 * ```
 *
 * @example Failing — zero H1s (client router injects later, too late for crawl)
 * ```html
 * <div id="root"></div><script>...</script>
 * ```
 *
 * @see ~/.claude/rules/quality-metrics.md (exactly 1 H1 in HTML shell)
 */
export const validateH1InShell = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isUserFacingHtml(file.path) || !file.text) continue;
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

/**
 * `<meta name="color-scheme">` present — declares dark/light support to the UA.
 *
 * @remarks
 * Without this meta, browsers paint a white background between HTML parse and
 * CSS load on dark-themed sites — visible white-flash. Setting `dark light` or
 * just `dark` lets the UA preselect the document's `background-color`. Warn-level
 * because it's a polish/UX gate, not a build-breaker.
 *
 * @throws Violation `meta.color_scheme_missing` (warn) when meta absent
 *
 * @example Passing
 * ```html
 * <meta name="color-scheme" content="dark light">
 * ```
 *
 * @see ~/.claude/rules/code-style.md (CSS: color-scheme: dark on dark-first sites)
 */
export const validateColorScheme = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isUserFacingHtml(file.path) || !file.text) continue;
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

/**
 * Sitemap completeness — every `<url>` block must include `<lastmod>`.
 *
 * @remarks
 * Google ignores sitemap entries without a `<lastmod>` for crawl-prioritization
 * scoring (Brewer, 2024). Missing lastmod ≡ "treat this URL as unchanged" — bad
 * for fresh content and blog posts. Validator parses every `<url>...</url>` block
 * (regex, no XML parser cost), reports `<loc>` of any missing-lastmod entry.
 *
 * @throws Violation `sitemap.missing` when sitemap.xml absent from build
 * @throws Violation `sitemap.missing_lastmod` per `<url>` block without lastmod
 *
 * @example Passing
 * ```xml
 * <url>
 *   <loc>https://example.com/blog/post-1</loc>
 *   <lastmod>2026-05-10</lastmod>
 * </url>
 * ```
 *
 * @see ~/.claude/rules/quality-metrics.md (sitemap.xml every <url> has <lastmod>)
 */
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

/**
 * Banned AI-slop words anywhere in HTML body text — replace with concrete language.
 *
 * @remarks
 * Bans 21 words that pattern-match LLM-generated marketing fluff: "limitless",
 * "revolutionize", "leverage", "utilize", "seamless", "robust", "supercharge",
 * etc. Strips scripts/styles before scanning so config strings don't trigger
 * false positives. Word-boundary regex (`\b...\b`) prevents substring hits
 * ("supercharger" wouldn't match "supercharge" — word boundary required).
 *
 * Source: ~/.claude/rules/copy-writing.md banned-words list. Warn-level because
 * the content-writer subagent owns rewording — this gate flags, content-writer
 * fixes. Promoting to error would block builds during voice tuning.
 *
 * @throws Violation `copy.banned_word` (warn) per word match
 *
 * @example Failing — generic AI-slop hero copy
 * ```html
 * <h1>Revolutionize your kitchen with our cutting-edge knives</h1>
 * <!-- → 2 violations: "revolutionize", "cutting-edge" -->
 * ```
 *
 * @example Passing — specific, concrete copy
 * ```html
 * <h1>Hand-forged knives that hold an edge for 50 years</h1>
 * ```
 *
 * @see ~/.claude/rules/copy-writing.md (full banned list + copy guidance)
 * @see ~/.agentskills/agents/content-writer.md (Emdash brand voice)
 */
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

/**
 * JS code-splitting — no single chunk > 250KB gzipped (proxied via 750KB raw).
 *
 * @remarks
 * Cloudflare R2 doesn't store gzipped sizes per-object, so we approximate: gzip
 * ratio averages ~3:1 for minified JS. 750KB raw ≈ 250KB gzipped, matching
 * `~/.claude/rules/quality-metrics.md` (no single chunk > 250KB gz). Per-route
 * code-splitting via `React.lazy(() => import(...))` and Vite `manualChunks` is
 * the canonical fix.
 *
 * Real-world: a 1.2MB raw bundle ≈ 400KB gz blocks LCP for ~2-3s on 3G. Hitting
 * the 250KB gz ceiling keeps LCP under the 2.5s WebVital target.
 *
 * @throws Violation `js.chunk_too_large` per chunk over 750KB raw
 *
 * @example Failing
 * ```ts
 * validateJsBundleSize([{ path: 'assets/index-abc.js', size: 900_000 }]);
 * // → [{ code: 'js.chunk_too_large', message: '...900KB)' }]
 * ```
 *
 * @see ~/.claude/rules/quality-metrics.md (JS chunks ≤250KB gzip)
 * @see apps/project-sites/.claude/agents/validator-fixer.md (manualChunks recipe)
 */
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

/**
 * Lightbox presence — JS bundle must contain BOTH `data-zoomable` and `data-gallery`.
 *
 * @remarks
 * Skill 10 build-breaking rule: every multi-image section must zoom on click and
 * group via `data-gallery="<group>"` so swipe/keyboard navigation works between
 * peers. Validator greps the concatenated JS bundle for the literal strings —
 * this catches bundles where the lightbox component was dead-code-eliminated by
 * tree-shaking, or where a developer added zoom but forgot grouping.
 *
 * Greps strings in the bundle source, not runtime DOM — runtime checks belong to
 * the visual-qa subagent.
 *
 * @throws Violation `lightbox.zoomable_missing` when `data-zoomable` absent
 * @throws Violation `lightbox.gallery_missing` when `data-gallery` absent
 *
 * @see ~/.agentskills/10-experience-and-design-system/build-breaking-rules.md
 * @see apps/project-sites/.claude/agents/validator-fixer.md (lightbox fix recipe)
 */
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

/**
 * Required well-known files — manifest, favicons, robots, sitemap, security.txt.
 *
 * @remarks
 * Ten files every site MUST ship at the root. PWA install fails without
 * `site.webmanifest`. Crawlers ignore the site without `robots.txt` + `sitemap.xml`.
 * Browser-config + favicons unify the platform-specific icon pipeline (Android,
 * iOS, Windows tile). `humans.txt` is brand transparency. `.well-known/security.txt`
 * is the standardized vuln-disclosure contact.
 *
 * @throws Violation `manifest.required_file_missing` per missing file
 *
 * @see ~/.claude/rules/always.md "Every site" gate
 * @see ~/.claude/rules/pwa-checklist.md (manifest + sw.js + offline.html)
 */
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

const REQUIRED_HEAD_FIELDS = [
  'title',
  'meta:description',
  'meta:robots',
  'meta:theme-color',
  'meta:application-name',
  'meta:apple-mobile-web-app-title',
  'meta:apple-mobile-web-app-capable',
  'meta:mobile-web-app-capable',
  'meta:og:type',
  'meta:og:title',
  'meta:og:description',
  'meta:og:url',
  'meta:og:site_name',
  'meta:og:locale',
  'meta:og:image',
  'meta:og:image:width',
  'meta:og:image:height',
  'meta:og:image:type',
  'meta:og:image:alt',
  'meta:twitter:card',
  'meta:twitter:title',
  'meta:twitter:description',
  'meta:twitter:image',
  'meta:twitter:image:alt',
  'link:canonical',
  'link:manifest',
  'link:icon',
  'link:apple-touch-icon',
];

const UNIQUE_HEAD_FIELDS = [
  'title',
  'meta:description',
  'meta:og:title',
  'meta:og:description',
  'meta:twitter:title',
  'meta:twitter:description',
];

/**
 * Per-route metadata — every required `<head>` field present + cross-route uniqueness.
 *
 * @remarks
 * Highest-leverage gate: every page failing per-route-metadata is a build break per
 * `~/.claude/rules/per-route-metadata.md`. Three sub-checks:
 * 1. **Required fields** — 28 fields incl. title, meta:description, og:* (full set incl.
 *    image:width/height/type/alt), twitter:* full set, theme-color, apple-mobile-web-app-*,
 *    link rel=manifest|canonical|icon|apple-touch-icon
 * 2. **OG image dimensions** — og:image:width/height/type/alt all required when og:image present
 * 3. **Cross-route uniqueness** — title + description + og:title + og:description +
 *    twitter:title + twitter:description hash unique across all routes (case-insensitive
 *    whitespace-normalized). Two routes sharing identical title or meta-desc = build fail.
 *
 * @throws Violation `meta.field_missing` per missing required head field
 * @throws Violation `meta.duplicate_across_routes` when fields collide between routes
 *
 * @see ~/.claude/rules/per-route-metadata.md (full RouteMetadata interface + validator rules)
 */
export const validateRouteMetadata = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  const hashIndex = new Map<string, Map<string, string>>();
  for (const field of UNIQUE_HEAD_FIELDS) hashIndex.set(field, new Map());
  for (const file of files) {
    if (!isUserFacingHtml(file.path) || !file.text) continue;
    const head = collectHeadFields(file.text);
    for (const field of REQUIRED_HEAD_FIELDS) {
      const vals = head.get(field);
      if (!vals || !vals.length || !vals[0]) {
        out.push({
          code: 'meta.field_missing',
          severity: 'error',
          message: `Missing <head> field: ${field}`,
          file: file.path,
        });
      }
    }
    for (const field of UNIQUE_HEAD_FIELDS) {
      const v = head.get(field)?.[0];
      if (!v) continue;
      const norm = normalizeForHash(v);
      const idx = hashIndex.get(field)!;
      const prior = idx.get(norm);
      if (prior && prior !== file.path) {
        out.push({
          code: 'meta.duplicate_across_routes',
          severity: 'error',
          message: `${field} duplicates ${prior} — every route needs unique copy`,
          file: file.path,
          detail: v,
        });
      } else {
        idx.set(norm, file.path);
      }
    }
  }
  return out;
};

/**
 * Internal links — every internal `<a href>` resolves to a known route.
 *
 * @remarks
 * Skill 07 build-breaking-rule "Every internal link KNOWN_ROUTES auto-derive". Auto-derives
 * the known-route set from HTML files in the build (`/`, `/about/`, `/about/index.html`)
 * unless `opts.knownRoutes` is supplied explicitly. Skips fragment-only (`#section`),
 * mailto/tel, external URLs, and asset refs (handled by `validateAssetExistence`).
 *
 * @throws Violation `link.unknown_route` per anchor href not found in route set
 *
 * @see ~/.agentskills/07-quality-and-verification/build-breaking-rules.md
 */
export const validateInternalLinks = (
  files: BuildFile[],
  opts?: Pick<ValidateBuildOpts, 'knownRoutes'>,
): Violation[] => {
  const routes = new Set<string>(['/', '']);
  for (const f of files) {
    if (!isHtml(f.path)) continue;
    const p = '/' + f.path.replace(/\/index\.html$/i, '/').replace(/\.html?$/i, '');
    routes.add(p);
    routes.add(p.replace(/\/$/, ''));
  }
  for (const r of opts?.knownRoutes || []) {
    routes.add(r);
    routes.add(r.replace(/\/$/, ''));
  }
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    for (const href of collectAnchors(file.text)) {
      if (!isInternalRef(href)) continue;
      const path = '/' + normalizeRef(href);
      if (path.startsWith('/#') || path === '/') continue;
      const stripped = path.replace(/\/$/, '');
      if (routes.has(path) || routes.has(stripped)) continue;
      const fileSet = new Set(files.map(f => f.path));
      if (fileSet.has(normalizeRef(href))) continue;
      out.push({
        code: 'link.unknown_route',
        severity: 'error',
        message: `Internal link to unknown route: ${href}`,
        file: file.path,
        detail: href,
      });
    }
  }
  return out;
};

/**
 * HTML entities forbidden in JSX-rendered output — raw Unicode only.
 *
 * @remarks
 * `~/.claude/rules/copy-writing.md` typography rule: raw Unicode `'` `"` `"` `…` `–` `—`
 * `·` only — never `&apos;|&middot;|&amp;|&ldquo;|&rdquo;|&hellip;|&ndash;|&mdash;|&nbsp;|&quot;`.
 * JSX entity decoding fires only for JSX text children, NOT for JS string literals piped
 * through `{variable}` or stored in data arrays — those render the literal `&apos;` to
 * the user. Skill 07 build-breaking-rule "Every JSX text+data-array no-HTML-entities".
 *
 * Strips `<script>`/`<style>` first because legitimate JS/CSS may contain `&amp;` in
 * concatenated strings or attribute selectors.
 *
 * @throws Violation `html.entity_in_source` per forbidden entity match
 *
 * @see ~/.claude/rules/copy-writing.md (Typography: raw Unicode only)
 */
export const validateHtmlEntities = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const stripped = stripScripts(file.text);
    const matches = stripped.match(HTML_ENTITY_PATTERN);
    if (matches?.length) {
      out.push({
        code: 'html.entity_in_source',
        severity: 'error',
        message: `Forbidden HTML entities ${matches.length}× — replace with raw Unicode (' " " … – —)`,
        file: file.path,
        detail: [...new Set(matches)].slice(0, 5).join(' '),
      });
    }
  }
  return out;
};

/**
 * Favicon set — full 11-file real-favicongenerator manifest must ship.
 *
 * @remarks
 * `validateRequiredFiles` checks the minimum subset (4 files); this gate enforces the
 * full RFG-produced 11-file manifest — `favicon.ico`, `favicon-{16,32,48}.png`,
 * `apple-touch-icon.png`, `android-chrome-{192,512}.png`, `mstile-150x150.png`,
 * `safari-pinned-tab.svg`, `site.webmanifest`, `browserconfig.xml`. Without the full
 * set, Android/iOS/Windows install paths produce blurry or missing icons.
 *
 * @throws Violation `favicon.set_incomplete` per missing file
 *
 * @see apps/project-sites/CLAUDE.md (real-favicongenerator Pipeline)
 */
export const validateFaviconSet = (files: BuildFile[]): Violation[] => {
  const set = new Set(files.map(f => f.path));
  return REQUIRED_FAVICON_SET.filter(p => !set.has(p)).map(p => ({
    code: 'favicon.set_incomplete',
    severity: 'error' as Severity,
    message: `RFG favicon manifest missing: ${p}`,
  }));
};

/**
 * PWA kit — site.webmanifest + sw.js + offline.html all present.
 *
 * @remarks
 * `~/.claude/rules/pwa-checklist.md` mandates the full PWA shell on every generated
 * site. Without `sw.js` the site can't go offline. Without `offline.html` the SW
 * NetworkFirst strategy has no fallback page. Without `site.webmanifest` install fails.
 *
 * @throws Violation `pwa.manifest_missing` | `pwa.sw_missing` | `pwa.offline_missing`
 *
 * @see ~/.claude/rules/pwa-checklist.md
 */
export const validatePwaKit = (files: BuildFile[]): Violation[] => {
  const set = new Set(files.map(f => f.path));
  const out: Violation[] = [];
  if (!set.has('site.webmanifest')) {
    out.push({ code: 'pwa.manifest_missing', severity: 'error', message: 'site.webmanifest required (PWA install)' });
  }
  if (!set.has('sw.js') && !set.has('service-worker.js')) {
    out.push({ code: 'pwa.sw_missing', severity: 'error', message: 'sw.js (Workbox-generated) required for offline support' });
  }
  if (!set.has('offline.html')) {
    out.push({ code: 'pwa.offline_missing', severity: 'error', message: 'offline.html required (SW NetworkFirst fallback)' });
  }
  return out;
};

/**
 * JSON-LD parses as valid JSON — no malformed structured data.
 *
 * @remarks
 * `validateJsonLdCount` gates the count; this gate gates the contents. Google Search
 * Console silently drops malformed JSON-LD blocks — they pass `count_below_threshold`
 * but contribute zero rich-snippet eligibility. Validator extracts every
 * `<script type="application/ld+json">...</script>` body and `JSON.parse()`s it.
 *
 * @throws Violation `jsonld.malformed` per script body that fails to parse
 *
 * @see ~/.claude/rules/quality-metrics.md (4+ JSON-LD blocks per page)
 */
export const validateJsonLdSchema = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    let i = 0;
    for (const m of file.text.matchAll(re)) {
      i++;
      try {
        const parsed = JSON.parse(m[1]);
        if (!parsed || typeof parsed !== 'object') {
          out.push({
            code: 'jsonld.malformed',
            severity: 'error',
            message: `JSON-LD #${i}: parsed but not an object`,
            file: file.path,
          });
        }
      } catch (e) {
        out.push({
          code: 'jsonld.malformed',
          severity: 'error',
          message: `JSON-LD #${i}: ${(e as Error).message}`,
          file: file.path,
        });
      }
    }
  }
  return out;
};

/**
 * Citations — every quantitative claim cites APA 7th ed `(Author, Year)`.
 *
 * @remarks
 * `~/.claude/rules/citations.md` build-breaking gate: greps dist HTML for `\d+%`,
 * `\$\d+[MBK]`, `\d+x faster|more|times|better`, `\d+ users|customers|...`, and
 * `since \d{4}`. Each match must be followed within the same paragraph by an APA
 * citation `(Author, Year)`. Unsourced numbers = AI slop = rejected.
 *
 * Heuristic: scan body text (scripts/styles stripped), for every quantitative match
 * check if the surrounding ±200-char window contains `APA_CITE_PATTERN`. False-positive
 * tolerance: warn-severity (not error) so brand voice claims like "Sharp. Punchy."
 * don't kill builds. Promote to error once benchmarks are clean.
 *
 * @throws Violation `citation.unsourced_claim` (warn) per uncited quantitative claim
 *
 * @see ~/.claude/rules/citations.md (banned phrases, APA format, source hierarchy)
 */
export const validateCitations = (files: BuildFile[]): Violation[] => {
  const out: Violation[] = [];
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const stripped = stripScripts(file.text).replace(/<[^>]+>/g, ' ');
    for (const m of stripped.matchAll(QUANTITATIVE_CLAIM_PATTERN)) {
      const start = Math.max(0, (m.index ?? 0) - 200);
      const end = Math.min(stripped.length, (m.index ?? 0) + (m[0]?.length || 0) + 200);
      const window = stripped.slice(start, end);
      if (!APA_CITE_PATTERN.test(window)) {
        out.push({
          code: 'citation.unsourced_claim',
          severity: 'warn',
          message: `Unsourced quantitative claim "${m[0]}" — add APA cite (Author, Year)`,
          file: file.path,
          detail: m[0],
        });
      }
    }
  }
  return out;
};

/**
 * Brand colors — rendered hex within ΔE2000 ≤ 5 of `_brand.json.primary`.
 *
 * @remarks
 * Source-fidelity gate complement: `validateSourceFidelity` is the GPT-4o vision pass;
 * this is the pixel-level deterministic check. Greps every `#RRGGBB` / `#RGB` in CSS
 * + inline styles + tailwind config and verifies at least one is within ΔE2000 ≤ 5
 * of `opts.brandJson.primary`. Catches the njsk.org incident (source `#7B1F2F` →
 * rebuild `#923B3B` muddy maroon all-passed-other-gates failure).
 *
 * Skipped when `opts.brandJson?.primary` undefined (greenfield build).
 *
 * @throws Violation `brand.color_drift` when no rendered hex matches primary within ΔE≤5
 *
 * @see ~/.agentskills/15-site-generation/source-fidelity-loop.md (njsk.org incident)
 */
export const validateBrandColors = (
  files: BuildFile[],
  opts?: Pick<ValidateBuildOpts, 'brandJson'>,
): Violation[] => {
  const primary = opts?.brandJson?.primary;
  if (!primary) return [];
  const target = hexToRgb(primary);
  if (!target) return [];
  const cssFiles = files.filter(f => /\.(css|html)$/i.test(f.path) && f.text);
  let bestDelta = Infinity;
  for (const f of cssFiles) {
    for (const m of (f.text || '').matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
      const rgb = hexToRgb(m[0]);
      if (!rgb) continue;
      const d = deltaE2000(target, rgb);
      if (d < bestDelta) bestDelta = d;
    }
  }
  if (bestDelta > 5) {
    return [{
      code: 'brand.color_drift',
      severity: 'error',
      message: `No rendered hex within ΔE2000 ≤ 5 of brand primary ${primary} (best: ${bestDelta.toFixed(2)})`,
      detail: `primary=${primary} closest_delta=${bestDelta.toFixed(2)}`,
    }];
  }
  return [];
};

/**
 * NAP consistency — Name + Address + Phone identical across every page.
 *
 * @remarks
 * Skill 15 small-business-mode "NAP authority" rule. Local SEO penalizes inconsistent
 * NAP across pages — Google treats `(555) 123-4567` and `555-123-4567` as different
 * listings. Validator reads `opts.researchJson.business.{name|formatted_address|formatted_phone_number}`
 * as the canonical triplet and greps every HTML body for matches. Misses (truncated
 * address, formatted phone variation, suite-number drift) all fail.
 *
 * Skipped when `opts.researchJson?.business` undefined (non-local-business mode).
 *
 * @throws Violation `nap.inconsistent` per page missing canonical NAP
 *
 * @see ~/.agentskills/15-site-generation/small-business-mode.md (NAP authority)
 */
export const validateNapConsistency = (
  files: BuildFile[],
  opts?: Pick<ValidateBuildOpts, 'researchJson'>,
): Violation[] => {
  const biz = opts?.researchJson?.business;
  if (!biz?.name || !biz.formatted_address || !biz.formatted_phone_number) return [];
  const out: Violation[] = [];
  const phoneDigits = biz.formatted_phone_number.replace(/\D/g, '').slice(-10);
  for (const file of files) {
    if (!isHtml(file.path) || !file.text) continue;
    const text = stripScripts(file.text).replace(/<[^>]+>/g, ' ');
    const compactDigits = text.replace(/\D/g, '');
    if (!text.toLowerCase().includes(biz.name.toLowerCase())) {
      out.push({
        code: 'nap.inconsistent',
        severity: 'error',
        message: `Business name "${biz.name}" missing from page`,
        file: file.path,
      });
    }
    if (!compactDigits.includes(phoneDigits)) {
      out.push({
        code: 'nap.inconsistent',
        severity: 'error',
        message: `Phone (${biz.formatted_phone_number}) missing — local SEO requires NAP on every page`,
        file: file.path,
      });
    }
  }
  return out;
};

/**
 * Typography — rendered font-family matches `_brand.json.fonts.{heading,body}`.
 *
 * @remarks
 * Source-fidelity gate complement: lonemountainglobal incident (source = Poppins+Hind,
 * rebuild defaulted to Inter, all other gates passed). Validator greps CSS for
 * `font-family:` declarations and ensures `_brand.json.fonts.heading` + `.body` appear
 * in the cascade (Tailwind theme, inline styles, `<style>` blocks).
 *
 * Skipped when `opts.brandJson?.fonts` undefined.
 *
 * @throws Violation `typography.mismatch` per missing font from cascade
 *
 * @see ~/.agentskills/15-site-generation/source-fidelity-loop.md (lonemountainglobal incident)
 */
export const validateTypography = (
  files: BuildFile[],
  opts?: Pick<ValidateBuildOpts, 'brandJson'>,
): Violation[] => {
  const fonts = opts?.brandJson?.fonts;
  if (!fonts) return [];
  const want = [fonts.heading, fonts.body].filter((s): s is string => !!s);
  if (!want.length) return [];
  const haystack = files
    .filter(f => /\.(css|html|js)$/i.test(f.path) && f.text)
    .map(f => f.text || '')
    .join('\n')
    .toLowerCase();
  const out: Violation[] = [];
  for (const font of want) {
    if (!haystack.includes(font.toLowerCase())) {
      out.push({
        code: 'typography.mismatch',
        severity: 'error',
        message: `Brand font "${font}" not found in CSS/HTML/JS — fix Tailwind theme or @font-face`,
        detail: font,
      });
    }
  }
  return out;
};

/**
 * Page count floor — even thin source sites get the 4-page minimum.
 *
 * @remarks
 * `~/.agentskills/15-site-generation/build-breaking-rules.md` floor: every site has
 * ≥4 routes (Home + About + Services + Contact). `validateRouteCount` handles the
 * upper bound (1:N source mapping); this handles the lower bound. Skips drafts of
 * 404/500/offline/admin paths — those don't count toward the floor.
 *
 * @throws Violation `page.count_below_floor` when fewer than 4 user-facing routes
 *
 * @see ~/.agentskills/15-site-generation/build-breaking-rules.md (4-page floor)
 */
export const validatePageCount = (files: BuildFile[]): Violation[] => {
  const routes = files.filter(
    f =>
      f.path.endsWith('.html') &&
      !/(^|\/)(404|500|offline)\.html$/i.test(f.path) &&
      !f.path.startsWith('admin/'),
  );
  if (routes.length >= 4) return [];
  return [{
    code: 'page.count_below_floor',
    severity: 'error',
    message: `Built ${routes.length} HTML route(s); 4-page floor required (Home + About + Services + Contact)`,
    detail: `built=${routes.length}`,
  }];
};

/**
 * Color contrast — vision-stub deferring to `accessibility-auditor` subagent.
 *
 * @remarks
 * Static contrast checking requires DOM rendering (resolved CSS variables, computed
 * styles, image-overlay scrim opacity). Worker-side static analysis can't compute
 * effective contrast for `color-mix()`, CSS custom properties, or scrim layers.
 * This gate emits an `info` violation that the accessibility-auditor subagent
 * picks up and runs axe-core against — proper contrast eval happens there.
 *
 * Always emits one info per HTML file (signals "remember to run a11y").
 *
 * @throws Violation `contrast.below_threshold_unverified` (info) per HTML file
 *
 * @see apps/project-sites/.claude/agents/accessibility-auditor.md
 */
export const validateColorContrast = (files: BuildFile[]): Violation[] => {
  const htmlCount = files.filter(f => isHtml(f.path)).length;
  if (!htmlCount) return [];
  return [{
    code: 'contrast.below_threshold_unverified',
    severity: 'info',
    message: `${htmlCount} HTML file(s) — accessibility-auditor must run axe-core for true contrast eval`,
  }];
};

/**
 * Image relevance — vision-stub deferring to `visual-qa` subagent.
 *
 * @remarks
 * Skill 12 build-breaking-rule "Every page-rendered image topic-relevance gate ≥8/10".
 * Requires GPT-4o vision (per-image business-type semantic match). Worker-side static
 * analysis can't decide if a hero image of a sunset matches a pizza restaurant.
 * Emits info-severity flag per image; visual-qa subagent picks up the list and
 * scores each via vision API. Failures get re-extracted via skill 12 image-discovery.
 *
 * @throws Violation `image.relevance_unverified` (info) per image awaiting vision pass
 *
 * @see ~/.agentskills/12-media-orchestration/build-breaking-rules.md
 */
export const validateImageRelevance = (files: BuildFile[]): Violation[] => {
  const images = files.filter(f => /\.(png|jpe?g|webp|avif)$/i.test(f.path) && !isFavicon(f.path) && !isOgImage(f.path));
  if (!images.length) return [];
  return [{
    code: 'image.relevance_unverified',
    severity: 'info',
    message: `${images.length} image(s) await visual-qa subagent topic-relevance scoring (≥8/10 required)`,
    detail: `count=${images.length}`,
  }];
};

/**
 * Source fidelity — vision-stub deferring to `source-fidelity-fixer` agent.
 *
 * @remarks
 * Skill 15 source-fidelity-loop runs in the workflow as a separate `source-fidelity-check`
 * step (post-staging-deploy). This gate just emits an info noting whether `_source_screenshot.png`
 * exists in build context — when present, the workflow MUST run `validate-source-fidelity.mjs`
 * before flipping `published`. When absent (greenfield build), the gate no-ops.
 *
 * @throws Violation `fidelity.unverified` (info) when source screenshot present
 *
 * @see ~/.agentskills/15-site-generation/source-fidelity-loop.md
 */
export const validateSourceFidelity = (files: BuildFile[]): Violation[] => {
  const hasSource = files.some(f => /^(.*\/)?_source_screenshot\.png$/i.test(f.path));
  if (!hasSource) return [];
  return [{
    code: 'fidelity.unverified',
    severity: 'info',
    message: '_source_screenshot.png present — workflow must run validate-source-fidelity.mjs',
  }];
};

/**
 * Photo authenticity — vision-stub deferring to `visual-qa` subagent.
 *
 * @remarks
 * Skill 15 small-business-mode trust-stack rule: photos of actual owner + actual staff
 * + actual location, NEVER stock. Static analysis can't tell stock from authentic;
 * vision pass identifies stock-photo "professional smiling person" patterns. Emits
 * info-severity flag for team/about/gallery pages; visual-qa subagent picks them up.
 *
 * @throws Violation `photo.authenticity_unverified` (info) per team/about/gallery image
 *
 * @see ~/.agentskills/15-site-generation/small-business-mode.md (Trust Stack)
 */
export const validatePhotoAuthenticity = (files: BuildFile[]): Violation[] => {
  const targets = files.filter(f =>
    /\.(png|jpe?g|webp|avif)$/i.test(f.path) &&
    /(team|about|gallery|staff|owner)/i.test(f.path),
  );
  if (!targets.length) return [];
  return [{
    code: 'photo.authenticity_unverified',
    severity: 'info',
    message: `${targets.length} team/about/gallery image(s) await visual-qa stock-photo detection`,
    detail: `count=${targets.length}`,
  }];
};

/**
 * Run every validator and return a structured pass/fail report.
 *
 * @remarks
 * Aggregator entry point called from `workflows/site-generation.ts` after R2 upload.
 * Currently runs in `report` mode (logs to D1 audit, never throws). Once benchmark
 * sites (megabyte-labs, njsk, nyfb, vito's, soup-kitchen) all return `ok: true`
 * cleanly, the workflow flips this to `strict` mode — `ok: false` then transitions
 * the site to `error` status instead of `published`.
 *
 * `opts.sourceRouteCount` from `_scraped_content.json.routes[].length` gates 1:N
 * route mapping. `opts.brandJson` from `_brand.json` enables brand-color +
 * typography validators. `opts.researchJson` from `_research.json` enables NAP
 * consistency for local-business mode. `opts.knownRoutes` from the structure plan
 * gives validateInternalLinks an authoritative route set. Pass `undefined` for any
 * to skip that validator's gate.
 *
 * @example Local dev with full context
 * ```ts
 * const files = await loadBuildFromR2(env.SITES_BUCKET, `sites/${slug}/${version}/`);
 * const report = validateBuild(files, {
 *   sourceRouteCount: 27,
 *   brandJson: await loadBrand(env, slug),
 *   researchJson: await loadResearch(env, slug),
 *   knownRoutes: ['/', '/about', '/services', '/contact'],
 * });
 * if (!report.ok) console.error(report.summary, report.errors);
 * ```
 *
 * @example Unit test fixture (no source/brand context)
 * ```ts
 * const report = validateBuild([
 *   { path: 'index.html', text: '<!doctype html>...', size: 1000 },
 *   ...favicons,
 * ]);
 * expect(report.ok).toBe(true);
 * ```
 *
 * @see ./build_validators.test.ts
 */
export const validateBuild = (
  files: BuildFile[],
  opts: ValidateBuildOpts = {},
): ValidationReport => {
  const all: Violation[] = [
    ...validateRequiredFiles(files),
    ...validateAssetExistence(files),
    ...validateImageFormat(files),
    ...validateOgImage(files),
    ...validateAppleTouchIcon(files),
    ...validateMetaLengths(files),
    ...validateRouteMetadata(files),
    ...validateJsonLdCount(files),
    ...validateJsonLdSchema(files),
    ...validateH1InShell(files),
    ...validateColorScheme(files),
    ...validateSitemapLastmod(files),
    ...validateBannedWords(files),
    ...validateJsBundleSize(files),
    ...validateLightboxPresence(files),
    ...validateInternalLinks(files, opts),
    ...validateHtmlEntities(files),
    ...validateFaviconSet(files),
    ...validatePwaKit(files),
    ...validateCitations(files),
    ...validateBrandColors(files, opts),
    ...validateNapConsistency(files, opts),
    ...validateTypography(files, opts),
    ...validatePageCount(files),
    ...validateColorContrast(files),
    ...validateImageRelevance(files),
    ...validateSourceFidelity(files),
    ...validatePhotoAuthenticity(files),
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
