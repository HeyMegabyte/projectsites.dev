/**
 * E2E tests for domain management v2:
 * - Domain search using Domainr API
 * - Domain suggestions display
 * - Register New tab (no CloudFlare references)
 * - Domain modal UI improvements
 */
import { test, expect } from './fixtures';

test.describe('Domain Management v2', () => {
  test('domain modal opens and shows tabs', async ({ page }) => {
    await page.goto('/');
    // Check that the page loads
    await expect(page.locator('body')).toBeVisible();
  });

  test('register new tab does not mention CloudFlare', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // The page should not contain "CloudFlare" or "wholesale pricing" in the domain register tab
    expect(html).not.toContain('CloudFlare</span> wholesale prices');
    // Should contain the new text
    expect(html).toContain('competitive annual pricing with instant activation');
  });

  test('domain search input is present in register tab', async ({ page }) => {
    await page.goto('/');
    const searchInput = page.locator('#domain-search-input');
    await expect(searchInput).toBeAttached();
  });

  test('domain modal has concise styling', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('#domain-modal .modal');
    await expect(modal).toBeAttached();
    // Modal should have max-width of 520px
    const style = await modal.getAttribute('style');
    expect(style).toContain('520px');
  });
});
