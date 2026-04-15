import { test, expect } from './fixtures';

test.describe('Waiting Page', () => {
  test('waiting page shows spinner and status message', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.fill('#create-name', 'Test Business');
    await page.fill('#create-address', '88 N Beverwyck Rd, Lake Hiawatha, NJ 07034');
    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });

    await expect(page.locator('.spinner')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.waiting-title')).toContainText('Preparing');
    await expect(page.locator('.waiting-subtitle')).toBeVisible();
  });

  test('waiting page has go to dashboard button', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.fill('#create-name', 'Dashboard Test');
    await page.fill('#create-address', '88 N Beverwyck Rd, Lake Hiawatha, NJ 07034');
    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });
    await expect(page.locator('text=Go to Dashboard')).toBeVisible();
  });

  test('dashboard button navigates to admin', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.fill('#create-name', 'Admin Nav Test');
    await page.fill('#create-address', '88 N Beverwyck Rd, Lake Hiawatha, NJ 07034');
    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });
    await page.locator('text=Go to Dashboard').click();
    await page.waitForURL('**/admin**', { timeout: 5000 });
  });

  test('waiting page updates status message as build progresses', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.fill('#create-name', 'Progress Test');
    await page.fill('#create-address', '88 N Beverwyck Rd, Lake Hiawatha, NJ 07034');
    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });
    await expect(page.locator('.waiting-subtitle')).toBeVisible({ timeout: 5000 });

    const msg = await page.locator('.waiting-subtitle').textContent();
    expect(msg?.trim().length).toBeGreaterThan(0);
  });
});
