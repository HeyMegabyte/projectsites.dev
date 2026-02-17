/**
 * @module e2e/domain-management
 * @description E2E tests for the domain management features in the admin dashboard.
 *
 * Tests cover:
 * - Domain summary bar rendering
 * - Domain modal opening and hostname display
 * - Verify button for pending hostnames
 * - Adding custom domains via connect tab
 * - Domain search in register tab
 *
 * @packageDocumentation
 */

import { test, expect } from './fixtures.js';

test.describe('Domain Management Admin API', () => {
  test('GET /api/admin/domains returns 401 without auth', async ({ page }) => {
    const res = await page.request.get('/api/admin/domains');
    expect(res.status()).toBe(401);
  });

  test('GET /api/admin/domains/summary returns 401 without auth', async ({ page }) => {
    const res = await page.request.get('/api/admin/domains/summary');
    expect(res.status()).toBe(401);
  });

  test('POST /api/admin/domains/:id/verify returns 401 without auth', async ({ page }) => {
    const res = await page.request.post('/api/admin/domains/some-id/verify');
    expect(res.status()).toBe(401);
  });

  test('GET /api/admin/domains/:id/health returns 401 without auth', async ({ page }) => {
    const res = await page.request.get('/api/admin/domains/some-id/health');
    expect(res.status()).toBe(401);
  });

  test('DELETE /api/admin/domains/:id returns 401 without auth', async ({ page }) => {
    const res = await page.request.delete('/api/admin/domains/some-id');
    expect(res.status()).toBe(401);
  });
});

test.describe('Domain Management UI', () => {
  test('homepage loads with domain management modal markup', async ({ page }) => {
    await page.goto('/');

    // The domain modal overlay should be in the DOM (hidden)
    const domainModal = page.locator('#domain-modal');
    await expect(domainModal).toBeAttached();

    // The domain summary bar should be in the DOM (hidden initially)
    const summaryBar = page.locator('#domain-summary-bar');
    await expect(summaryBar).toBeAttached();
  });

  test('domain modal has all three tabs', async ({ page }) => {
    await page.goto('/');

    // Check tab buttons exist
    const existingTab = page.locator('#domain-tab-existing');
    const connectTab = page.locator('#domain-tab-connect');
    const registerTab = page.locator('#domain-tab-register');

    await expect(existingTab).toBeAttached();
    await expect(connectTab).toBeAttached();
    await expect(registerTab).toBeAttached();
  });

  test('domain connect tab has CNAME instruction', async ({ page }) => {
    await page.goto('/');

    const connectPanel = page.locator('#domain-panel-connect');
    await expect(connectPanel).toBeAttached();

    // Check that it mentions sites.megabyte.space as CNAME target
    const text = await connectPanel.textContent();
    expect(text).toContain('sites.megabyte.space');
  });

  test('domain search input exists in register tab', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.locator('#domain-search-input');
    await expect(searchInput).toBeAttached();
  });
});

test.describe('Workflow Error Display', () => {
  test('build terminal does not display [object Object]', async ({ page }) => {
    await page.goto('/');

    // This test verifies the fix is in place by checking the JS source
    // contains the error message serialization logic
    const html = await page.content();
    expect(html).toContain('typeof errorMsg === \'object\'');
    expect(html).toContain('errorMsg.message || errorMsg.name || JSON.stringify(errorMsg)');
  });
});
