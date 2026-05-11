/**
 * @module __tests__/asset_migration
 * @description Regression tests for the URL filtering heuristic that drives
 * `migrateExternalAssets`. Original incident (2026-05-10) had the URL_PATTERN
 * matching XML namespaces, JSON-LD `@context`, and project homepage links — those
 * got rewritten into bogus `/assets/migrated/*.bin` paths, breaking inline SVGs,
 * structured data, and outbound links on the published LMG site. The filter must
 * keep image/font/css/js assets AND reject everything else.
 */
import { looksLikeAssetUrl } from '../services/asset_migration.js';

describe('looksLikeAssetUrl', () => {
  describe('accepts real asset URLs', () => {
    test.each([
      ['https://lonemountainglobal.com/wp-content/uploads/2024/03/logo-text-color.png'],
      ['https://lonemountainglobal.com/wp-content/uploads/2024/04/IMG_1497-1024x768.jpg'],
      ['https://example.com/assets/hero.webp'],
      ['https://example.com/images/team/founder.jpg'],
      ['https://example.com/static/media/bundle.abc123.js'],
      ['https://cdn.example.com/files/whitepaper.pdf'],
      ['https://example.com/fonts/inter-regular.woff2'],
      ['https://example.com/_next/static/chunks/main.js'],
      ['https://example.com/photos/2024/event.jpg'],
      ['https://example.com/uploads/banner.svg'],
      ['https://example.com/media/promo.mp4'],
    ])('accepts %s', (url) => {
      expect(looksLikeAssetUrl(url)).toBe(true);
    });
  });

  describe('rejects XML namespaces, JSON-LD @context, and other non-asset URLs', () => {
    test.each([
      ['http://www.w3.org/2000/svg'],
      ['http://www.w3.org/1999/xlink'],
      ['http://www.w3.org/XML/1998/namespace'],
      ['http://www.w3.org/1998/Math/MathML'],
      ['http://www.w3.org/1999/xhtml'],
      ['https://schema.org'],
      ['https://schema.org/'],
      ['http://www.sitemaps.org/schemas/sitemap/0.9'],
      ['https://lonemountainglobal.com'],
      ['https://lonemountainglobal.com/about/'],
      ['https://reactjs.org/docs/error-decoder.html?invariant=185'],
      ['https://photoswipe.com'],
      ['https://animate.style/'],
      ['http://opensource.org/licenses/MIT'],
      ['https://example.com'],
      ['https://example.com/services/consulting'],
      ['https://example.com/blog/2024-recap'],
    ])('rejects %s', (url) => {
      expect(looksLikeAssetUrl(url)).toBe(false);
    });
  });

  test('rejects malformed URLs without crashing', () => {
    expect(looksLikeAssetUrl('not-a-url')).toBe(false);
    expect(looksLikeAssetUrl('')).toBe(false);
    expect(looksLikeAssetUrl('http://')).toBe(false);
  });

  test('accepts .html only when under an asset path hint', () => {
    // /docs/foo.html is a doc bundle most likely → /assets/ prefix would catch it
    expect(looksLikeAssetUrl('https://example.com/assets/docs/manual.html')).toBe(true);
    // Plain page link: /about.html must be rejected (no asset hint, .html not an asset ext)
    expect(looksLikeAssetUrl('https://example.com/about.html')).toBe(false);
  });
});
