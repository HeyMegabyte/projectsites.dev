import {
  validateAssetExistence,
  validateImageFormat,
  validateOgImage,
  validateAppleTouchIcon,
  validateMetaLengths,
  validateJsonLdCount,
  validateH1InShell,
  validateColorScheme,
  validateSitemapLastmod,
  validateBannedWords,
  validateJsBundleSize,
  validateLightboxPresence,
  validateRequiredFiles,
  validateRouteCount,
  validateRouteMetadata,
  validateInternalLinks,
  validateHtmlEntities,
  validateFaviconSet,
  validatePwaKit,
  validateJsonLdSchema,
  validateCitations,
  validateBrandColors,
  validateNapConsistency,
  validateTypography,
  validatePageCount,
  validateColorContrast,
  validateImageRelevance,
  validateSourceFidelity,
  validatePhotoAuthenticity,
  validateBuild,
  type BuildFile,
} from '../services/build_validators';

const html = (body: string, head = '') => `<!DOCTYPE html>
<html lang="en">
<head>
<title>Acme Bakery — Hand-Rolled Sourdough in Brooklyn NY</title>
<meta name="description" content="Hand-rolled sourdough, French pastries, and farm-to-table breakfasts. Order online for pickup or delivery throughout Brooklyn neighborhoods today.">
<meta name="color-scheme" content="dark light">
${head}
<script type="application/ld+json">{"@type":"WebSite"}</script>
<script type="application/ld+json">{"@type":"Organization"}</script>
<script type="application/ld+json">{"@type":"WebPage"}</script>
<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
</head>
<body>
<h1>Acme Bakery</h1>
${body}
</body>
</html>`;

/**
 * Emit the 25 head fields beyond the 3 baked into `html()` (title +
 * meta:description + meta:color-scheme) so a route satisfies all 28
 * REQUIRED_HEAD_FIELDS in the per-route-metadata gate.
 */
const fullMeta = (route: string, suffix = '') => `
<meta name="robots" content="index,follow,max-image-preview:large">
<meta name="theme-color" content="#0a0a1a">
<meta name="application-name" content="Acme Bakery">
<meta name="apple-mobile-web-app-title" content="Acme">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta property="og:type" content="website">
<meta property="og:title" content="Acme Bakery${suffix ? ' — ' + suffix : ''} OG">
<meta property="og:description" content="${suffix || 'Acme'} OG card — hand-rolled sourdough, French pastries, farm-to-table breakfasts in Brooklyn NY since 1992.">
<meta property="og:url" content="https://acme.test${route}">
<meta property="og:site_name" content="Acme Bakery">
<meta property="og:locale" content="en_US">
<meta property="og:image" content="https://acme.test/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="Acme Bakery storefront on Bedford Avenue Brooklyn NY">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Acme Bakery${suffix ? ' — ' + suffix : ''} TW">
<meta name="twitter:description" content="${suffix || 'Acme'} Twitter card — hand-rolled sourdough, French pastries, farm-to-table breakfasts in Brooklyn NY since 1992.">
<meta name="twitter:image" content="https://acme.test/og-image.png">
<meta name="twitter:image:alt" content="Acme Bakery storefront on Bedford Avenue Brooklyn NY">
<link rel="canonical" href="https://acme.test${route}">
<link rel="manifest" href="/site.webmanifest">
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
`;

/**
 * Build a per-route HTML page with a unique 50-60 char title, unique
 * 120-156 char description, the 25 fullMeta fields, 4 JSON-LD blocks,
 * exactly one <h1>, and a body slot.
 */
const routeHtml = (
  routeName: 'index' | 'about' | 'services' | 'contact',
  body = '',
): string => {
  const cfg = {
    index: {
      route: '/',
      title: 'Acme Bakery — Hand-Rolled Sourdough in Brooklyn NY',
      desc: 'Hand-rolled sourdough, French pastries, and farm-to-table breakfasts. Order online for pickup or delivery throughout Brooklyn neighborhoods today.',
      h1: 'Acme Bakery',
      ogSuffix: 'Home',
    },
    about: {
      route: '/about/',
      title: 'About Acme Bakery — Family-Owned Brooklyn NY Bakers',
      desc: 'Family-owned bakery serving Brooklyn since 1992. Meet the third-generation bakers, learn our sourdough story, and visit the Bedford Avenue counter today.',
      h1: 'About Us',
      ogSuffix: 'About',
    },
    services: {
      route: '/services/',
      title: 'Services at Acme Bakery — Bread, Pastry, Catering NYC',
      desc: 'Wholesale loaves, retail pastries, custom catering, and corporate breakfast delivery across Brooklyn and Manhattan. Book a tasting or order online today.',
      h1: 'Services',
      ogSuffix: 'Services',
    },
    contact: {
      route: '/contact/',
      title: 'Contact Acme Bakery — Hours, Address, Brooklyn NY 11211',
      desc: 'Visit Acme Bakery at 123 Bedford Avenue, Brooklyn NY 11211. Hours, phone, directions, and email contact form. Call (555) 123-4567 or stop by today.',
      h1: 'Contact',
      ogSuffix: 'Contact',
    },
  }[routeName];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<title>${cfg.title}</title>
<meta name="description" content="${cfg.desc}">
<meta name="color-scheme" content="dark light">
${fullMeta(cfg.route, cfg.ogSuffix)}
<script type="application/ld+json">{"@type":"WebSite","name":"Acme Bakery"}</script>
<script type="application/ld+json">{"@type":"Organization","name":"Acme Bakery"}</script>
<script type="application/ld+json">{"@type":"WebPage","name":"${cfg.h1}"}</script>
<script type="application/ld+json">{"@type":"BreadcrumbList","itemListElement":[]}</script>
</head>
<body>
<h1>${cfg.h1}</h1>
${body}
</body>
</html>`;
};

const file = (path: string, text?: string, size?: number): BuildFile => ({
  path,
  text,
  size: size ?? (text?.length ?? 0),
});

const completeBuild = (overrides: Partial<{ html: string; sitemap: string; bundleJs: string }> = {}): BuildFile[] => [
  file('index.html', overrides.html ?? routeHtml('index', '<img src="/hero.jpg" alt="Hero">')),
  file('about.html', routeHtml('about')),
  file('services.html', routeHtml('services')),
  file('contact.html', routeHtml('contact')),
  file('hero.jpg', undefined, 50000),
  file('og-image.png', undefined, 80000),
  file('apple-touch-icon.png', undefined, 5000),
  file('favicon.ico', undefined, 1000),
  file('favicon-16x16.png', undefined, 500),
  file('favicon-32x32.png', undefined, 800),
  file('favicon-48x48.png', undefined, 900),
  file('android-chrome-192x192.png', undefined, 8000),
  file('android-chrome-512x512.png', undefined, 30000),
  file('mstile-150x150.png', undefined, 5000),
  file('safari-pinned-tab.svg', '<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  file('site.webmanifest', '{}'),
  file('browserconfig.xml', '<?xml version="1.0"?><browserconfig/>'),
  file('robots.txt', 'User-agent: *'),
  file('humans.txt', 'Team: Acme'),
  file('sitemap.xml', overrides.sitemap ?? '<urlset><url><loc>https://acme.test/</loc><lastmod>2026-01-01</lastmod></url></urlset>'),
  file('.well-known/security.txt', 'Contact: mailto:security@acme.test'),
  file('sw.js', 'self.addEventListener("install", () => {});'),
  file('offline.html', '<!DOCTYPE html><html><head><title>Offline</title></head><body>Offline</body></html>'),
  file('assets/index-abc.js', overrides.bundleJs ?? 'const x = "data-zoomable"; const y = "data-gallery";'),
];

describe('validateAssetExistence', () => {
  it('flags missing internal references', () => {
    const files = [
      file('index.html', html('<img src="/missing.png" alt="x">')),
    ];
    const v = validateAssetExistence(files);
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('asset.missing');
  });

  it('passes when referenced files exist', () => {
    const files = [
      file('index.html', html('<img src="/hero.jpg" alt="x">')),
      file('hero.jpg', undefined, 1000),
    ];
    expect(validateAssetExistence(files)).toEqual([]);
  });

  it('warns on non-allowlisted external host', () => {
    const files = [file('index.html', html('<img src="https://evil.example/x.png" alt="x">'))];
    const v = validateAssetExistence(files);
    expect(v[0].code).toBe('asset.external_host_not_allowed');
  });

  it('allows allowlisted external hosts', () => {
    const files = [file('index.html', html('<img src="https://images.unsplash.com/p.jpg" alt="x">'))];
    expect(validateAssetExistence(files)).toEqual([]);
  });
});

describe('validateImageFormat', () => {
  it('flags PNG > 200KB', () => {
    const v = validateImageFormat([file('hero.png', undefined, 300 * 1024)]);
    expect(v[0].code).toBe('image.png_too_large');
  });

  it('exempts favicon paths', () => {
    expect(validateImageFormat([file('apple-touch-icon.png', undefined, 300 * 1024)])).toEqual([]);
  });

  it('passes small PNGs', () => {
    expect(validateImageFormat([file('logo.png', undefined, 50 * 1024)])).toEqual([]);
  });
});

describe('validateOgImage', () => {
  it('flags missing og-image', () => {
    expect(validateOgImage([])[0].code).toBe('og.missing');
  });

  it('flags og-image > 100KB', () => {
    const v = validateOgImage([file('og-image.png', undefined, 200 * 1024)]);
    expect(v[0].code).toBe('og.too_large');
  });

  it('passes branded og-image ≤ 100KB', () => {
    expect(validateOgImage([file('og-image.png', undefined, 50 * 1024)])).toEqual([]);
  });
});

describe('validateAppleTouchIcon', () => {
  it('flags missing icon', () => {
    expect(validateAppleTouchIcon([])[0].code).toBe('icon.apple_touch_missing');
  });

  it('passes when present', () => {
    expect(validateAppleTouchIcon([file('apple-touch-icon.png', undefined, 5000)])).toEqual([]);
  });
});

describe('validateMetaLengths', () => {
  it('flags short title', () => {
    const f = [file('index.html', '<!DOCTYPE html><html><head><title>Short</title><meta name="description" content="' + 'x'.repeat(140) + '"></head><body></body></html>')];
    const v = validateMetaLengths(f);
    expect(v.some(x => x.code === 'meta.title_length')).toBe(true);
  });

  it('flags short description', () => {
    const f = [file('index.html', '<!DOCTYPE html><html><head><title>' + 'x'.repeat(55) + '</title><meta name="description" content="too short"></head><body></body></html>')];
    const v = validateMetaLengths(f);
    expect(v.some(x => x.code === 'meta.description_length')).toBe(true);
  });

  it('passes valid lengths', () => {
    expect(validateMetaLengths([file('index.html', html(''))])).toEqual([]);
  });
});

describe('validateJsonLdCount', () => {
  it('flags fewer than 4 blocks', () => {
    const partial = '<!DOCTYPE html><html><head><title>' + 'x'.repeat(55) + '</title><meta name="description" content="' + 'x'.repeat(140) + '"><script type="application/ld+json">{}</script></head><body><h1>x</h1></body></html>';
    const v = validateJsonLdCount([file('index.html', partial)]);
    expect(v[0].code).toBe('jsonld.count_below_threshold');
  });

  it('passes when 4+ blocks present', () => {
    expect(validateJsonLdCount([file('index.html', html(''))])).toEqual([]);
  });
});

describe('validateH1InShell', () => {
  it('flags missing h1', () => {
    const f = file('index.html', '<!DOCTYPE html><html><head><title>x</title></head><body><h2>nope</h2></body></html>');
    expect(validateH1InShell([f])[0].code).toBe('html.h1_count');
  });

  it('flags multiple h1s', () => {
    const f = file('index.html', '<!DOCTYPE html><html><head><title>x</title></head><body><h1>a</h1><h1>b</h1></body></html>');
    expect(validateH1InShell([f])[0].code).toBe('html.h1_count');
  });

  it('ignores h1 inside script tags', () => {
    const f = file('index.html', '<!DOCTYPE html><html><head><title>x</title></head><body><h1>real</h1><script>const s = "<h1>fake</h1>"</script></body></html>');
    expect(validateH1InShell([f])).toEqual([]);
  });
});

describe('validateColorScheme', () => {
  it('warns when missing', () => {
    const f = file('index.html', '<!DOCTYPE html><html><head><title>x</title></head><body></body></html>');
    expect(validateColorScheme([f])[0].code).toBe('meta.color_scheme_missing');
  });

  it('passes when present', () => {
    const f = file('index.html', '<!DOCTYPE html><html><head><meta name="color-scheme" content="dark"><title>x</title></head><body></body></html>');
    expect(validateColorScheme([f])).toEqual([]);
  });
});

describe('validateSitemapLastmod', () => {
  it('flags url without lastmod', () => {
    const f = [file('sitemap.xml', '<urlset><url><loc>https://x.test/</loc></url></urlset>')];
    expect(validateSitemapLastmod(f)[0].code).toBe('sitemap.missing_lastmod');
  });

  it('flags missing sitemap', () => {
    expect(validateSitemapLastmod([])[0].code).toBe('sitemap.missing');
  });

  it('passes when every url has lastmod', () => {
    const f = [file('sitemap.xml', '<urlset><url><loc>https://x.test/</loc><lastmod>2026-01-01</lastmod></url></urlset>')];
    expect(validateSitemapLastmod(f)).toEqual([]);
  });
});

describe('validateBannedWords', () => {
  it('flags banned slop words', () => {
    const f = file('index.html', html('<p>Our limitless cutting-edge platform.</p>'));
    const v = validateBannedWords([f]);
    expect(v.length).toBeGreaterThanOrEqual(2);
    expect(v.map(x => x.code)).toContain('copy.banned_word');
  });

  it('passes clean copy', () => {
    expect(validateBannedWords([file('index.html', html('<p>Hand-rolled sourdough since 1992.</p>'))])).toEqual([]);
  });
});

describe('validateJsBundleSize', () => {
  it('flags huge chunks', () => {
    const v = validateJsBundleSize([file('assets/big.js', 'x', 800 * 1024)]);
    expect(v[0].code).toBe('js.chunk_too_large');
  });

  it('passes small chunks', () => {
    expect(validateJsBundleSize([file('assets/small.js', 'x', 100 * 1024)])).toEqual([]);
  });
});

describe('validateLightboxPresence', () => {
  it('flags missing markers', () => {
    const v = validateLightboxPresence([file('assets/i.js', 'const x = 1;')]);
    expect(v.map(x => x.code)).toEqual(
      expect.arrayContaining(['lightbox.zoomable_missing', 'lightbox.gallery_missing']),
    );
  });

  it('passes when both markers present', () => {
    const v = validateLightboxPresence([file('assets/i.js', '"data-zoomable" + "data-gallery"')]);
    expect(v).toEqual([]);
  });
});

describe('validateRequiredFiles', () => {
  it('flags missing required files', () => {
    const v = validateRequiredFiles([file('index.html', '')]);
    expect(v.length).toBeGreaterThan(5);
    expect(v[0].code).toBe('manifest.required_file_missing');
  });
});

describe('validateRouteCount', () => {
  const route = (path: string) => file(path, '<html></html>');

  it('skips check for thin sources (<4 routes)', () => {
    const v = validateRouteCount([route('index.html')], 1);
    expect(v).toEqual([]);
  });

  it('flags undersized rebuild against rich source', () => {
    const v = validateRouteCount(
      [route('index.html'), route('about.html'), route('services.html'), route('contact.html')],
      80,
    );
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe('route.count_below_source_count');
    expect(v[0].severity).toBe('error');
    expect(v[0].message).toContain('80');
  });

  it('passes when built count meets source count', () => {
    const files = Array.from({ length: 12 }, (_, i) => route(`page-${i}.html`));
    const v = validateRouteCount(files, 12);
    expect(v).toEqual([]);
  });

  it('clamps source count at 1000 ceiling', () => {
    const files = Array.from({ length: 1000 }, (_, i) => route(`page-${i}.html`));
    const v = validateRouteCount(files, 5000);
    expect(v).toEqual([]);
  });

  it('ignores 404/500/offline error pages', () => {
    const v = validateRouteCount(
      [
        route('index.html'),
        route('about.html'),
        route('services.html'),
        route('contact.html'),
        route('404.html'),
        route('500.html'),
        route('offline.html'),
      ],
      4,
    );
    expect(v).toEqual([]);
  });
});

describe('validateRouteMetadata', () => {
  it('flags every missing required field', () => {
    const stripped = '<!DOCTYPE html><html><head><title>x</title></head><body><h1>x</h1></body></html>';
    const v = validateRouteMetadata([file('index.html', stripped)]);
    const codes = v.map(x => x.code);
    expect(codes).toContain('meta.field_missing');
    expect(v.filter(x => x.code === 'meta.field_missing').length).toBeGreaterThan(20);
  });

  it('flags duplicate title across routes', () => {
    const v = validateRouteMetadata([
      file('index.html', routeHtml('index')),
      file('about.html', routeHtml('index')),
    ]);
    expect(v.some(x => x.code === 'meta.duplicate_across_routes')).toBe(true);
  });

  it('passes when every field present and unique across 4 routes', () => {
    const v = validateRouteMetadata([
      file('index.html', routeHtml('index')),
      file('about.html', routeHtml('about')),
      file('services.html', routeHtml('services')),
      file('contact.html', routeHtml('contact')),
    ]);
    expect(v).toEqual([]);
  });

  it('case-insensitive whitespace-normalized uniqueness hash', () => {
    const a = routeHtml('index').replace('Acme Bakery — Hand-Rolled Sourdough in Brooklyn NY', 'Acme Bakery — Hand-Rolled Sourdough in Brooklyn NY');
    const b = routeHtml('about').replace('About Acme Bakery — Family-Owned Brooklyn NY Bakers', '  Acme Bakery   —   Hand-Rolled Sourdough in Brooklyn NY  ');
    const v = validateRouteMetadata([file('index.html', a), file('about.html', b)]);
    expect(v.some(x => x.code === 'meta.duplicate_across_routes')).toBe(true);
  });
});

describe('validateInternalLinks', () => {
  it('flags anchor to unknown route', () => {
    const v = validateInternalLinks([
      file('index.html', routeHtml('index', '<a href="/nonexistent/">Bad</a>')),
    ]);
    expect(v[0].code).toBe('link.unknown_route');
  });

  it('passes when anchor matches a known route from build', () => {
    const v = validateInternalLinks([
      file('index.html', routeHtml('index', '<a href="/about/">About</a>')),
      file('about.html', routeHtml('about')),
    ]);
    expect(v).toEqual([]);
  });

  it('respects opts.knownRoutes override', () => {
    const v = validateInternalLinks(
      [file('index.html', routeHtml('index', '<a href="/blog/">Blog</a>'))],
      { knownRoutes: ['/blog/', '/blog'] },
    );
    expect(v).toEqual([]);
  });

  it('ignores fragment-only and external anchors', () => {
    const v = validateInternalLinks([
      file('index.html', routeHtml('index', '<a href="#section">x</a><a href="https://example.com">ext</a><a href="mailto:hi@x.test">email</a>')),
    ]);
    expect(v).toEqual([]);
  });
});

describe('validateHtmlEntities', () => {
  it('flags forbidden entities in HTML body', () => {
    const v = validateHtmlEntities([
      file('index.html', routeHtml('index', '<p>It&apos;s great&hellip;</p>')),
    ]);
    expect(v[0].code).toBe('html.entity_in_source');
  });

  it('strips scripts and styles before grepping', () => {
    const v = validateHtmlEntities([
      file('index.html', routeHtml('index', '<script>const s = "&amp;";</script><style>.x::before { content: "&hellip;"; }</style>')),
    ]);
    expect(v).toEqual([]);
  });

  it('passes raw Unicode body', () => {
    const v = validateHtmlEntities([
      file('index.html', routeHtml('index', '<p>It’s great…</p>')),
    ]);
    expect(v).toEqual([]);
  });
});

describe('validateFaviconSet', () => {
  it('flags every missing RFG file', () => {
    const v = validateFaviconSet([file('favicon.ico', undefined, 1000)]);
    const paths = v.map(x => x.message);
    expect(v.length).toBe(10);
    expect(paths.some(m => m.includes('favicon-16x16.png'))).toBe(true);
    expect(paths.some(m => m.includes('android-chrome-512x512.png'))).toBe(true);
    expect(paths.some(m => m.includes('safari-pinned-tab.svg'))).toBe(true);
    expect(paths.some(m => m.includes('site.webmanifest'))).toBe(true);
  });

  it('passes when full 11-file manifest present', () => {
    const v = validateFaviconSet([
      file('favicon.ico'),
      file('favicon-16x16.png'),
      file('favicon-32x32.png'),
      file('favicon-48x48.png'),
      file('apple-touch-icon.png'),
      file('android-chrome-192x192.png'),
      file('android-chrome-512x512.png'),
      file('mstile-150x150.png'),
      file('safari-pinned-tab.svg'),
      file('site.webmanifest'),
      file('browserconfig.xml'),
    ]);
    expect(v).toEqual([]);
  });
});

describe('validatePwaKit', () => {
  it('flags missing manifest, sw, offline', () => {
    const v = validatePwaKit([]);
    const codes = v.map(x => x.code);
    expect(codes).toEqual(
      expect.arrayContaining(['pwa.manifest_missing', 'pwa.sw_missing', 'pwa.offline_missing']),
    );
  });

  it('accepts service-worker.js as alias for sw.js', () => {
    const v = validatePwaKit([
      file('site.webmanifest', '{}'),
      file('service-worker.js', ''),
      file('offline.html', ''),
    ]);
    expect(v).toEqual([]);
  });

  it('passes when full kit present', () => {
    const v = validatePwaKit([
      file('site.webmanifest', '{}'),
      file('sw.js', ''),
      file('offline.html', ''),
    ]);
    expect(v).toEqual([]);
  });
});

describe('validateJsonLdSchema', () => {
  it('flags malformed JSON-LD body', () => {
    const broken = '<!DOCTYPE html><html><head><title>x</title><script type="application/ld+json">{ broken json }</script></head><body></body></html>';
    const v = validateJsonLdSchema([file('index.html', broken)]);
    expect(v[0].code).toBe('jsonld.malformed');
  });

  it('flags non-object JSON-LD bodies', () => {
    const ok = '<!DOCTYPE html><html><head><title>x</title><script type="application/ld+json">"just-a-string"</script></head><body></body></html>';
    const v = validateJsonLdSchema([file('index.html', ok)]);
    expect(v[0].code).toBe('jsonld.malformed');
  });

  it('passes valid JSON-LD bodies', () => {
    expect(validateJsonLdSchema([file('index.html', html(''))])).toEqual([]);
  });
});

describe('validateCitations', () => {
  it('warns on unsourced percent claim', () => {
    const v = validateCitations([
      file('index.html', routeHtml('index', '<p>We help 90% of customers ship faster.</p>')),
    ]);
    expect(v[0].code).toBe('citation.unsourced_claim');
    expect(v[0].severity).toBe('warn');
  });

  it('warns on unsourced dollar amount', () => {
    const v = validateCitations([
      file('index.html', routeHtml('index', '<p>Average savings of $500K per quarter for clients.</p>')),
    ]);
    expect(v.some(x => x.code === 'citation.unsourced_claim')).toBe(true);
  });

  it('passes when claim has APA citation in window', () => {
    const v = validateCitations([
      file('index.html', routeHtml('index', '<p>Studies report 40% reduction in churn (Smith, 2024).</p>')),
    ]);
    expect(v).toEqual([]);
  });

  it('accepts (Author et al., Year) variant', () => {
    const v = validateCitations([
      file('index.html', routeHtml('index', '<p>Conversion lifted 25% across cohorts (Brewer et al., 2024).</p>')),
    ]);
    expect(v).toEqual([]);
  });
});

describe('validateBrandColors', () => {
  it('skips when no brandJson supplied', () => {
    expect(validateBrandColors(completeBuild())).toEqual([]);
  });

  it('skips when primary missing from brandJson', () => {
    expect(validateBrandColors(completeBuild(), { brandJson: {} })).toEqual([]);
  });

  it('flags ΔE drift > 5 from primary', () => {
    const builds = [
      file('index.html', routeHtml('index')),
      file('assets/style.css', '.btn { background: #00ff00; color: #ffffff; }'),
    ];
    const v = validateBrandColors(builds, { brandJson: { primary: '#ff0000' } });
    expect(v[0].code).toBe('brand.color_drift');
  });

  it('passes when rendered hex is within ΔE ≤ 5 of primary', () => {
    const builds = [
      file('index.html', routeHtml('index')),
      file('assets/style.css', '.btn { background: #ff0001; color: #ffffff; }'),
    ];
    const v = validateBrandColors(builds, { brandJson: { primary: '#ff0000' } });
    expect(v).toEqual([]);
  });
});

describe('validateNapConsistency', () => {
  const research = {
    business: {
      name: 'Acme Bakery',
      formatted_address: '123 Bedford Avenue, Brooklyn NY 11211',
      formatted_phone_number: '(555) 123-4567',
    },
  };

  it('skips when researchJson.business undefined', () => {
    expect(validateNapConsistency(completeBuild())).toEqual([]);
  });

  it('flags page missing business name', () => {
    const v = validateNapConsistency(
      [file('index.html', '<!DOCTYPE html><html><head><title>x</title></head><body><p>5551234567</p></body></html>')],
      { researchJson: research },
    );
    expect(v.some(x => x.code === 'nap.inconsistent' && x.message.includes('name'))).toBe(true);
  });

  it('flags page missing phone digits', () => {
    const v = validateNapConsistency(
      [file('index.html', '<!DOCTYPE html><html><head><title>x</title></head><body><p>Acme Bakery rocks.</p></body></html>')],
      { researchJson: research },
    );
    expect(v.some(x => x.code === 'nap.inconsistent' && x.message.toLowerCase().includes('phone'))).toBe(true);
  });

  it('passes when name + phone digits both appear (any format)', () => {
    const v = validateNapConsistency(
      [file('index.html', '<!DOCTYPE html><html><head><title>x</title></head><body><p>Acme Bakery — 555-123-4567</p></body></html>')],
      { researchJson: research },
    );
    expect(v).toEqual([]);
  });
});

describe('validateTypography', () => {
  it('skips when fonts undefined', () => {
    expect(validateTypography(completeBuild())).toEqual([]);
  });

  it('flags missing brand font from CSS/HTML/JS cascade', () => {
    const v = validateTypography(
      [
        file('index.html', routeHtml('index')),
        file('assets/style.css', 'body { font-family: Inter, system-ui; }'),
      ],
      { brandJson: { fonts: { heading: 'Poppins', body: 'Hind' } } },
    );
    const fonts = v.map(x => x.detail);
    expect(v.length).toBe(2);
    expect(fonts).toEqual(expect.arrayContaining(['Poppins', 'Hind']));
  });

  it('passes when both heading + body fonts appear in cascade', () => {
    const v = validateTypography(
      [
        file('index.html', routeHtml('index')),
        file('assets/style.css', '@import url(https://fonts.googleapis.com/css2?family=Poppins&family=Hind);'),
      ],
      { brandJson: { fonts: { heading: 'Poppins', body: 'Hind' } } },
    );
    expect(v).toEqual([]);
  });
});

describe('validatePageCount', () => {
  it('flags fewer than 4 user-facing routes', () => {
    const v = validatePageCount([
      file('index.html', ''),
      file('about.html', ''),
    ]);
    expect(v[0].code).toBe('page.count_below_floor');
  });

  it('does not count 404/500/offline/admin', () => {
    const v = validatePageCount([
      file('index.html', ''),
      file('404.html', ''),
      file('500.html', ''),
      file('offline.html', ''),
      file('admin/index.html', ''),
    ]);
    expect(v[0].code).toBe('page.count_below_floor');
  });

  it('passes at exactly 4 routes', () => {
    const v = validatePageCount([
      file('index.html', ''),
      file('about.html', ''),
      file('services.html', ''),
      file('contact.html', ''),
    ]);
    expect(v).toEqual([]);
  });
});

describe('validateColorContrast (info handoff)', () => {
  it('emits info for HTML files (handoff to a11y subagent)', () => {
    const v = validateColorContrast([file('index.html', html(''))]);
    expect(v[0].code).toBe('contrast.below_threshold_unverified');
    expect(v[0].severity).toBe('info');
  });

  it('no-ops when no HTML files', () => {
    expect(validateColorContrast([file('robots.txt', 'x')])).toEqual([]);
  });
});

describe('validateImageRelevance (info handoff)', () => {
  it('emits info for non-favicon non-og images', () => {
    const v = validateImageRelevance([file('hero.jpg', undefined, 1000)]);
    expect(v[0].code).toBe('image.relevance_unverified');
    expect(v[0].severity).toBe('info');
  });

  it('skips favicon and og-image paths', () => {
    expect(validateImageRelevance([
      file('favicon.ico', undefined, 1000),
      file('apple-touch-icon.png', undefined, 5000),
      file('og-image.png', undefined, 80000),
    ])).toEqual([]);
  });
});

describe('validateSourceFidelity (info handoff)', () => {
  it('emits info when _source_screenshot.png present', () => {
    const v = validateSourceFidelity([file('_source_screenshot.png', undefined, 200000)]);
    expect(v[0].code).toBe('fidelity.unverified');
    expect(v[0].severity).toBe('info');
  });

  it('no-ops on greenfield (no source screenshot)', () => {
    expect(validateSourceFidelity(completeBuild())).toEqual([]);
  });
});

describe('validatePhotoAuthenticity (info handoff)', () => {
  it('emits info for team/about/gallery images', () => {
    const v = validatePhotoAuthenticity([
      file('team/founder.jpg', undefined, 50000),
      file('about/storefront.webp', undefined, 60000),
      file('gallery/event-1.jpg', undefined, 70000),
    ]);
    expect(v[0].code).toBe('photo.authenticity_unverified');
    expect(v[0].severity).toBe('info');
    expect(v[0].detail).toContain('count=3');
  });

  it('no-ops when no team/about/gallery images', () => {
    expect(validatePhotoAuthenticity([file('hero.jpg', undefined, 50000)])).toEqual([]);
  });
});

describe('validateBuild (integration)', () => {
  it('passes a complete build', () => {
    const report = validateBuild(completeBuild());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('emits info-severity violations as handoff signals (does not fail build)', () => {
    const report = validateBuild(completeBuild());
    const codes = report.infos.map(i => i.code);
    expect(codes).toContain('contrast.below_threshold_unverified');
    expect(codes).toContain('image.relevance_unverified');
    expect(report.ok).toBe(true);
  });

  it('threads opts through to context-dependent validators', () => {
    const report = validateBuild(completeBuild(), {
      brandJson: { primary: '#ff0000', fonts: { heading: 'Poppins', body: 'Hind' } },
      researchJson: {
        business: {
          name: 'Acme Bakery',
          formatted_address: '123 Bedford Avenue, Brooklyn NY 11211',
          formatted_phone_number: '(555) 123-4567',
        },
      },
    });
    const codes = report.errors.map(e => e.code);
    expect(codes).toContain('brand.color_drift');
    expect(codes).toContain('typography.mismatch');
    expect(codes).toContain('nap.inconsistent');
  });

  it('aggregates errors across gates', () => {
    const broken = completeBuild({
      html: '<!DOCTYPE html><html><head><title>too short</title><meta name="description" content="also too short"></head><body></body></html>',
      sitemap: '<urlset><url><loc>https://x.test/</loc></url></urlset>',
      bundleJs: 'const x = 1;',
    });
    const report = validateBuild(broken);
    expect(report.ok).toBe(false);
    expect(report.errors.length).toBeGreaterThan(3);
    const codes = report.errors.map(e => e.code);
    expect(codes).toContain('meta.title_length');
    expect(codes).toContain('meta.description_length');
    expect(codes).toContain('jsonld.count_below_threshold');
    expect(codes).toContain('html.h1_count');
    expect(codes).toContain('sitemap.missing_lastmod');
    expect(codes).toContain('lightbox.zoomable_missing');
    expect(codes).toContain('lightbox.gallery_missing');
    expect(codes).toContain('meta.field_missing');
  });
});
