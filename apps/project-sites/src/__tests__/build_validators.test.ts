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

const file = (path: string, text?: string, size?: number): BuildFile => ({
  path,
  text,
  size: size ?? (text?.length ?? 0),
});

const completeBuild = (overrides: Partial<{ html: string; sitemap: string; bundleJs: string }> = {}): BuildFile[] => [
  file('index.html', overrides.html ?? html('<img src="/hero.jpg" alt="Hero">')),
  file('hero.jpg', undefined, 50000),
  file('og-image.png', undefined, 80000),
  file('apple-touch-icon.png', undefined, 5000),
  file('favicon.ico', undefined, 1000),
  file('favicon-16x16.png', undefined, 500),
  file('favicon-32x32.png', undefined, 800),
  file('site.webmanifest', '{}'),
  file('robots.txt', 'User-agent: *'),
  file('humans.txt', 'Team: Acme'),
  file('sitemap.xml', overrides.sitemap ?? '<urlset><url><loc>https://acme.test/</loc><lastmod>2026-01-01</lastmod></url></urlset>'),
  file('browserconfig.xml', '<?xml version="1.0"?><browserconfig/>'),
  file('.well-known/security.txt', 'Contact: mailto:security@acme.test'),
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

describe('validateBuild (integration)', () => {
  it('passes a complete build', () => {
    const report = validateBuild(completeBuild());
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
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
  });
});
