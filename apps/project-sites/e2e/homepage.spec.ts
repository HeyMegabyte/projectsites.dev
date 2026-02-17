/**
 * @module e2e/homepage
 * @description Focused homepage tests for rendering and basic interactions.
 * Full flow tests are in golden-path.spec.ts.
 *
 * @packageDocumentation
 */

import { test, expect } from './fixtures.js';

test.describe('Homepage Rendering', () => {
  test('loads and renders correctly', async ({ page }) => {
    await page.goto('/');

    // Logo and search visible
    await expect(page.locator('.logo').getByText('Project')).toBeVisible();
    await expect(page.getByPlaceholder(/Enter your business name/)).toBeVisible();
    await expect(page.locator('.hero-brand').getByText(/handled/i)).toBeVisible();

    // HTML has correct content-type
    const res = await page.request.get('/');
    expect(res.headers()['content-type']).toContain('text/html');
  });
});
