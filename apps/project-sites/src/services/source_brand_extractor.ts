/**
 * @module services/source_brand_extractor
 * @description Deterministic source-site brand extraction.
 *
 * Runs in the Worker BEFORE the container build to fetch the source URL,
 * parse fonts/logo/colors/images, and produce three R2-persisted JSON
 * artifacts (`_brand.json`, `_assets.json`, `_scraped_content.json`) that
 * the container orchestrator MUST honor for the suped-up-clone contract.
 *
 * Replaces the prior LLM-driven research collapse — without this step the
 * orchestrator falls back to platform defaults (Inter/Space Grotesk, dark
 * theme, 0 source images) which destroys brand identity.
 */

const REAL_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FETCH_HEADERS: HeadersInit = {
  'User-Agent': REAL_UA,
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-User': '?1',
  'Sec-Fetch-Dest': 'document',
  'Upgrade-Insecure-Requests': '1',
};

export interface SourceBrandFonts {
  /** Font for the logo wordmark, when distinguishable from headings. */
  logo?: string;
  /** Heading font (h1-h3). */
  heading?: string;
  /** Body font. */
  body?: string;
  /** Where the values came from: `extracted` | `default`. */
  source: 'extracted' | 'default';
  /** Raw font-family strings observed, in declaration order. */
  observed: string[];
  /** Google Fonts family names parsed from `<link>` URLs. */
  google_fonts: string[];
}

export interface SourceBrandLogo {
  /** Full horizontal/wordmark URL (header logo image). */
  original_url?: string;
  /** Square icon-only URL (favicon, apple-touch, manifest icon). */
  original_icon_url?: string;
  /** Where each was discovered: header_img|apple_touch|manifest|icon|og_image|none. */
  source: { wordmark: string; icon: string };
}

export interface SourceBrandColors {
  /** Hex frequency dictionary, ranked. */
  ranked: Array<{ hex: string; count: number }>;
  /** Inferred primary brand color (top non-mono hex). */
  primary?: string;
  /** Secondary brand color (next non-mono hex). */
  secondary?: string;
  /** Page background color guess (from `body { background }` or hero bg). */
  background?: string;
}

export interface SourceBrandAsset {
  url: string;
  /** Where it appeared: img|css_bg|og_image|favicon|manifest_icon. */
  origin: string;
  /** Inferred role: hero|logo|gallery|team|content|icon. */
  role?: string;
  /** Optional alt text or filename hint. */
  hint?: string;
}

export interface SourceBrandRoute {
  url: string;
  source: 'sitemap' | 'crawl' | 'nav';
}

export interface SourceBrand {
  source_url: string;
  fetched_at: string;
  /** Chosen theme polarity for the rebuild. */
  theme: 'light' | 'dark';
  /** Mirror source layout/colors/typography when source is polished. */
  preserve_source_design: boolean;
  /** Detected CMS (informs preserve_source_design heuristic). */
  cms?: 'wordpress' | 'squarespace' | 'wix' | 'webflow' | 'shopify' | 'unknown';
  fonts: SourceBrandFonts;
  logo: SourceBrandLogo;
  colors: SourceBrandColors;
  /** Discovered assets — feeds `_assets.json.original[]`. */
  assets: SourceBrandAsset[];
  /** Discovered URLs — feeds `_scraped_content.json.routes[]`. */
  routes: SourceBrandRoute[];
  /** Truncated homepage HTML for the orchestrator to read. */
  html_excerpt: string;
  /** Soft warnings (no hard failures — extractor never throws). */
  warnings: string[];
}

/** Fetch a URL with a realistic browser fingerprint. Returns null on failure. */
async function fetchHtml(url: string, timeoutMs = 15_000): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { headers: FETCH_HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/') && !ct.includes('xml') && !ct.includes('html')) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** Resolve a (possibly relative) URL against a base. Returns null if invalid. */
function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

/** True if a hex is a near-mono shade (white/black/grey) and should be excluded from brand colors. */
function isMonoHex(hex: string): boolean {
  const h = hex.toLowerCase().replace('#', '');
  if (h.length === 3) {
    return h[0] === h[1] && h[1] === h[2];
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max - min < 16;
  }
  return false;
}

/** Compute sRGB relative luminance (0–1) per WCAG. */
function hexLuminance(hex: string): number {
  const h = hex.replace('#', '');
  if (h.length !== 6) return 0.5;
  const channels = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/**
 * Extract the dominant non-mono brand color from a logo image via GPT-4o-mini vision.
 *
 * CSS hex-frequency extraction misses logo image colors entirely — PNG/SVG bytes
 * never appear in stylesheets, so a site like lonemountainglobal.com (burgundy
 * raster wordmark) ends up with whatever theme accent the WordPress installation
 * happens to have. This vision pass repairs the priority chain in
 * `prompts/research_brand.prompt.md` (logo dominant → header/nav → CTA → body bg).
 *
 * Returns a 6-digit hex (`#722f37`) or null on any failure. Soft-fails — never
 * throws — so callers can downgrade to CSS-derived colors when the key is missing
 * or the API is unreachable.
 */
async function extractLogoDominantColor(
  logoUrl: string,
  openaiKey: string,
  timeoutMs = 12_000,
): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 16,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Look at this logo image. Reply with ONLY a single 6-digit hex color like #722F37 — the dominant brand color of the logo, NEVER white, black, or gray. No prose, no explanation, no markdown. Just the hex.',
              },
              { type: 'image_url', image_url: { url: logoUrl, detail: 'low' } },
            ],
          },
        ],
      }),
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content?.trim() || '';
    const hexMatch = raw.match(/#([0-9a-fA-F]{6})/);
    if (!hexMatch) return null;
    return normalizeHex(hexMatch[0]);
  } catch {
    return null;
  }
}

/** Normalize a hex to 6-digit lowercase. Returns null if invalid. */
function normalizeHex(raw: string): string | null {
  const m = raw.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return null;
  let h = m[1].toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h}`;
}

/** Parse Google Fonts URL params to family names. */
function parseGoogleFontsUrl(url: string): string[] {
  const families: string[] = [];
  try {
    const u = new URL(url);
    if (!u.hostname.includes('fonts.googleapis.com')) return families;
    // css?family=Poppins:300,400,700|Hind:400,700  (pipe-delimited multi-family)
    // css2?family=Poppins:wght@300;400;700&family=Hind:wght@400;700  (multiple family=)
    const familyParams = u.searchParams.getAll('family');
    for (const fp of familyParams) {
      // Pipe splits multiple families in /css?family=A|B|C syntax.
      for (const segment of fp.split('|')) {
        const name = segment.split(':')[0].replace(/\+/g, ' ').trim();
        if (name) families.push(name);
      }
    }
  } catch {
    /* ignore */
  }
  return families;
}

/**
 * Known Google Fonts catalog subset — when observed in font-family declarations
 * but missing from `<link>` URLs (e.g. loaded via @font-face self-host or
 * dynamic injection), we still want to promote them so the orchestrator
 * preserves the source typography choice.
 */
const KNOWN_GOOGLE_FONTS = new Set<string>([
  'Poppins', 'Hind', 'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat',
  'Source Sans Pro', 'Source Sans 3', 'Raleway', 'Ubuntu', 'Nunito', 'Nunito Sans',
  'Playfair Display', 'Merriweather', 'Oswald', 'PT Sans', 'PT Serif', 'Roboto Slab',
  'Roboto Condensed', 'Roboto Mono', 'Work Sans', 'Karla', 'Mulish', 'Rubik',
  'DM Sans', 'DM Serif Display', 'Manrope', 'Space Grotesk', 'Space Mono',
  'Plus Jakarta Sans', 'Quicksand', 'Cabin', 'Bebas Neue', 'Anton', 'Barlow',
  'Barlow Condensed', 'Cormorant Garamond', 'Crimson Pro', 'Crimson Text',
  'EB Garamond', 'Fira Sans', 'Fira Code', 'IBM Plex Sans', 'IBM Plex Serif',
  'IBM Plex Mono', 'Josefin Sans', 'Lora', 'Libre Baskerville', 'Libre Franklin',
  'Heebo', 'Hind Madurai', 'Hind Siliguri', 'Hind Vadodara', 'Hind Guntur',
  'Outfit', 'Sora', 'Syne', 'Urbanist', 'Cabinet Grotesk', 'Satoshi',
  'Archivo', 'Archivo Narrow', 'Archivo Black', 'Bitter', 'Cardo', 'Catamaran',
  'Comfortaa', 'Dosis', 'Exo', 'Exo 2', 'Inconsolata', 'JetBrains Mono',
  'Kanit', 'Mukti', 'Mukta', 'Noto Sans', 'Noto Serif', 'Overpass', 'Oxygen',
  'Pacifico', 'Permanent Marker', 'Prompt', 'Questrial', 'Roboto Flex',
  'Saira', 'Saira Condensed', 'Spectral', 'Teko', 'Titillium Web', 'Varela Round',
  'Vollkorn', 'Yanone Kaffeesatz', 'Zilla Slab', 'Caveat', 'Dancing Script',
  'Lobster', 'Sacramento', 'Shadows Into Light', 'Great Vibes', 'Pacifico',
]);

/** Heuristic CMS detection from HTML markers. */
function detectCms(html: string): SourceBrand['cms'] {
  const lower = html.toLowerCase();
  if (lower.includes('wp-content/') || lower.includes('wp-includes/') || lower.includes('/wp-json/')) return 'wordpress';
  if (lower.includes('squarespace') || lower.includes('static1.squarespace.com')) return 'squarespace';
  if (lower.includes('wix.com') || lower.includes('parastorage.com')) return 'wix';
  if (lower.includes('webflow') || lower.includes('webflow.com')) return 'webflow';
  if (lower.includes('cdn.shopify.com') || lower.includes('myshopify.com')) return 'shopify';
  return 'unknown';
}

/** Extract first capture group occurrences for a global regex. */
function allMatches(re: RegExp, src: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

/** Pull every `<img src="...">` URL from HTML. */
function extractImgSrcs(html: string, base: string): SourceBrandAsset[] {
  const out: SourceBrandAsset[] = [];
  const seen = new Set<string>();

  const imgRe = /<img\b[^>]*\bsrc=(?:"([^"]+)"|'([^']+)')/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const raw = m[1] || m[2];
    if (!raw || raw.startsWith('data:')) continue;
    const abs = resolveUrl(raw, base);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);

    // Capture alt + class attributes (loose — same tag scope, may miss complex cases).
    const tagStart = html.lastIndexOf('<img', m.index + 4);
    const tagEnd = html.indexOf('>', m.index);
    const tag = html.slice(tagStart, tagEnd + 1);
    const altMatch = tag.match(/\balt=(?:"([^"]*)"|'([^']*)')/i);
    const classMatch = tag.match(/\bclass=(?:"([^"]*)"|'([^']*)')/i);
    const alt = altMatch ? altMatch[1] || altMatch[2] || '' : '';
    const cls = classMatch ? classMatch[1] || classMatch[2] || '' : '';
    const hint = (alt || cls || abs.split('/').pop() || '').toLowerCase();

    let role: SourceBrandAsset['role'] = 'content';
    if (hint.includes('logo')) role = 'logo';
    else if (hint.includes('hero') || hint.includes('banner') || hint.includes('splash')) role = 'hero';
    else if (hint.includes('team') || hint.includes('headshot') || hint.includes('staff') || hint.includes('founder')) role = 'team';
    else if (hint.includes('gallery') || hint.includes('photo')) role = 'gallery';

    out.push({ url: abs, origin: 'img', role, hint: alt || cls || undefined });
  }

  // Also pull srcset highest-res candidates.
  const srcsetRe = /srcset=(?:"([^"]+)"|'([^']+)')/gi;
  while ((m = srcsetRe.exec(html)) !== null) {
    const raw = m[1] || m[2];
    if (!raw) continue;
    const candidates = raw.split(',').map((c) => c.trim().split(/\s+/)[0]);
    for (const cand of candidates) {
      if (cand.startsWith('data:')) continue;
      const abs = resolveUrl(cand, base);
      if (abs && !seen.has(abs)) {
        seen.add(abs);
        out.push({ url: abs, origin: 'img', role: 'content' });
      }
    }
  }

  return out;
}

/** Pull every `background-image: url(...)` from inline + linked stylesheets. */
function extractBackgroundImages(css: string, base: string): SourceBrandAsset[] {
  const out: SourceBrandAsset[] = [];
  const seen = new Set<string>();
  const bgRe = /background(?:-image)?\s*:[^;}]*url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  let m: RegExpExecArray | null;
  while ((m = bgRe.exec(css)) !== null) {
    const raw = m[1];
    if (!raw || raw.startsWith('data:')) continue;
    const abs = resolveUrl(raw, base);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    out.push({ url: abs, origin: 'css_bg', role: 'hero' });
  }
  return out;
}

/** Pull every `<link rel="stylesheet" href="...">` URL from HTML. */
function extractStylesheetLinks(html: string, base: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // Matches both rel="stylesheet" with href="..." in either order.
  const linkRe = /<link\b[^>]*\brel=(?:"stylesheet"|'stylesheet'|stylesheet)[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const hrefMatch = tag.match(/\bhref=(?:"([^"]+)"|'([^']+)')/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1] || hrefMatch[2];
    const abs = resolveUrl(href, base);
    if (abs && !seen.has(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  }
  // Also catch inverted attribute order: <link href="..." rel="stylesheet">
  const linkRe2 = /<link\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*\brel=(?:"stylesheet"|'stylesheet'|stylesheet)[^>]*>/gi;
  while ((m = linkRe2.exec(html)) !== null) {
    const href = m[1] || m[2];
    const abs = resolveUrl(href, base);
    if (abs && !seen.has(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  }
  return out;
}

/** Discover URLs from sitemap.xml + nav. */
async function discoverRoutes(baseUrl: string, html: string): Promise<SourceBrandRoute[]> {
  const seen = new Set<string>();
  const out: SourceBrandRoute[] = [];
  const baseHost = new URL(baseUrl).host;

  const pushIf = (url: string, source: SourceBrandRoute['source']) => {
    if (!url || seen.has(url)) return;
    try {
      const u = new URL(url);
      if (u.host !== baseHost) return;
      seen.add(url);
      out.push({ url, source });
    } catch {
      /* ignore */
    }
  };

  // Try standard sitemap locations.
  for (const path of ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml']) {
    const xml = await fetchHtml(new URL(path, baseUrl).toString(), 8_000);
    if (!xml) continue;
    const locs = allMatches(/<loc>\s*([^<]+?)\s*<\/loc>/gi, xml);
    for (const loc of locs) pushIf(loc.trim(), 'sitemap');
    if (out.length > 0) break;
  }

  // Fallback: nav anchors from the homepage HTML.
  const anchorRe = /<a\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1] || m[2];
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;
    const abs = resolveUrl(href, baseUrl);
    if (abs) pushIf(abs, 'nav');
  }

  return out.slice(0, 200);
}

/**
 * Extract source-site brand assets, fonts, colors, theme, and routes from a
 * live URL. The Worker calls this BEFORE dispatching the container build so
 * the orchestrator subagents receive deterministic, ground-truth brand data
 * via `_brand.json` / `_assets.json` / `_scraped_content.json` instead of
 * inferring identity from an LLM research pass (which historically collapsed
 * to platform defaults — Inter/Space Grotesk dark theme — and destroyed
 * brand recognition).
 *
 * @param sourceUrl - Source homepage URL. Bare hostnames (`example.com`)
 *   auto-prepend `https://`. Must respond 2xx with `text/html` to populate
 *   anything beyond the empty fallback skeleton.
 * @param opts.openaiKey - Optional `OPENAI_API_KEY` enabling the GPT-4o-mini
 *   logo-color vision pass via {@link extractLogoDominantColor}. When
 *   omitted, brand colors fall back to CSS hex-frequency analysis (misses
 *   raster-logo dominant colors — e.g. lonemountainglobal.com's burgundy
 *   wordmark never appears in stylesheets).
 *
 * @returns A {@link SourceBrand} record. ALWAYS resolves — never throws.
 *   On any fetch/parse failure, returns a partially-populated record with
 *   the error surfaced in `warnings[]` so the workflow keeps progressing
 *   on stub defaults rather than wedging mid-build.
 *
 * @remarks
 * Pipeline order (each step soft-fails into `warnings[]`):
 * 1. Fetch homepage HTML via {@link fetchHtml} (15s timeout, browser UA).
 * 2. {@link detectCms} from HTML signatures (WP/Squarespace/Wix/Webflow/Shopify).
 * 3. Fetch up to 3 same-host CSS files for `font-family` + hex-frequency mining.
 * 4. Resolve Google Fonts families from `<link rel="stylesheet">` URLs +
 *    `@import url(...)` blocks (some sites inline the Fonts import).
 * 5. Pick logo wordmark + icon via the priority chain (header `<img>` →
 *    manifest icons → `<link rel="apple-touch-icon">` → `<link rel="icon">` →
 *    `og:image`). Persist BOTH so the rebuild has a square favicon source
 *    AND a horizontal hero/header source.
 * 6. Rank hex colors (non-mono, excluding `#fff`/`#000`/near-greys) by
 *    frequency; when `opts.openaiKey` is set, run the GPT-4o-mini vision
 *    pass to recover dominant color from raster logos.
 * 7. Compute logo-luminance-driven theme polarity:
 *    `luminance < 0.4` → light theme | `> 0.6` → dark theme | mid-range
 *    defaults dark but verifies logo contrast ≥4.5:1.
 * 8. Collect routes: prefer `/sitemap.xml` + `/sitemap_index.xml`, fall back
 *    to nav anchor crawl (homepage `<a href>` extraction, capped at 200).
 * 9. Score source aesthetic polish: when source is polished (≥7/10),
 *    `preserve_source_design = true` to mirror layout/colors before adding
 *    our polish layer.
 *
 * @throws Never — every failure mode collapses into `warnings[]`. Caller
 *   inspects `warnings.length === 0` or specific entries to surface
 *   degraded extraction quality.
 *
 * @example
 * ```ts
 * const brand = await extractSourceBrand('lonemountainglobal.com', {
 *   openaiKey: env.OPENAI_API_KEY,
 * });
 * if (brand.warnings.length === 0) {
 *   // Full extraction succeeded — orchestrator gets ground-truth brand
 *   await persistSourceBrand(env.SITES_BUCKET, slug, brand);
 * } else {
 *   console.warn('Brand extraction partial:', brand.warnings);
 * }
 * ```
 *
 * @see {@link persistSourceBrand} for R2 persistence + container hand-off.
 * @see {@link SourceBrand} for the full output schema.
 */
export async function extractSourceBrand(
  sourceUrl: string,
  opts?: { openaiKey?: string },
): Promise<SourceBrand> {
  const warnings: string[] = [];
  const fetchedAt = new Date().toISOString();

  // Normalize: prepend https:// if missing.
  const url = /^https?:\/\//i.test(sourceUrl) ? sourceUrl : `https://${sourceUrl}`;

  const html = await fetchHtml(url);
  if (!html) {
    warnings.push(`Failed to fetch source URL ${url}`);
    return {
      source_url: url,
      fetched_at: fetchedAt,
      theme: 'light',
      preserve_source_design: false,
      cms: 'unknown',
      fonts: { source: 'default', observed: [], google_fonts: [] },
      logo: { source: { wordmark: 'none', icon: 'none' } },
      colors: { ranked: [] },
      assets: [],
      routes: [],
      html_excerpt: '',
      warnings,
    };
  }

  const cms = detectCms(html);

  // ── Stylesheets: fetch up to 3 same-host CSS files for inspection ──
  const cssLinks = extractStylesheetLinks(html, url);
  const sameHost = new URL(url).host;
  const sameHostCss = cssLinks.filter((u) => {
    try {
      return new URL(u).host === sameHost;
    } catch {
      return false;
    }
  }).slice(0, 3);

  let aggregatedCss = '';
  for (const cssUrl of sameHostCss) {
    const cssText = await fetchHtml(cssUrl, 8_000);
    if (cssText) aggregatedCss += `\n/* ${cssUrl} */\n${cssText}`;
  }

  // ── Fonts: Google Fonts URLs + font-family declarations ──
  const googleFontFamilies = new Set<string>();
  for (const link of cssLinks) {
    for (const fam of parseGoogleFontsUrl(link)) googleFontFamilies.add(fam);
  }
  // Some sites inline @import for Google Fonts:
  for (const m of allMatches(/@import\s+url\(['"]?([^'")]+)['"]?\)/gi, aggregatedCss + html)) {
    for (const fam of parseGoogleFontsUrl(m)) googleFontFamilies.add(fam);
  }

  const ffSrc = aggregatedCss + '\n' + html;
  // Capture full font-family value including quoted family names. Stops at `;` or `}` (rule
  // terminators) — `<>` excluded to avoid sucking in HTML tags when scanning inline styles.
  const ffMatches = allMatches(/font-family\s*:\s*([^;}<>]+)/gi, ffSrc);
  const observed: string[] = [];
  const seenFf = new Set<string>();
  for (const raw of ffMatches) {
    const cleaned = raw.replace(/!important/gi, '').trim();
    if (!cleaned || seenFf.has(cleaned)) continue;
    seenFf.add(cleaned);
    observed.push(cleaned);
  }

  // Pick heading font: first observed family that names a Google Fonts entry, else first non-system.
  const systemFonts = /^(serif|sans-serif|monospace|inherit|initial|unset|none|auto|system-ui|-apple-system|blinkmacsystemfont|'?segoe ui'?|'?helvetica( neue)?'?|arial|times( new roman)?|georgia|cursive|fantasy|courier( new)?|verdana|tahoma|trebuchet ms|impact|comic sans ms|palatino|garamond|menlo|monaco|consolas)$/i;
  const firstFamily = (decl: string): string | null => {
    const trimmed = decl.trim();
    // Reject CSS variable wrappers (`var(--font-x, "Real Font")`) — extractor cannot
    // resolve the variable definition inline; fallback families inside var() are skipped.
    if (trimmed.startsWith('var(') || trimmed.startsWith('--') || trimmed.startsWith('(')) return null;
    const first = trimmed.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    if (!first) return null;
    // Reject obviously non-typographic identifiers (icon fonts, plugin shims).
    if (/^(fildisi-icons|vc(_|pb)|wp-|fa[-_])/i.test(first)) return null;
    if (systemFonts.test(first)) return null;
    return first;
  };

  const observedFamilies = observed.map(firstFamily).filter(Boolean) as string[];

  // Promote observed families that match the known Google Fonts catalog into google_fonts
  // even when not loaded via fonts.googleapis.com link (some sites self-host or use @font-face).
  for (const fam of observedFamilies) {
    if (KNOWN_GOOGLE_FONTS.has(fam)) googleFontFamilies.add(fam);
  }

  const googleArr = Array.from(googleFontFamilies);

  // Selector-aware association: which fonts appear in heading (h1-h6) selectors vs body selectors.
  // Without this, source order alone misclassifies (body { ... } usually appears before h1 { ... }).
  const headingFonts: string[] = [];
  const bodyFonts: string[] = [];
  const ruleRe = /([^{}]+)\{([^}]*)\}/g;
  let ruleMatch: RegExpExecArray | null;
  while ((ruleMatch = ruleRe.exec(aggregatedCss)) !== null) {
    const selectors = ruleMatch[1].trim();
    const ruleBody = ruleMatch[2];
    const ffDecl = ruleBody.match(/font-family\s*:\s*([^;}<>]+)/i);
    if (!ffDecl) continue;
    const fam = firstFamily(ffDecl[1]);
    if (!fam) continue;
    const isHeadingSel = /(^|[\s,>+~])h[1-6](\b|[\s,.:#\[])/i.test(selectors);
    const isBodySel = /(^|[\s,>+~])(body|html)(\b|[\s,.:#\[])/i.test(selectors) || /(^|[\s,])p(\b|[\s,.:#\[])/i.test(selectors);
    if (isHeadingSel) headingFonts.push(fam);
    if (isBodySel) bodyFonts.push(fam);
  }

  const isGoogle = (f: string) => KNOWN_GOOGLE_FONTS.has(f);
  const observedGoogle = observedFamilies.filter(isGoogle);
  const headingGoogle = headingFonts.filter(isGoogle);
  const bodyGoogle = bodyFonts.filter(isGoogle);

  const heading =
    headingGoogle[0] ||
    headingFonts[0] ||
    observedGoogle[0] ||
    googleArr[0] ||
    observedFamilies[0];
  const body =
    bodyGoogle.find((f) => f !== heading) ||
    bodyFonts.find((f) => f !== heading) ||
    observedGoogle.find((f) => f !== heading) ||
    googleArr.find((f) => f !== heading) ||
    observedFamilies.find((f) => f !== heading) ||
    heading;
  // Logo font often equals heading on indie sites; leave undefined unless an explicit wordmark class hints otherwise.
  const fonts: SourceBrandFonts = {
    logo: heading,
    heading,
    body,
    source: heading || body ? 'extracted' : 'default',
    observed: observed.slice(0, 12),
    google_fonts: googleArr,
  };
  if (!heading && !body) warnings.push('No fonts extracted from source CSS — orchestrator may fall back to defaults');

  // ── Logo via priority chain ──
  const logo: SourceBrandLogo = { source: { wordmark: 'none', icon: 'none' } };

  // 1. Header <img> with class/alt containing "logo"
  const logoImgRe = /<img\b[^>]*?(?:\b(?:class|alt|id)=(?:"[^"]*logo[^"]*"|'[^']*logo[^']*'|[^\s>]*logo[^\s>]*))[^>]*>/i;
  const logoMatch = html.match(logoImgRe);
  if (logoMatch) {
    const srcMatch = logoMatch[0].match(/\bsrc=(?:"([^"]+)"|'([^']+)')/i);
    if (srcMatch) {
      const abs = resolveUrl(srcMatch[1] || srcMatch[2], url);
      if (abs) {
        logo.original_url = abs;
        logo.source.wordmark = 'header_img';
      }
    }
  }

  // 2. apple-touch-icon → icon URL
  const appleTouchMatch = html.match(/<link\b[^>]*\brel=(?:"apple-touch-icon"|'apple-touch-icon')[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*>/i)
    || html.match(/<link\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*\brel=(?:"apple-touch-icon"|'apple-touch-icon')[^>]*>/i);
  if (appleTouchMatch) {
    const abs = resolveUrl(appleTouchMatch[1] || appleTouchMatch[2], url);
    if (abs) {
      logo.original_icon_url = abs;
      logo.source.icon = 'apple_touch';
    }
  }

  // 3. <link rel="icon"> fallback for icon
  if (!logo.original_icon_url) {
    const iconMatch = html.match(/<link\b[^>]*\brel=(?:"(?:shortcut )?icon"|'(?:shortcut )?icon')[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*>/i)
      || html.match(/<link\b[^>]*\bhref=(?:"([^"]+)"|'([^']+)')[^>]*\brel=(?:"(?:shortcut )?icon"|'(?:shortcut )?icon')[^>]*>/i);
    if (iconMatch) {
      const abs = resolveUrl(iconMatch[1] || iconMatch[2], url);
      if (abs) {
        logo.original_icon_url = abs;
        logo.source.icon = 'icon_link';
      }
    }
  }

  // 4. og:image fallback for wordmark when no header logo found
  if (!logo.original_url) {
    const ogMatch = html.match(/<meta\b[^>]*\bproperty=(?:"og:image"|'og:image')[^>]*\bcontent=(?:"([^"]+)"|'([^']+)')[^>]*>/i)
      || html.match(/<meta\b[^>]*\bcontent=(?:"([^"]+)"|'([^']+)')[^>]*\bproperty=(?:"og:image"|'og:image')[^>]*>/i);
    if (ogMatch) {
      const abs = resolveUrl(ogMatch[1] || ogMatch[2], url);
      if (abs) {
        logo.original_url = abs;
        logo.source.wordmark = 'og_image';
      }
    }
  }

  if (!logo.original_url) warnings.push('No logo wordmark discovered via priority chain');
  if (!logo.original_icon_url) warnings.push('No favicon/apple-touch icon discovered');

  // ── Colors: hex frequency from aggregated CSS (excludes mono shades) ──
  const hexMatches = allMatches(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b/g, aggregatedCss);
  const hexCounts = new Map<string, number>();
  for (const raw of hexMatches) {
    const norm = normalizeHex(raw);
    if (!norm) continue;
    if (isMonoHex(norm)) continue;
    hexCounts.set(norm, (hexCounts.get(norm) || 0) + 1);
  }
  const ranked = Array.from(hexCounts.entries())
    .map(([hex, count]) => ({ hex, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  const primary = ranked[0]?.hex;
  const secondary = ranked[1]?.hex;

  // Page background: scan ALL `html|body { ... background[-color]: ... }` declarations,
  // skip selectors with modifier classes/IDs (`.modal-open`, `.dark`, `[data-...]`), and
  // pick the lightest hex when multiple candidates exist (most WP/Squarespace sites layer
  // dark utility rules on top of a light page background).
  let background: string | undefined;
  const candidateBgs: string[] = [];
  const bodyRuleRe = /(?:^|[}\s])(html|body)([^{,]*)\{([^}]*)\}/gi;
  let bgMatch: RegExpExecArray | null;
  while ((bgMatch = bodyRuleRe.exec(aggregatedCss)) !== null) {
    const modifier = bgMatch[2].trim();
    // Reject `body.modal-open`, `html[dir=rtl]`, `body .nested`, `body:focus-within`, etc.
    if (modifier && !/^\s*$/.test(modifier)) continue;
    const ruleBody = bgMatch[3];
    const bgDecl = ruleBody.match(/background(?:-color)?\s*:\s*([^;}]+)/i);
    if (!bgDecl) continue;
    const norm = normalizeHex(bgDecl[1].trim());
    if (norm) candidateBgs.push(norm);
  }
  if (candidateBgs.length > 0) {
    // Prefer the highest-luminance candidate (the actual page background, not a dark overlay rule).
    candidateBgs.sort((a, b) => hexLuminance(b) - hexLuminance(a));
    background = candidateBgs[0];
  }

  const colors: SourceBrandColors = { ranked, primary, secondary, background };

  // ── Logo dominant-color override (vision) ──
  // CSS-only extraction misses raster logos. Ask GPT-4o-mini to read the
  // logo image and return its dominant brand hex. Falls open on any error.
  const logoUrlForVision = logo.original_icon_url || logo.original_url;
  if (opts?.openaiKey && logoUrlForVision) {
    const dominant = await extractLogoDominantColor(logoUrlForVision, opts.openaiKey);
    if (dominant && !isMonoHex(dominant)) {
      const oldPrimary = colors.primary;
      colors.primary = dominant;
      if (oldPrimary && oldPrimary.toLowerCase() !== dominant.toLowerCase()) {
        colors.secondary = oldPrimary;
      }
      warnings.push(
        `Logo dominant color (vision): ${dominant} (replaced CSS-derived ${oldPrimary || 'none'})`,
      );
    }
  }

  // ── Theme inference ──
  // Layered signals (in priority order):
  //   1. Detected page background → luminance > 0.5 = light, else dark.
  //   2. CMS bias: WordPress/Squarespace/Webflow sites are light-themed by default
  //      unless the page background OR primary color BOTH suggest dark.
  //   3. Primary color luminance fallback: dark primary → light theme (dark-on-light).
  let theme: 'light' | 'dark' = 'light';
  if (background) {
    theme = hexLuminance(background) > 0.5 ? 'light' : 'dark';
  } else if (cms === 'wordpress' || cms === 'squarespace' || cms === 'webflow') {
    // WP/Squarespace/Webflow default to light unless primary color is mid-light (suggests dark theme accent on light brand).
    theme = !primary || hexLuminance(primary) < 0.6 ? 'light' : 'dark';
  } else if (primary) {
    theme = hexLuminance(primary) < 0.4 ? 'light' : 'dark';
  }

  // ── preserve_source_design: WordPress/Squarespace + non-trivial CSS suggests intentional design ──
  const preserve = cms === 'wordpress' || cms === 'squarespace' || cms === 'webflow' || aggregatedCss.length > 30_000;

  // ── Assets ──
  const imgAssets = extractImgSrcs(html, url);
  const cssBgAssets = extractBackgroundImages(aggregatedCss + '\n' + html, url);
  // Also include logo + icon as assets so they round-trip into _assets.json.original[].
  if (logo.original_url) imgAssets.push({ url: logo.original_url, origin: 'img', role: 'logo' });
  if (logo.original_icon_url) imgAssets.push({ url: logo.original_icon_url, origin: 'favicon', role: 'icon' });

  const assetMap = new Map<string, SourceBrandAsset>();
  for (const a of [...imgAssets, ...cssBgAssets]) {
    if (!assetMap.has(a.url)) assetMap.set(a.url, a);
  }
  const assets = Array.from(assetMap.values()).slice(0, 100);

  // ── Routes ──
  const routes = await discoverRoutes(url, html);

  // ── HTML excerpt for orchestrator (first 8KB, body-only when possible) ──
  const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const excerptSrc = bodyMatch ? bodyMatch[1] : html;
  const html_excerpt = excerptSrc.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').slice(0, 8_192);

  return {
    source_url: url,
    fetched_at: fetchedAt,
    theme,
    preserve_source_design: preserve,
    cms,
    fonts,
    logo,
    colors,
    assets,
    routes,
    html_excerpt,
    warnings,
  };
}

/**
 * Persist a {@link SourceBrand} record to R2 as the three canonical artifacts
 * the container orchestrator reads at boot, AND return the JSON strings so
 * they can be passed inline as `contextFiles` in the container's `/build`
 * payload — orchestrator reads them WITHOUT a second R2 round-trip
 * (containers have no R2 binding; round-tripping requires re-uploading
 * before container start, which is wasted bandwidth here).
 *
 * @param bucket - The `SITES_BUCKET` R2 binding. Writes are concurrent
 *   via `Promise.all` — partial failure (1 of 3 writes rejected) means the
 *   build proceeds on a mixed-state R2 and the orchestrator may pull a
 *   stale prior-iteration artifact for the missing key. Caller MUST catch
 *   rejections and either retry or fail the workflow step.
 * @param slug - Site slug from `sites.slug`. Used in R2 key prefix
 *   `sites/{slug}/assets/_*.json`. Slug is already URL-safe per
 *   D1 CHECK constraint, so no escaping required.
 * @param brand - The {@link SourceBrand} record produced by
 *   {@link extractSourceBrand}. Passed by value; not mutated.
 *
 * @returns Three pretty-printed (`null, 2` indent) JSON strings — same
 *   bytes written to R2. Caller forwards them as `contextFiles` entries
 *   `{ path: '_brand.json', content: brandJson }` etc.
 *
 * @remarks
 * Artifact shapes (consumed by skill 15 + orchestrator subagents):
 * - `_brand.json` — full {@link SourceBrand} record verbatim.
 * - `_assets.json` — `{ original: SourceBrandAsset[], augmented: [],
 *   summary: { original_count, target_min, target_max } }` where
 *   `target_min = ceil(original * 1.4)` and `target_max = ceil(original * 2.0)`
 *   enforces the Media Augmentation 1.4–2.0× build-breaking invariant
 *   (validator-fixer rejects builds with `augmented.length < original * 0.4`).
 *   The `augmented[]` array stays empty here — image_discovery service
 *   populates it during step 2.5 BEFORE container hand-off.
 * - `_scraped_content.json` — `{ source_url, cms, routes, homepage_html_excerpt }`.
 *   Feeds the deep-crawl + route-recreation invariant (page count = source
 *   sitemap, 1:N up to 1000 routes).
 *
 * All three are written with `httpMetadata.contentType = 'application/json'`
 * so a future `site_serving` route GET of these debug paths returns the
 * right content-type to a curl-debugging Brian without extra header massage.
 *
 * @throws Will reject if any of the three R2 writes throw (network, quota,
 *   bucket missing). `Promise.all` propagates the first rejection — the
 *   other writes may or may not have completed by then. Caller MUST treat
 *   this as a workflow step failure and retry; partial writes are tolerated
 *   on retry because the keys are deterministic + idempotent.
 *
 * @example
 * ```ts
 * const brand = await extractSourceBrand(site.source_url, { openaiKey });
 * const { brandJson, assetsJson, scrapedJson } = await persistSourceBrand(
 *   env.SITES_BUCKET,
 *   site.slug,
 *   brand,
 * );
 *
 * // Hand off to container without a second R2 round-trip
 * await containerStub.fetch('http://container/build', {
 *   method: 'POST',
 *   body: JSON.stringify({
 *     prompts: [...],
 *     contextFiles: [
 *       { path: '_brand.json', content: brandJson },
 *       { path: '_assets.json', content: assetsJson },
 *       { path: '_scraped_content.json', content: scrapedJson },
 *     ],
 *   }),
 * });
 * ```
 *
 * @see {@link extractSourceBrand} for upstream extraction.
 * @see {@link SourceBrand} for the artifact schema.
 */
export async function persistSourceBrand(
  bucket: R2Bucket,
  slug: string,
  brand: SourceBrand,
): Promise<{ brandJson: string; assetsJson: string; scrapedJson: string }> {
  const brandJson = JSON.stringify(brand, null, 2);
  const assetsJson = JSON.stringify(
    {
      original: brand.assets,
      augmented: [],
      summary: {
        original_count: brand.assets.length,
        target_min: Math.ceil(brand.assets.length * 1.4),
        target_max: Math.ceil(brand.assets.length * 2.0),
      },
    },
    null,
    2,
  );
  const scrapedJson = JSON.stringify(
    {
      source_url: brand.source_url,
      cms: brand.cms,
      routes: brand.routes,
      homepage_html_excerpt: brand.html_excerpt,
    },
    null,
    2,
  );

  const headers = { httpMetadata: { contentType: 'application/json' } };
  await Promise.all([
    bucket.put(`sites/${slug}/assets/_brand.json`, brandJson, headers),
    bucket.put(`sites/${slug}/assets/_assets.json`, assetsJson, headers),
    bucket.put(`sites/${slug}/assets/_scraped_content.json`, scrapedJson, headers),
  ]);

  return { brandJson, assetsJson, scrapedJson };
}
