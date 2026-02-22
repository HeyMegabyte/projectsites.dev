/**
 * E2E tests for:
 * - Site card preview iframe (CORS, sizing, dynamic scaling)
 * - Logs modal (no flickering, wider)
 * - Modal overlay stability
 */
import { test, expect } from './fixtures';

test.describe('Site Card Preview', () => {
  test('site card preview CSS uses 1440px iframe width for full-card scaling', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('width: 1440px');
    expect(html).toContain('height: 900px');
  });

  test('iframe uses sandbox with allow-scripts allow-same-origin', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('allow-scripts allow-same-origin');
  });

  test('preview iframe has onload scale handler', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('scalePreviewIframe');
  });

  test('site card preview has fixed height for consistent card layout', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('height: 140px');
  });
});

test.describe('Logs Modal', () => {
  test('logs modal has increased width (840px)', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('max-width: 840px');
  });

  test('modal overlay uses GPU compositing to prevent flicker', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Check for GPU compositing and isolation properties
    expect(html).toContain('transform: translateZ(0)');
    expect(html).toContain('backface-visibility: hidden');
    expect(html).toContain('isolation: isolate');
  });
});

test.describe('Modal Overlay', () => {
  test('modal overlay children have z-index 1001', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('z-index: 1001');
  });

  test('modal overlay has high opacity background', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('rgba(0, 0, 0, 0.85)');
  });

  test('modal overlay exists in DOM', async ({ page }) => {
    await page.goto('/');
    const overlay = page.locator('.modal-overlay').first();
    await expect(overlay).toBeAttached();
  });
});
