// Template-stub guard regex — guards against Claude orchestrator exiting fast
// without substituting placeholders. The regex below MUST stay in sync with the
// `stubMarkers` regex in container-server.mjs runJob() (lines ~440-460).
//
// Reference incident (2026-05-11): LMG site shipped 3 consecutive builds with
// literal `<title>{BUSINESS_NAME}</title>` in dist/index.html because the
// container only checked `distFiles.length > 0` and the workflow's validate-build
// step was in report-only mode. This guard fail-closes the build before R2 upload.
//
// Run: node --test scripts/__tests__/template_stub_guard.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

const STUB_MARKERS = /\{(BUSINESS_NAME|BUSINESS_SHORT_NAME|BUSINESS_DESCRIPTION|BUSINESS_ADDRESS|BUSINESS_PHONE|BUSINESS_EMAIL|BUSINESS_TAGLINE|BUSINESS_HOURS|BRAND_PRIMARY|BRAND_SECONDARY|BRAND_ACCENT|HERO_HEADLINE|HERO_SUBHEAD|CTA_PRIMARY|CTA_SECONDARY)\}/;

test('detects literal {BUSINESS_NAME} placeholder in title tag', () => {
  const html = '<!doctype html><html><head><title>{BUSINESS_NAME}</title></head></html>';
  assert.match(html, STUB_MARKERS);
});

test('detects {BUSINESS_DESCRIPTION} in meta description', () => {
  const html = '<meta name="description" content="{BUSINESS_DESCRIPTION}">';
  assert.match(html, STUB_MARKERS);
});

test('detects {BRAND_PRIMARY} in CSS', () => {
  const css = ':root { --primary: {BRAND_PRIMARY}; }';
  assert.match(css, STUB_MARKERS);
});

test('detects {HERO_HEADLINE} in body content', () => {
  const html = '<h1>{HERO_HEADLINE}</h1>';
  assert.match(html, STUB_MARKERS);
});

test('does NOT flag a real customized site', () => {
  const html = '<!doctype html><title>Lone Mountain Global — Consulting</title>';
  assert.doesNotMatch(html, STUB_MARKERS);
});

test('does NOT flag JS template literals with similar syntax', () => {
  // `${variable}` is JS interpolation, not our placeholder pattern
  const js = 'const greeting = `Hello ${user.name}`;';
  assert.doesNotMatch(js, STUB_MARKERS);
});

test('does NOT flag CSS custom properties', () => {
  const css = 'color: var(--brand-primary);';
  assert.doesNotMatch(css, STUB_MARKERS);
});

test('finds first matching marker for error message', () => {
  const html = '<title>{BUSINESS_NAME}</title><meta content="{BUSINESS_DESCRIPTION}">';
  const m = html.match(STUB_MARKERS);
  assert.ok(m);
  assert.equal(m[0], '{BUSINESS_NAME}');
});

test('covers all 15 documented placeholder names', () => {
  const placeholders = [
    'BUSINESS_NAME',
    'BUSINESS_SHORT_NAME',
    'BUSINESS_DESCRIPTION',
    'BUSINESS_ADDRESS',
    'BUSINESS_PHONE',
    'BUSINESS_EMAIL',
    'BUSINESS_TAGLINE',
    'BUSINESS_HOURS',
    'BRAND_PRIMARY',
    'BRAND_SECONDARY',
    'BRAND_ACCENT',
    'HERO_HEADLINE',
    'HERO_SUBHEAD',
    'CTA_PRIMARY',
    'CTA_SECONDARY',
  ];
  for (const name of placeholders) {
    assert.match(`{${name}}`, STUB_MARKERS, `expected to detect {${name}}`);
  }
});
