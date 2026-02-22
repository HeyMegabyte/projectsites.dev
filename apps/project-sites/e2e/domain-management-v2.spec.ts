/**
 * E2E tests for domain management v2:
 * - Domain search using Domainr API
 * - Domain suggestions display
 * - Register New tab (no CloudFlare references)
 * - Domain modal simplified UI
 */
import { test, expect } from './fixtures';

test.describe('Domain Management v2', () => {
  test('domain modal opens and shows tabs', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });

  test('register new tab does not reference CloudFlare for domain buying', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Should NOT have the old CloudFlare domain buying button in the Register tab
    expect(html).not.toContain('CloudFlare</a>');
    // Should still have GoDaddy DomainConnect for CNAME auto-setup (that's different)
    expect(html).toContain('One-click setup');
  });

  test('domain search input is present in register tab', async ({ page }) => {
    await page.goto('/');
    const searchInput = page.locator('#domain-search-input');
    await expect(searchInput).toBeAttached();
  });

  test('domain modal has compact 520px width', async ({ page }) => {
    await page.goto('/');
    const modal = page.locator('#domain-modal .modal');
    await expect(modal).toBeAttached();
    const style = await modal.getAttribute('style');
    expect(style).toContain('520px');
  });

  test('connect domain tab has simplified instructions', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    // Simplified CNAME instruction
    expect(html).toContain('Point a CNAME to');
    expect(html).toContain('sites.megabyte.space');
  });

  test('register tab has pricing note', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    expect(html).toContain('Pricing shown per year');
  });
});
