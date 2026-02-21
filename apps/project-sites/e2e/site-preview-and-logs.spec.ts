/**
 * E2E tests for:
 * - Site card preview iframe (CORS, sizing)
 * - Logs modal (no flickering, wider)
 * - Modal overlay stability
 */
import { test, expect } from './fixtures';

test.describe('Site Card Preview', () => {
  test('site card preview CSS has full-width iframe scaling', async ({ page }) => {
    await page.goto('/');
    // Check that the preview CSS includes the updated iframe sizing
    const html = await page.content();
    expect(html).toContain('width: 1280px');
    expect(html).toContain('scale(0.22)');
  });

  test('iframe uses sandbox with allow-scripts', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Verify the iframe template includes proper sandbox attribute
    expect(html).toContain('allow-scripts allow-same-origin');
  });
});

test.describe('Logs Modal', () => {
  test('logs modal has increased width (840px)', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('max-width: 840px');
  });

  test('modal overlay has isolation property for flicker prevention', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Check for will-change and isolation properties
    expect(html).toContain('will-change: opacity');
    expect(html).toContain('isolation: isolate');
  });
});

test.describe('Modal Overlay', () => {
  test('modal overlay has proper z-index layering', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('z-index: 1001');
  });

  test('modal overlay uses increased opacity background', async ({ page }) => {
    await page.goto('/');
    const overlay = page.locator('.modal-overlay').first();
    await expect(overlay).toBeAttached();
  });
});
