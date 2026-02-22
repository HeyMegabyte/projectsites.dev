/**
 * @module meta_tags.test
 * @description Tests for meta tag presence and correctness across all pages,
 * including the marketing homepage and color scheme consistency.
 *
 * Covers:
 * - Marketing homepage meta tag completeness
 * - Color scheme consistency (megabyte.space brand colors)
 * - Top bar accent color consistency
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateTopBar } from '../services/site_serving';

const PUBLIC_DIR = path.resolve(__dirname, '../../public');

// ─── Helper ────────────────────────────────────────────────────

function readPublicFile(filename: string): string {
  return fs.readFileSync(path.join(PUBLIC_DIR, filename), 'utf-8');
}

// ─── Marketing Homepage Meta Tags ──────────────────────────────

describe('Marketing Homepage Meta Tags', () => {
  let html: string;

  beforeAll(() => {
    html = readPublicFile('index.html');
  });

  it('has correct <title>', () => {
    expect(html).toContain('<title>Project Sites - Your Website, Handled. Finally.</title>');
  });

  it('has meta description', () => {
    expect(html).toContain('<meta name="description" content="AI-powered websites for small businesses');
  });

  it('has meta keywords', () => {
    expect(html).toContain('<meta name="keywords"');
    expect(html).toContain('AI website builder');
  });

  it('has meta author', () => {
    expect(html).toContain('<meta name="author" content="Brian Zalewski">');
  });

  it('has meta robots', () => {
    expect(html).toContain('<meta name="robots" content="index, follow">');
  });

  it('has canonical URL', () => {
    expect(html).toContain('<link rel="canonical" href="https://sites.megabyte.space/">');
  });

  // Open Graph
  it('has og:site_name', () => {
    expect(html).toContain('<meta property="og:site_name" content="Project Sites">');
  });

  it('has og:type', () => {
    expect(html).toContain('<meta property="og:type" content="website">');
  });

  it('has og:title', () => {
    expect(html).toContain('<meta property="og:title" content="Project Sites - Your Website, Handled. Finally.">');
  });

  it('has og:description', () => {
    expect(html).toMatch(/<meta property="og:description" content="[^"]+">/)
  });

  it('has og:image', () => {
    expect(html).toContain('<meta property="og:image" content="https://sites.megabyte.space/icon-512.png">');
  });

  it('has og:url', () => {
    expect(html).toContain('<meta property="og:url" content="https://sites.megabyte.space/">');
  });

  it('has al:web:url', () => {
    expect(html).toContain('<meta property="al:web:url" content="https://sites.megabyte.space/">');
  });

  // Twitter Card
  it('has twitter:card', () => {
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it('has twitter:site', () => {
    expect(html).toContain('<meta name="twitter:site" content="@MegabyteLabs">');
  });

  it('has twitter:creator', () => {
    expect(html).toContain('<meta name="twitter:creator" content="@MegabyteLabs">');
  });

  it('has twitter:title', () => {
    expect(html).toContain('<meta name="twitter:title" content="Project Sites - Your Website, Handled. Finally.">');
  });

  it('has twitter:description', () => {
    expect(html).toMatch(/<meta name="twitter:description" content="[^"]+">/)
  });

  it('has twitter:image', () => {
    expect(html).toContain('<meta name="twitter:image" content="https://sites.megabyte.space/icon-512.png">');
  });

  // PWA
  it('has manifest', () => {
    expect(html).toContain('<link rel="manifest" href="/site.webmanifest">');
  });

  it('has mobile-web-app-capable', () => {
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes">');
  });

  it('has apple-mobile-web-app-capable', () => {
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes">');
  });

  it('has theme-color', () => {
    expect(html).toContain('<meta name="theme-color" content="#0a0a1a">');
  });

  // Favicons
  it('has favicon.ico', () => {
    expect(html).toContain('rel="icon" href="/favicon.ico"');
  });

  it('has SVG icon', () => {
    expect(html).toContain('rel="icon" type="image/svg+xml" href="/logo-icon.svg"');
  });

  it('has apple-touch-icon', () => {
    expect(html).toContain('rel="apple-touch-icon"');
  });

  // JSON-LD
  it('has WebSite JSON-LD', () => {
    expect(html).toContain('"@type": "WebSite"');
    expect(html).toContain('"name": "Project Sites"');
  });

  it('has SoftwareApplication JSON-LD', () => {
    expect(html).toContain('"@type": ["SoftwareApplication", "WebApplication"]');
  });

  it('has Organization JSON-LD', () => {
    expect(html).toContain('"@type": "Organization"');
    expect(html).toContain('"name": "Megabyte Labs"');
  });

  // Font
  it('loads Inter font', () => {
    expect(html).toContain('fonts.googleapis.com/css2?family=Inter');
  });

  it('uses Inter as primary font family', () => {
    expect(html).toContain("--font: 'Inter'");
    expect(html).toContain('font-family: var(--font)');
  });

  // Preconnect
  it('has preconnect for Google Fonts', () => {
    expect(html).toContain('<link rel="preconnect" href="https://fonts.googleapis.com"');
    expect(html).toContain('<link rel="preconnect" href="https://fonts.gstatic.com"');
  });

  // PostHog placeholder
  it('has PostHog tracking script with meta key reader', () => {
    expect(html).toContain('x-posthog-key');
    expect(html).toContain('posthog.init');
  });

  // Contact form on homepage
  it('has contact form section on homepage', () => {
    expect(html).toContain('id="contact-section"');
    expect(html).toContain('id="contact-form"');
    expect(html).toContain('id="contact-name"');
    expect(html).toContain('id="contact-email"');
    expect(html).toContain('id="contact-message"');
  });

  it('has hey@megabyte.space as support email', () => {
    expect(html).toContain('hey@megabyte.space');
  });
});

// ─── Brand Color Consistency ───────────────────────────────────

describe('Brand Color Consistency', () => {
  it('homepage uses #50a5db accent (megabyte.space blue)', () => {
    const html = readPublicFile('index.html');
    expect(html).toContain('--accent: #50a5db');
  });

  it('homepage does not use old accent #64ffda', () => {
    const html = readPublicFile('index.html');
    expect(html).not.toContain('#64ffda');
  });

  it('homepage uses #4ade80 only for uploading status badge', () => {
    const html = readPublicFile('index.html');
    // #4ade80 is used for the uploading status color (green shade)
    const matches = html.match(/#4ade80/g) || [];
    expect(matches.length).toBeLessThanOrEqual(2); // Only in status CSS
  });

  it('homepage accent-dim uses rgba(80, 165, 219, ...)', () => {
    const html = readPublicFile('index.html');
    expect(html).toContain('rgba(80, 165, 219, 0.12)');
  });

  it('homepage accent-glow uses rgba(80, 165, 219, ...)', () => {
    const html = readPublicFile('index.html');
    expect(html).toContain('rgba(80, 165, 219, 0.25)');
  });

  it('homepage keeps dark background #0a0a1a', () => {
    const html = readPublicFile('index.html');
    expect(html).toContain('--bg-primary: #0a0a1a');
  });

  it('homepage keeps secondary color #7c3aed', () => {
    const html = readPublicFile('index.html');
    expect(html).toContain('--secondary: #7c3aed');
  });

  it('top bar uses #50a5db accent', () => {
    const topBar = generateTopBar('test-slug');
    expect(topBar).toContain('#50a5db');
    expect(topBar).not.toContain('#64ffda');
  });
});

// ─── Email Template Brand Colors ───────────────────────────────

describe('Email Template Brand Colors', () => {
  it('auth magic link email uses #50a5db accent', () => {
    // Read the auth service to verify color usage
    const authTs = fs.readFileSync(
      path.resolve(__dirname, '../services/auth.ts'),
      'utf-8',
    );
    expect(authTs).toContain('#50a5db');
    expect(authTs).not.toContain('#64ffda');
  });

  it('contact email templates use #50a5db accent', () => {
    const contactTs = fs.readFileSync(
      path.resolve(__dirname, '../services/contact.ts'),
      'utf-8',
    );
    expect(contactTs).toContain('#50a5db');
    expect(contactTs).not.toContain('#64ffda');
  });
});
