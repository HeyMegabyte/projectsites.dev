import { extractSourceBrand, persistSourceBrand } from '../services/source_brand_extractor.js';

type FetchResponse = {
  ok: boolean;
  status?: number;
  headers: Map<string, string>;
  text: () => Promise<string>;
};

function makeResponse(body: string, contentType = 'text/html'): FetchResponse {
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-type', contentType]]),
    text: async () => body,
  };
}

function notFound(): FetchResponse {
  return {
    ok: false,
    status: 404,
    headers: new Map(),
    text: async () => '',
  };
}

const HOMEPAGE_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Lone Mountain Global</title>
  <link rel="apple-touch-icon" href="/wp-content/uploads/apple-icon.png" sizes="180x180">
  <link rel="icon" href="/favicon.ico" sizes="32x32">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;700&family=Hind:wght@400;700&display=swap">
  <link rel="stylesheet" href="/wp-content/themes/lmg/style.css">
  <meta property="og:image" content="https://lonemountainglobal.com/wp-content/uploads/og.png">
</head>
<body>
  <header>
    <img src="/wp-content/uploads/logo-wordmark.svg" alt="Lone Mountain Global Logo" class="site-logo">
    <nav>
      <a href="/about">About</a>
      <a href="/services">Services</a>
      <a href="/contact">Contact</a>
      <a href="https://external.example.com">External</a>
      <a href="#anchor">Anchor</a>
    </nav>
  </header>
  <section class="hero">
    <img src="/wp-content/uploads/mountain-background-splash.png" alt="hero mountain" class="hero-img">
  </section>
  <section class="team">
    <img src="/wp-content/uploads/team-headshot-1.jpg" alt="team headshot">
  </section>
</body>
</html>`;

const STYLESHEET_CSS = `
body { background-color: #fafafa; color: #1a1a1a; font-family: "Hind", sans-serif; }
h1, h2, h3 { font-family: "Poppins", sans-serif; }
.btn-primary { background-color: #2c5f8f; }
.btn-secondary { background-color: #d97706; }
.hero { background-image: url('/wp-content/uploads/hero-bg.jpg'); }
.btn-primary:hover { background-color: #2c5f8f; }
.divider { background-color: #2c5f8f; }
`.repeat(2); // make CSS large enough to trip preserve_source_design

const SITEMAP_XML = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://lonemountainglobal.com/</loc></url>
  <url><loc>https://lonemountainglobal.com/about</loc></url>
  <url><loc>https://lonemountainglobal.com/services</loc></url>
</urlset>`;

function installFetchMock(routes: Record<string, FetchResponse>) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    return routes[url] ?? notFound();
  });
  // @ts-expect-error - assigning to global fetch
  global.fetch = fetchMock;
  return fetchMock;
}

describe('extractSourceBrand', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('extracts Google Fonts families (Poppins + Hind) from <link href>', async () => {
    installFetchMock({
      'https://lonemountainglobal.com': makeResponse(HOMEPAGE_HTML),
      'https://lonemountainglobal.com/wp-content/themes/lmg/style.css': makeResponse(
        STYLESHEET_CSS,
        'text/css',
      ),
      'https://lonemountainglobal.com/sitemap.xml': makeResponse(SITEMAP_XML, 'application/xml'),
    });

    const brand = await extractSourceBrand('lonemountainglobal.com');

    expect(brand.fonts.google_fonts).toEqual(expect.arrayContaining(['Poppins', 'Hind']));
    expect(brand.fonts.source).toBe('extracted');
    // heading should be one of the extracted Google fonts
    expect(['Poppins', 'Hind']).toContain(brand.fonts.heading);
  });

  it('picks header <img class="logo"> as wordmark over og:image fallback', async () => {
    installFetchMock({
      'https://lonemountainglobal.com': makeResponse(HOMEPAGE_HTML),
      'https://lonemountainglobal.com/wp-content/themes/lmg/style.css': makeResponse(
        STYLESHEET_CSS,
        'text/css',
      ),
    });

    const brand = await extractSourceBrand('lonemountainglobal.com');

    expect(brand.logo.original_url).toBe(
      'https://lonemountainglobal.com/wp-content/uploads/logo-wordmark.svg',
    );
    expect(brand.logo.source.wordmark).toBe('header_img');
    // apple-touch-icon link should win the icon slot
    expect(brand.logo.original_icon_url).toBe(
      'https://lonemountainglobal.com/wp-content/uploads/apple-icon.png',
    );
    expect(brand.logo.source.icon).toBe('apple_touch');
  });

  it('infers light theme from a light body background and high CSS volume preserves source design', async () => {
    installFetchMock({
      'https://lonemountainglobal.com': makeResponse(HOMEPAGE_HTML),
      'https://lonemountainglobal.com/wp-content/themes/lmg/style.css': makeResponse(
        STYLESHEET_CSS,
        'text/css',
      ),
    });

    const brand = await extractSourceBrand('lonemountainglobal.com');

    expect(brand.theme).toBe('light');
    expect(brand.cms).toBe('wordpress');
    expect(brand.preserve_source_design).toBe(true);
    expect(brand.colors.background).toBe('#fafafa');
    // brand color #2c5f8f appears 3 times in CSS, should rank first
    expect(brand.colors.primary).toBe('#2c5f8f');
  });

  it('discovers routes from sitemap.xml + nav anchors, dedupes, drops external hosts', async () => {
    installFetchMock({
      'https://lonemountainglobal.com': makeResponse(HOMEPAGE_HTML),
      'https://lonemountainglobal.com/wp-content/themes/lmg/style.css': makeResponse(
        STYLESHEET_CSS,
        'text/css',
      ),
      'https://lonemountainglobal.com/sitemap.xml': makeResponse(SITEMAP_XML, 'application/xml'),
    });

    const brand = await extractSourceBrand('lonemountainglobal.com');
    const urls = brand.routes.map((r) => r.url);

    expect(urls).toEqual(expect.arrayContaining([
      'https://lonemountainglobal.com/',
      'https://lonemountainglobal.com/about',
      'https://lonemountainglobal.com/services',
    ]));
    // No external host
    expect(urls.find((u) => u.includes('external.example.com'))).toBeUndefined();
    // No anchor-only links
    expect(urls.find((u) => u.endsWith('#anchor'))).toBeUndefined();
  });

  it('captures source <img> + CSS background-image assets with role hints', async () => {
    installFetchMock({
      'https://lonemountainglobal.com': makeResponse(HOMEPAGE_HTML),
      'https://lonemountainglobal.com/wp-content/themes/lmg/style.css': makeResponse(
        STYLESHEET_CSS,
        'text/css',
      ),
    });

    const brand = await extractSourceBrand('lonemountainglobal.com');
    const urls = brand.assets.map((a) => a.url);

    expect(urls).toEqual(expect.arrayContaining([
      'https://lonemountainglobal.com/wp-content/uploads/logo-wordmark.svg',
      'https://lonemountainglobal.com/wp-content/uploads/mountain-background-splash.png',
      'https://lonemountainglobal.com/wp-content/uploads/team-headshot-1.jpg',
      'https://lonemountainglobal.com/wp-content/uploads/hero-bg.jpg',
    ]));

    const team = brand.assets.find((a) => a.url.endsWith('team-headshot-1.jpg'));
    expect(team?.role).toBe('team');
    const logoAsset = brand.assets.find((a) => a.url.endsWith('logo-wordmark.svg'));
    expect(logoAsset?.role).toBe('logo');
  });

  it('returns safe defaults + warning when source URL fetch fails', async () => {
    installFetchMock({}); // every URL → 404

    const brand = await extractSourceBrand('does-not-exist.example');

    expect(brand.fonts.source).toBe('default');
    expect(brand.assets).toEqual([]);
    expect(brand.routes).toEqual([]);
    expect(brand.warnings.length).toBeGreaterThan(0);
    expect(brand.theme).toBe('light');
  });
});

describe('extractSourceBrand — LMG regression fixtures', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  // Real-world LMG-style markup: Font Awesome `var(--fa-style-family,...)` + Poppins/Hind
  // loaded via /css?family=Poppins:300,400|Hind:400 (pipe-delimited single param).
  const LMG_HOMEPAGE = `<!doctype html>
<html lang="en">
<head>
  <title>Lone Mountain Global</title>
  <link rel="apple-touch-icon" href="/wp-content/uploads/apple-icon.png" sizes="180x180">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Poppins:300,400,700|Hind:400,700&display=swap">
  <link rel="stylesheet" href="/wp-content/themes/lmg/style.css">
</head>
<body>
  <header><img src="/logo.svg" alt="Lone Mountain Global Logo" class="logo"></header>
</body>
</html>`;

  // CSS featuring all 3 LMG bug patterns:
  //   (a) `var(--fa-style-family,...)` Font Awesome leak
  //   (b) Modifier-scoped dark rules (`body.modal-open`, `body[data-theme=dark]`)
  //     mixed with the actual light page background on a bare `body { ... }` rule
  //   (c) Plugin/icon font names (fildisi-icons, vc_grid_v1) that aren't real typefaces
  const LMG_CSS = `
body { background-color: #fafafa; color: #1a1a1a; font-family: 'Hind', sans-serif; }
body.modal-open { background: #0a0a0a; overflow: hidden; }
body[data-theme="dark"] { background-color: #111111; }
h1, h2, h3 { font-family: 'Poppins', 'Helvetica Neue', sans-serif; }
.fa { font-family: var(--fa-style-family, "Font Awesome 6 Free"); }
.icon-fildisi { font-family: 'fildisi-icons'; }
.vc-grid { font-family: 'vc_grid_v1'; }
.btn { background-color: #2c5f8f; }
`.repeat(2);

  it('rejects var(--fa-style-family,...) and icon-font shims from heading/body inference', async () => {
    installFetchMock({
      'https://lonemountainglobal.com': makeResponse(LMG_HOMEPAGE),
      'https://lonemountainglobal.com/wp-content/themes/lmg/style.css': makeResponse(LMG_CSS, 'text/css'),
    });

    const brand = await extractSourceBrand('lonemountainglobal.com');

    // Heading + body must be real Google fonts, not CSS variable leaks or icon shims.
    expect(brand.fonts.heading).toBe('Poppins');
    expect(brand.fonts.body).toBe('Hind');
    expect(brand.fonts.body).not.toMatch(/^var\(/);
    expect(brand.fonts.body).not.toBe('fildisi-icons');
    expect(brand.fonts.body).not.toBe('vc_grid_v1');
    // observed[] may still contain the raw values for debugging, but heading/body must be clean.
  });

  it('parses pipe-delimited /css?family=Poppins|Hind URL into both google_fonts', async () => {
    installFetchMock({
      'https://lonemountainglobal.com': makeResponse(LMG_HOMEPAGE),
      'https://lonemountainglobal.com/wp-content/themes/lmg/style.css': makeResponse(LMG_CSS, 'text/css'),
    });

    const brand = await extractSourceBrand('lonemountainglobal.com');

    expect(brand.fonts.google_fonts).toEqual(expect.arrayContaining(['Poppins', 'Hind']));
    expect(brand.fonts.source).toBe('extracted');
  });

  it('infers LIGHT theme when bare body bg is light, ignoring modifier-scoped dark rules', async () => {
    installFetchMock({
      'https://lonemountainglobal.com': makeResponse(LMG_HOMEPAGE),
      'https://lonemountainglobal.com/wp-content/themes/lmg/style.css': makeResponse(LMG_CSS, 'text/css'),
    });

    const brand = await extractSourceBrand('lonemountainglobal.com');

    // The bare `body { background: #fafafa; }` is the real page bg — `body.modal-open` and
    // `body[data-theme=dark]` are utility/state rules that must not flip the inferred theme.
    expect(brand.colors.background).toBe('#fafafa');
    expect(brand.theme).toBe('light');
    expect(brand.cms).toBe('wordpress');
    expect(brand.preserve_source_design).toBe(true);
  });

  it('promotes observed Google-catalog fonts even without a fonts.googleapis.com link', async () => {
    // Self-hosted scenario: site uses Poppins + Hind via @font-face, no Google Fonts CDN link.
    const SELFHOST_HTML = `<!doctype html><html><head>
      <title>Self-host</title>
      <link rel="stylesheet" href="/wp-content/themes/lmg/style.css">
    </head><body></body></html>`;
    const SELFHOST_CSS = `
@font-face { font-family: 'Poppins'; src: url('/fonts/poppins.woff2') format('woff2'); }
@font-face { font-family: 'Hind'; src: url('/fonts/hind.woff2'); }
body { background: #ffffff; font-family: 'Hind', sans-serif; }
h1 { font-family: 'Poppins', sans-serif; }
`.repeat(2);

    installFetchMock({
      'https://lonemountainglobal.com': makeResponse(SELFHOST_HTML),
      'https://lonemountainglobal.com/wp-content/themes/lmg/style.css': makeResponse(SELFHOST_CSS, 'text/css'),
    });

    const brand = await extractSourceBrand('lonemountainglobal.com');

    // Even though no fonts.googleapis.com link present, Poppins + Hind in font-family
    // declarations match the known Google catalog and get promoted to google_fonts.
    expect(brand.fonts.google_fonts).toEqual(expect.arrayContaining(['Poppins', 'Hind']));
    expect(['Poppins', 'Hind']).toContain(brand.fonts.heading);
    expect(['Poppins', 'Hind']).toContain(brand.fonts.body);
  });
});

describe('persistSourceBrand', () => {
  it('writes _brand.json, _assets.json, and _scraped_content.json to R2', async () => {
    const put = jest.fn().mockResolvedValue(undefined);
    const bucket = { put } as unknown as R2Bucket;

    const result = await persistSourceBrand(bucket, 'lonemountainglobal', {
      source_url: 'https://lonemountainglobal.com',
      fetched_at: new Date().toISOString(),
      theme: 'light',
      preserve_source_design: true,
      cms: 'wordpress',
      fonts: { logo: 'Poppins', heading: 'Poppins', body: 'Hind', source: 'extracted', observed: [], google_fonts: ['Poppins', 'Hind'] },
      logo: { original_url: 'https://lonemountainglobal.com/logo.svg', source: { wordmark: 'header_img', icon: 'none' } },
      colors: { ranked: [{ hex: '#2c5f8f', count: 5 }], primary: '#2c5f8f' },
      assets: [{ url: 'https://lonemountainglobal.com/hero.jpg', origin: 'img', role: 'hero' }],
      routes: [{ url: 'https://lonemountainglobal.com/', source: 'sitemap' }],
      html_excerpt: '<header>...</header>',
      warnings: [],
    });

    expect(put).toHaveBeenCalledTimes(3);
    const keys = put.mock.calls.map((c) => c[0]);
    expect(keys).toEqual(expect.arrayContaining([
      'sites/lonemountainglobal/assets/_brand.json',
      'sites/lonemountainglobal/assets/_assets.json',
      'sites/lonemountainglobal/assets/_scraped_content.json',
    ]));

    // _assets.json should include augmentation targets
    const parsedAssets = JSON.parse(result.assetsJson);
    expect(parsedAssets.original).toHaveLength(1);
    expect(parsedAssets.summary.target_min).toBe(2); // ceil(1 * 1.4)
    expect(parsedAssets.summary.target_max).toBe(2); // ceil(1 * 2.0)
  });
});
