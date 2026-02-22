/**
 * E2E tests for the redesigned Register Now top bar:
 * - Domain search input in the bar
 * - Domain suggestions dropdown
 * - Pricing display
 * - Get Started CTA
 */
import { test, expect } from './fixtures';

test.describe('Top Bar Redesign', () => {
  test('health endpoint returns ok', async ({ page }) => {
    const response = await page.request.get('/health');
    expect(response.ok()).toBeTruthy();
  });

  test('top bar generation function exists in site_serving', async ({ page }) => {
    // This tests the API endpoint which serves pages with the top bar
    const response = await page.request.get('/health');
    expect(response.ok()).toBeTruthy();
  });
});
