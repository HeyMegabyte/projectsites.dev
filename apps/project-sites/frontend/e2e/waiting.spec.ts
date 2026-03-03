/**
 * Waiting / Build Progress page E2E tests.
 *
 * Covers: terminal rendering, step display, status indicators,
 * navigation buttons.
 */
import { test, expect } from './fixtures.js';

test.describe('Waiting Page - Terminal', () => {
  test('shows terminal header', async ({ page }) => {
    await page.goto('/waiting?id=site-1&slug=test-site');
    await expect(page.locator('.terminal-title')).toContainText('Building your website');
  });

  test('shows terminal dots (red/yellow/green)', async ({ page }) => {
    await page.goto('/waiting?id=site-1&slug=test-site');
    await expect(page.locator('.dot.red')).toBeVisible();
    await expect(page.locator('.dot.yellow')).toBeVisible();
    await expect(page.locator('.dot.green')).toBeVisible();
  });

  test('shows build steps', async ({ page }) => {
    await page.goto('/waiting?id=site-1&slug=test-site');
    await expect(page.locator('.terminal-line').first()).toBeVisible({ timeout: 5000 });
  });

  test('shows Go to Dashboard button', async ({ page }) => {
    await page.goto('/waiting?id=site-1&slug=test-site');
    await expect(page.locator('.waiting-actions ion-button')).toContainText('Go to Dashboard');
  });
});
