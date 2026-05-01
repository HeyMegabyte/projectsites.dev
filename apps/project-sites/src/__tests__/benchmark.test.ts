/**
 * Tests for the benchmark service. Pure-function HTML parser + tier wiring.
 * Network calls (PSI) are mocked.
 */

import { webcrypto } from 'node:crypto';
if (!globalThis.crypto?.subtle) {
  (globalThis as any).crypto = webcrypto;
}

import { parseHtmlForFindings, tierPsi, runBenchmarks } from '../services/benchmark.js';
import type { Env } from '../types/env.js';

const goodHtml = `<!doctype html>
<html>
<head>
  <title>Newark Soup Kitchen | Hot Meals & Volunteer Programs</title>
  <meta name="description" content="Newark Soup Kitchen serves 500 hot meals daily to neighbors in need. Volunteer, donate, or join our community programs supporting Newark families.">
  <meta name="color-scheme" content="dark light">
  <script type="application/ld+json">{"@type":"WebSite"}</script>
  <script type="application/ld+json">{"@type":"Organization"}</script>
  <script type="application/ld+json">{"@type":"WebPage"}</script>
  <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
</head>
<body>
  <h1>Newark Soup Kitchen</h1>
  ${Array.from({ length: 12 }, (_, i) => `<img src="/img${i}.jpg" alt="Photo ${i}">`).join('\n')}
  <a href="/about">About</a>
  <a href="/donate">Donate</a>
  <a href="https://example.org">Partner</a>
</body>
</html>`;

const badHtml = `<!doctype html>
<html>
<head><title>Short</title></head>
<body>
  <h1>One</h1>
  <h1>Two</h1>
  <img src="/x.jpg">
  <p>Our world-class platform will transform and revolutionize your business.</p>
</body>
</html>`;

describe('parseHtmlForFindings', () => {
  it('scores a well-formed page near 1.0', () => {
    const findings = parseHtmlForFindings(goodHtml, 'https://njsk.projectsites.dev');
    expect(findings.h1Count).toBe(1);
    expect(findings.jsonLdBlocks).toBe(4);
    expect(findings.titleLength).toBeGreaterThanOrEqual(50);
    expect(findings.titleLength).toBeLessThanOrEqual(60);
    expect(findings.metaDescriptionLength).toBeGreaterThanOrEqual(120);
    expect(findings.metaDescriptionLength).toBeLessThanOrEqual(156);
    expect(findings.hasColorScheme).toBe(true);
    expect(findings.imagesMissingAlt).toBe(0);
    expect(findings.imageCount).toBe(12);
    expect(findings.bannedWordHits).toEqual([]);
    expect(findings.score).toBeGreaterThanOrEqual(0.9);
  });

  it('penalizes a thin/banned-word page', () => {
    const findings = parseHtmlForFindings(badHtml, 'https://bad.projectsites.dev');
    expect(findings.h1Count).toBe(2);
    expect(findings.jsonLdBlocks).toBe(0);
    expect(findings.imagesMissingAlt).toBe(1);
    expect(findings.bannedWordHits).toEqual(expect.arrayContaining(['world-class', 'transform', 'revolutionize']));
    expect(findings.score).toBeLessThan(0.4);
  });

  it('counts internal vs external links by host match', () => {
    const findings = parseHtmlForFindings(goodHtml, 'https://njsk.projectsites.dev');
    expect(findings.internalLinks).toBe(2);
    expect(findings.externalLinks).toBe(1);
  });

  it('skips mailto/tel/fragment links', () => {
    const html = `<a href="#top">a</a><a href="mailto:x@y.com">b</a><a href="tel:555">c</a><a href="/x">d</a>`;
    const findings = parseHtmlForFindings(html, 'https://test.projectsites.dev');
    expect(findings.internalLinks).toBe(1);
    expect(findings.externalLinks).toBe(0);
  });
});

describe('tierPsi', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('parses category scores from PSI v5 response', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('pagespeedonline/v5/runPagespeed');
      expect(url).toContain('strategy=mobile');
      expect(url).toContain('key=fake-key');
      return new Response(JSON.stringify({
        lighthouseResult: {
          categories: {
            performance: { score: 0.92 },
            accessibility: { score: 0.97 },
            seo: { score: 0.95 },
            'best-practices': { score: 0.88 },
          },
        },
      }), { status: 200 });
    }) as typeof fetch;

    const psi = await tierPsi('https://njsk.projectsites.dev', 'fake-key');
    expect(psi.performance).toBe(0.92);
    expect(psi.accessibility).toBe(0.97);
    expect(psi.seo).toBe(0.95);
    expect(psi.bestPractices).toBe(0.88);
  });

  it('throws on non-200 response', async () => {
    globalThis.fetch = (async () => new Response('quota', { status: 429 })) as typeof fetch;
    await expect(tierPsi('https://x.projectsites.dev', undefined)).rejects.toThrow(/psi_failed/);
  });
});

describe('runBenchmarks', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  it('inserts a row and computes mean score across tiers', async () => {
    let inserted: Record<string, unknown> | null = null;

    const env = {
      DB: {
        prepare: (sql: string) => ({
          bind: (...params: unknown[]) => ({
            run: async () => {
              if (sql.includes('INSERT INTO site_benchmarks')) {
                const cols = sql.match(/\((.*?)\)/)?.[1].split(',').map((s) => s.trim()) || [];
                inserted = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
              }
              return { meta: { changes: 1 } };
            },
            first: async () => null,
            all: async () => ({ results: [] }),
          }),
        }),
      },
      PAGESPEED_API_KEY: 'fake-key',
    } as unknown as Env;

    let psiCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('pagespeedonline')) {
        psiCalls++;
        return new Response(JSON.stringify({
          lighthouseResult: { categories: {
            performance: { score: 0.9 },
            accessibility: { score: 1.0 },
            seo: { score: 0.95 },
            'best-practices': { score: 0.85 },
          } },
        }), { status: 200 });
      }
      return new Response(goodHtml, { status: 200 });
    }) as typeof fetch;

    const result = await runBenchmarks({
      env,
      siteId: 'site-abc',
      slug: 'njsk',
      siteUrl: 'https://njsk.projectsites.dev',
      previousMeanScore: 0.85,
    });

    expect(psiCalls).toBe(1);
    expect(result.programmatic.score).toBeGreaterThanOrEqual(0.9);
    expect(result.psi?.performance).toBe(0.9);
    expect(result.meanScore).toBeGreaterThan(0.85);
    expect(result.regressedFromPrevious).toBe(false);
    expect(inserted).not.toBeNull();
    expect((inserted as Record<string, unknown>).slug).toBe('njsk');
  });

  it('flags regression when score drops >0.1 from previous', async () => {
    const env = {
      DB: {
        prepare: () => ({
          bind: () => ({
            run: async () => ({ meta: { changes: 1 } }),
            first: async () => null,
            all: async () => ({ results: [] }),
          }),
        }),
      },
      PAGESPEED_API_KEY: undefined,
    } as unknown as Env;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('pagespeedonline')) {
        return new Response('fail', { status: 500 });
      }
      return new Response(badHtml, { status: 200 });
    }) as typeof fetch;

    const result = await runBenchmarks({
      env,
      siteId: 'site-xyz',
      slug: 'bad',
      siteUrl: 'https://bad.projectsites.dev',
      previousMeanScore: 0.9,
    });

    expect(result.psi).toBeNull();
    expect(result.meanScore).toBeLessThan(0.5);
    expect(result.regressedFromPrevious).toBe(true);
  });
});
