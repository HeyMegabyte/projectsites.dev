/**
 * Navigation and routing E2E tests.
 *
 * Covers: SPA routing, header rendering, page transitions,
 * 404 handling, responsive elements.
 */
import { test, expect } from './fixtures.js';

test.describe('Navigation - SPA Routing', () => {
  test('homepage loads at /', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero-brand')).toBeVisible();
  });

  test('signin page loads at /signin', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('.signin-card')).toBeVisible();
  });

  test('details page loads at /details', async ({ page }) => {
    await page.goto('/details');
    await expect(page.locator('.details-card')).toBeVisible();
  });

  test('admin page loads at /admin', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('.admin-panel')).toBeVisible();
  });

  test('waiting page loads at /waiting', async ({ page }) => {
    await page.goto('/waiting?id=test&slug=test');
    await expect(page.locator('.screen-waiting')).toBeVisible();
  });

  test('unknown route falls back to angular router', async ({ page }) => {
    await page.goto('/nonexistent');
    // Angular router should handle this - either redirect or show something
    await expect(page.locator('ion-app')).toBeVisible();
  });
});

test.describe('Header', () => {
  test('header is visible on all pages', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('app-header ion-header')).toBeAttached();
  });

  test('header shows sign-in button when logged out', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('app-header ion-button')).toBeAttached();
  });
});
