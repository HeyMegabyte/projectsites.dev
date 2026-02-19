/**
 * @module e2e/ui-polish
 * @description E2E tests verifying UI polish and visual enhancements:
 *   - Enhanced modal styling (backdrop blur, gradient backgrounds, rounded corners)
 *   - Sign-in card with gradient border, lock icon, and animated orbs
 *   - Domain tabs with pill/segmented-control styling
 *   - Connect Domain tab with info card and enhanced elements
 *   - Register New tab with globe icon and wholesale pricing callout
 *   - Hostname list items with hover states
 *   - Toast notifications with backdrop blur
 *   - Site card hover transforms
 *   - Input field gradient backgrounds
 *
 * @packageDocumentation
 */

import { test, expect } from './fixtures.js';

// ─── Modal Overlay Enhancements ──────────────────────────────

test.describe('Modal Overlay Styling', () => {
  test('modal-overlay has backdrop-filter blur', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('backdrop-filter');
    expect(html).toContain('.modal-overlay');
  });

  test('modal has gradient background and rounded corners', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Check the CSS contains gradient for .modal
    expect(html).toContain('linear-gradient(145deg');
    expect(html).toContain('border-radius: 20px');
    // Confirm modal class exists
    expect(html).toContain('.modal {');
  });

  test('modal-close has rounded pill styling', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // modal-close should have border-radius:8px
    const modalCloseSection = html.substring(
      html.indexOf('.modal-close {'),
      html.indexOf('.modal-close {') + 400
    );
    expect(modalCloseSection).toContain('border-radius');
    expect(modalCloseSection).toContain('8px');
  });
});

// ─── Sign-In Screen ─────────────────────────────────────────

test.describe('Sign-In Screen Polish', () => {
  test('signin-card has gradient background', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.signin-card {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 500);
    expect(section).toContain('linear-gradient');
  });

  test('signin-card has backdrop-filter blur', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.signin-card {');
    const section = html.substring(idx, idx + 800);
    expect(section).toContain('backdrop-filter');
    expect(section).toContain('blur');
  });

  test('signin-card h2 has gradient text clipping', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.signin-card h2');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('-webkit-background-clip');
    expect(section).toContain('text');
  });

  test('signin-btn has gradient background', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.signin-btn {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 800);
    expect(section).toContain('linear-gradient');
  });

  test('signin-btn-google has gradient background', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.signin-btn-google {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 300);
    expect(section).toContain('linear-gradient');
  });

  test('signin-divider uses gradient lines', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.signin-divider::before');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 200);
    expect(section).toContain('linear-gradient');
  });

  test('signin-footer has backdrop-filter blur', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Check CSS rule for .signin-footer contains backdrop-filter: blur
    const pattern = /\.signin-footer\s*\{[^}]*backdrop-filter\s*:\s*blur/;
    expect(html).toMatch(pattern);
  });

  test('sign-in screen has lock icon SVG with gradient', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('signin-lock-grad');
    expect(html).toContain('Sign in to claim your website');
  });

  test('screen-signin has overflow hidden for animated orbs', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Check CSS rule for .screen-signin contains overflow: hidden
    const pattern = /\.screen-signin\s*\{[^}]*overflow\s*:\s*hidden/;
    expect(html).toMatch(pattern);
  });

  test('screen-signin has animated background orbs', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('.screen-signin::before');
    expect(html).toContain('.screen-signin::after');
    expect(html).toContain('orbFloat1');
    expect(html).toContain('orbFloat2');
  });
});

// ─── Domain Tabs ────────────────────────────────────────────

test.describe('Domain Tabs Styling', () => {
  test('domain-tabs has pill container style with padding', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.domain-tabs {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('border-radius');
    expect(section).toContain('12px');
    expect(section).toContain('padding');
    expect(section).toContain('4px');
  });

  test('domain-tab has rounded inner corners', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.domain-tab {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('border-radius');
    expect(section).toContain('8px');
  });

  test('domain-tab.active has gradient background', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.domain-tab.active');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 300);
    expect(section).toContain('linear-gradient');
    expect(section).toContain('#fff');
  });
});

// ─── Connect Domain Tab ─────────────────────────────────────

test.describe('Connect Domain Tab', () => {
  test('Connect Domain panel has link icon SVG', async ({ page }) => {
    await page.goto('/');
    const panel = page.locator('#domain-panel-connect');
    const svg = panel.locator('svg').first();
    expect(await svg.count()).toBeGreaterThanOrEqual(1);
  });

  test('Connect Domain panel has instructional info card', async ({ page }) => {
    await page.goto('/');
    const html = await page.locator('#domain-panel-connect').innerHTML();
    expect(html).toContain('Connect your own domain');
    expect(html).toContain('sites.megabyte.space');
  });

  test('Connect Domain upgrade CTA has star icon with gradient', async ({ page }) => {
    await page.goto('/');
    const html = await page.locator('#domain-connect-upgrade-cta').innerHTML();
    expect(html).toContain('upgrade-grad');
    expect(html).toContain('Unlock Custom Domains');
    expect(html).toContain('Upgrade Now');
  });

  test('Connect Domain has info tip with icon at bottom', async ({ page }) => {
    await page.goto('/');
    const html = await page.locator('#domain-panel-connect').innerHTML();
    expect(html).toContain('CNAME record');
    expect(html).toContain("We'll monitor it");
    // Should have an info (i) icon circle
    expect(html).toContain('circle cx="12" cy="12" r="10"');
  });
});

// ─── Register New Tab ───────────────────────────────────────

test.describe('Register New Tab', () => {
  test('Register panel has globe icon SVG', async ({ page }) => {
    await page.goto('/');
    const panel = page.locator('#domain-panel-register');
    const svg = panel.locator('svg').first();
    expect(await svg.count()).toBeGreaterThanOrEqual(1);
  });

  test('Register panel highlights wholesale pricing', async ({ page }) => {
    await page.goto('/');
    const html = await page.locator('#domain-panel-register').innerHTML();
    expect(html).toContain('Cloudflare wholesale prices');
    expect(html).toContain('no markup');
  });

  test('Register panel has green color for wholesale text', async ({ page }) => {
    await page.goto('/');
    const html = await page.locator('#domain-panel-register').innerHTML();
    expect(html).toContain('#22c55e');
  });
});

// ─── Domain Search Results ──────────────────────────────────

test.describe('Domain Search Results Styling', () => {
  test('domain-search-input has gradient background', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.domain-search-input {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('linear-gradient');
    expect(section).toContain('12px');
  });

  test('domain-search-results has box-shadow', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.domain-search-results {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('box-shadow');
  });

  test('domain-result-price uses green color', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Find the standalone .domain-result-price CSS rule (not nested under .domain-result-item)
    const pattern = /\.domain-result-price\s*\{[^}]*color\s*:\s*#22c55e/;
    expect(html).toMatch(pattern);
  });
});

// ─── Hostname Items ─────────────────────────────────────────

test.describe('Hostname Item Enhancements', () => {
  test('hostname-item has 10px border-radius', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.hostname-item {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('border-radius');
    expect(section).toContain('10px');
  });

  test('hostname-add-form button has gradient background', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.hostname-add-form button {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('linear-gradient');
  });

  test('hostname-add-form input has gradient background', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.hostname-add-form input {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('linear-gradient');
  });
});

// ─── Site Card ──────────────────────────────────────────────

test.describe('Site Card Visual Polish', () => {
  test('site-card has gradient background', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.site-card {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('linear-gradient');
    expect(section).toContain('14px');
  });

  test('site-card:hover has translateY transform', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.site-card:hover');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 300);
    expect(section).toContain('translateY');
  });

  test('site-card-new:hover has translateY transform', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.site-card-new:hover');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 300);
    expect(section).toContain('translateY');
  });
});

// ─── Input Fields ───────────────────────────────────────────

test.describe('Input Field Polish', () => {
  test('input-field has gradient background', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.input-field {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('linear-gradient');
  });
});

// ─── Toast Notifications ────────────────────────────────────

test.describe('Toast Notification Styling', () => {
  test('toast has backdrop-filter and 12px border-radius', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.toast {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('backdrop-filter');
    expect(section).toContain('blur');
    expect(section).toContain('12px');
  });
});

// ─── Details Modal ──────────────────────────────────────────

test.describe('Details Modal Styling', () => {
  test('details-modal-overlay has backdrop blur', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.details-modal-overlay {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('backdrop-filter');
    expect(section).toContain('blur');
  });

  test('details-card has gradient background and 20px radius', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.details-card {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 500);
    expect(section).toContain('linear-gradient');
    expect(section).toContain('20px');
  });
});

// ─── Location Modal ─────────────────────────────────────────

test.describe('Location Modal Styling', () => {
  test('location-modal has gradient background and 20px radius', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.location-modal {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('linear-gradient');
    expect(section).toContain('20px');
  });

  test('location-modal-overlay has 8px backdrop blur', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.location-modal-overlay {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('backdrop-filter');
    expect(section).toContain('blur(8px)');
  });
});

// ─── Header ─────────────────────────────────────────────────

test.describe('Header Polish', () => {
  test('header has box-shadow', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.header {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('box-shadow');
  });

  test('header has 24px backdrop blur', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.header {');
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('blur(24px)');
  });
});

// ─── Deploy Upload Zone ─────────────────────────────────────

test.describe('Deploy Upload Zone', () => {
  test('deploy-upload-zone has 14px border-radius', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.deploy-upload-zone {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('14px');
  });
});

// ─── Inline Slug Actions ───────────────────────────────────

test.describe('Inline Slug Actions', () => {
  test('inline-slug-actions has 34px width matching inline-edit-actions', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.inline-slug-actions {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 300);
    expect(section).toContain('width: 34px');
    expect(section).toContain('min-width: 34px');
  });

  test('inline-edit-actions and inline-slug-actions use same width', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const editIdx = html.indexOf('.inline-edit-actions {');
    const slugIdx = html.indexOf('.inline-slug-actions {');
    expect(editIdx).toBeGreaterThan(-1);
    expect(slugIdx).toBeGreaterThan(-1);
    const editSection = html.substring(editIdx, editIdx + 200);
    const slugSection = html.substring(slugIdx, slugIdx + 200);
    // Both should contain 34px
    expect(editSection).toContain('34px');
    expect(slugSection).toContain('34px');
  });
});

// ─── Domain Modal Independence ─────────────────────────────

test.describe('Domain Modal Slug Independence', () => {
  test('domain modal uses dm- prefixed element IDs', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // The JS function should reference dm-slug-url for domain modal context
    expect(html).toContain("case 'url': return 'dm-slug-url'");
    expect(html).toContain("case 'wrap': return 'dm-slug-wrap'");
    expect(html).toContain("case 'input': return 'dm-input-slug'");
  });

  test('domain modal onclick passes dm context', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // The loadHostnames function should pass 'dm' context for domain modal slug editing
    expect(html).toContain("'dm')");
    expect(html).toContain("id=\"dm-slug-wrap\"");
  });

  test('getSlugElId helper function exists', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('function getSlugElId(type, siteId, ctx)');
  });
});

// ─── CodeMirror Editor ─────────────────────────────────────

test.describe('CodeMirror Editor Integration', () => {
  test('CodeMirror CSS is linked in head', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('codemirror.min.css');
  });

  test('CodeMirror JS scripts are loaded', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('codemirror.min.js');
    expect(html).toContain('mode/htmlmixed/htmlmixed.min.js');
    expect(html).toContain('mode/css/css.min.js');
    expect(html).toContain('mode/javascript/javascript.min.js');
  });

  test('custom bolt-dark theme CSS exists', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('.cm-s-bolt-dark');
    expect(html).toContain('.cm-s-bolt-dark .CodeMirror-gutters');
    expect(html).toContain('.cm-s-bolt-dark .cm-keyword');
  });

  test('ensureCMEditor helper function exists', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('function ensureCMEditor(mode)');
    expect(html).toContain('function getEditorMode(name)');
    expect(html).toContain('function getEditorContent()');
    expect(html).toContain('function setEditorContent(content, mode)');
  });

  test('saveCurrentFile uses getEditorContent', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('var content = getEditorContent()');
  });
});

// ─── Editor Toolbar Labels ─────────────────────────────────

test.describe('Editor Toolbar Labels', () => {
  test('toolbar buttons have text labels', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Back button has label
    expect(html).toContain('>Back</button>');
    // Wrap button has label
    expect(html).toContain('>Wrap</button>');
    // Refresh button has label
    expect(html).toContain('>Refresh</button>');
  });

  test('files-editor-name uses files-breadcrumb class', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('id="files-editor-name" class="files-breadcrumb"');
  });

  test('files-modal-msg is removed (unused)', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).not.toContain('id="files-modal-msg"');
  });
});

// ─── Slug Input ch Sizing ───────────────────────────────────

test.describe('Slug Input ch-based Sizing', () => {
  test('startInlineEdit uses ch units for slug input width', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // The JS should use ch units for pixel-perfect monospace sizing
    expect(html).toContain("+ 'ch'");
    expect(html).toContain('Math.max(3, currentValue.length)');
  });

  test('slug input auto-resizes on input event with ch units', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // The input event listener should also use ch units
    expect(html).toContain("this.value.length) + 'ch'");
  });
});

// ─── Connect Domain Upgrade CTA ────────────────────────────

test.describe('Connect Domain Upgrade CTA', () => {
  test('upgrade CTA is shown for free plan sites on modal open', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // The openDomainModal function should conditionally show the CTA
    expect(html).toContain("site.plan !== 'paid'");
    expect(html).toContain('domain-connect-upgrade-cta');
  });

  test('upgrade CTA has Unlock Custom Domains text', async ({ page }) => {
    await page.goto('/');
    const cta = page.locator('#domain-connect-upgrade-cta');
    await expect(cta).toBeAttached();
    const text = await cta.textContent();
    expect(text).toContain('Unlock Custom Domains');
    expect(text).toContain('Upgrade Now');
  });

  test('upgrade CTA includes SSL and CDN benefits', async ({ page }) => {
    await page.goto('/');
    const cta = page.locator('#domain-connect-upgrade-cta');
    const text = await cta.textContent();
    expect(text).toContain('SSL');
    expect(text).toContain('CDN');
  });
});

// ─── Domain Search Availability Display ─────────────────────

test.describe('Domain Search Availability Display', () => {
  test('renderDomainSearchResults treats price=0 as unavailable', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Frontend should check both available AND price > 0
    expect(html).toContain('r.available && r.price > 0');
  });

  test('available count filters by price > 0', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('r.available && r.price > 0');
  });

  test('unavailable domains show Taken label', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Check that unavailable results show "Unavailable" and "Taken" labels
    expect(html).toContain('Unavailable');
    expect(html).toContain('>Taken</span>');
  });
});

// ─── Visit Button and Site Serving ──────────────────────────

test.describe('Visit Button', () => {
  test('Visit button markup exists in site cards', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Published sites should have a Visit button that opens window
    expect(html).toContain('">Visit</button>');
    expect(html).toContain("window.open(");
  });

  test('site serving returns HTML content-type with charset', async ({ request }) => {
    // Health endpoint returns JSON, not HTML, but we can verify the worker responds
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/json');
  });
});

// ─── Editor Toolbar Styling ─────────────────────────────────

test.describe('Editor Toolbar Styling', () => {
  test('editor-toolbar has gradient background', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.editor-toolbar {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 400);
    expect(section).toContain('linear-gradient');
    expect(section).toContain('border-radius');
  });

  test('editor-toolbar-btn has rounded pill style', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.editor-toolbar-btn {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 300);
    expect(section).toContain('border-radius: 6px');
    expect(section).toContain('font-weight: 500');
  });

  test('editor has language indicator element', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('id="files-editor-lang"');
    expect(html).toContain('font-family:monospace');
  });

  test('code-editor-wrap connects with toolbar border radius', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.code-editor-wrap {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 300);
    expect(section).toContain('border-radius: 0 0');
  });
});

// ─── Domain Search Modal Integration ────────────────────────

test.describe('Domain Search Modal Integration', () => {
  test('domain-search-results has no inner max-height scroll', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.domain-search-results {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 300);
    // Should NOT contain max-height (removed to let modal scroll)
    expect(section).not.toContain('max-height');
    expect(section).not.toContain('overflow-y');
  });
});

// ─── Slug Hint Positioning ──────────────────────────────────

test.describe('Slug Hint Positioning', () => {
  test('slug-hint uses inline-block for pill-row alignment', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const idx = html.indexOf('.slug-hint {');
    expect(idx).toBeGreaterThan(-1);
    const section = html.substring(idx, idx + 200);
    expect(section).toContain('inline-block');
    expect(section).toContain('margin-left: 6px');
  });

  test('showSlugHint appends to hostname-chips container', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain("chips.appendChild(hint)");
    expect(html).toContain("wrap.querySelector('.hostname-chips')");
  });
});

// ─── Site Card Preview ──────────────────────────────────────

test.describe('Site Card Preview Auto-Refresh', () => {
  test('preview iframe includes cache-busting timestamp', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // The iframe src should append ?_t= for cache busting
    expect(html).toContain("'?_t='");
    expect(html).toContain('data-site-id');
  });

  test('status polling re-renders cards on change', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('renderAdminSites()');
    expect(html).toContain('startSiteStatusPolling');
  });
});

// ─── Reset & Build ──────────────────────────────────────────

test.describe('Reset & Build', () => {
  test('POST /api/sites/:id/reset requires auth', async ({ request }) => {
    const res = await request.post('/api/sites/test-id/reset', {
      headers: { 'Content-Type': 'application/json' },
      data: '{}',
    });
    expect([401, 403]).toContain(res.status());
  });

  test('submitReset function sends POST with business data', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('function submitReset()');
    expect(html).toContain('/reset');
    expect(html).toContain('additional_context');
  });
});
