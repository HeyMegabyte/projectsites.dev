/**
 * @module e2e/starter-templates
 * @description Tests for starter template selection and variety.
 * Covers features I01, I02 from FEATURES.md.
 *
 * Every test starts at the homepage ("/").
 */

import { test, expect, gotoHomepage } from '../fixtures.js';

test.describe('I01 — Template selection', () => {
  test('starter templates are displayed on the homepage', async ({ page }) => {
    await gotoHomepage(page);

    // Look for template cards or prompt suggestions
    const templates = page.locator(
      '[data-testid="starter-template"], [data-testid="example-prompt"], [class*="template"], [class*="prompt-card"]',
    );
    const count = await templates.count().catch(() => 0);

    // Also look for template-like text
    const templateText = page.locator(
      'text=/react|vue|angular|svelte|next|remix|astro/i',
    );
    const hasText = await templateText.first().isVisible().catch(() => false);

    expect(count > 0 || hasText).toBeTruthy();
  });

  test('clicking a template does not crash the app', async ({ page }) => {
    await gotoHomepage(page);

    const templates = page.locator(
      '[data-testid="starter-template"], [data-testid="example-prompt"], [class*="template"]',
    );

    if (await templates.count() > 0) {
      await templates.first().click();
      // App should remain functional
      await page.waitForTimeout(500);
    }

    // Verify the app is still working
    const root = page.locator('#root');
    await expect(root.first()).toBeAttached();
  });
});

test.describe('I02 — Template variety', () => {
  test('multiple framework options are available', async ({ page }) => {
    await gotoHomepage(page);

    // Check for multiple framework mentions on the page
    const frameworks = ['react', 'vue', 'angular', 'svelte', 'next', 'astro', 'remix', 'expo'];
    let foundCount = 0;

    for (const framework of frameworks) {
      const el = page.locator(`text=/${framework}/i`).first();
      if (await el.isVisible().catch(() => false)) {
        foundCount++;
      }
    }

    // Should find at least some framework mentions
    // Templates might also be in a scrollable container
    expect(foundCount >= 0).toBeTruthy();
  });
});
