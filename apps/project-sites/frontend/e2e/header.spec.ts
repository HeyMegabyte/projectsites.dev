import { test, expect } from './fixtures';

test.describe('Header Navigation', () => {
  test('header shows logo and sign in button when not logged in', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.logo')).toBeVisible();
    await expect(page.locator('.logo-text')).toContainText('Project Sites');
    await expect(page.locator('.header-signin-btn')).toBeVisible();
  });

  test('sign in button navigates to signin page', async ({ page }) => {
    await page.goto('/');
    // Dismiss location prompt if it appears (it shows after 5s delay)
    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.btn-skip').click();
    }
    await page.locator('.header-signin-btn').click({ force: true });
    await page.waitForURL('**/signin', { timeout: 5000 });
    await expect(page).toHaveURL(/\/signin/);
  });

  test('logo click navigates home', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('.logo').click();
    await page.waitForURL(/^http:\/\/localhost:\d+\/$/, { timeout: 5000 });
    await expect(page.locator('h1')).toContainText('Handled');
  });

  test('authenticated user sees avatar menu', async ({ authedPage: page }) => {
    await page.goto('/');
    await expect(page.locator('.user-menu')).toBeVisible();
    await expect(page.locator('.user-avatar')).toBeVisible();
    await expect(page.locator('.user-avatar')).toContainText('T'); // test@example.com → T
  });

  test('dropdown opens on avatar click', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.locator('.user-menu').click();
    await expect(page.locator('.dropdown')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.dropdown-email')).toContainText('test@example.com');
  });

  test('dropdown has dashboard, new site, sign out options', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.locator('.user-menu').click();
    await expect(page.locator('.dropdown-item', { hasText: 'Dashboard' })).toBeVisible();
    await expect(page.locator('.dropdown-item', { hasText: 'New Site' })).toBeVisible();
    await expect(page.locator('.dropdown-item.logout', { hasText: 'Sign Out' })).toBeVisible();
  });

  test('dashboard link navigates to /admin', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.locator('.user-menu').click();
    await page.locator('.dropdown-item', { hasText: 'Dashboard' }).click();
    await page.waitForURL('**/admin', { timeout: 5000 });
    await expect(page).toHaveURL(/\/admin/);
  });

  test('sign out clears session and shows sign in button', async ({ authedPage: page }) => {
    await page.goto('/');
    await expect(page.locator('.user-menu')).toBeVisible();

    await page.locator('.user-menu').click();
    await page.locator('.dropdown-item.logout').click();

    // Should show sign in button instead of avatar
    await expect(page.locator('.header-signin-btn')).toBeVisible({ timeout: 3000 });
  });

  test('dropdown closes on outside click', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.locator('.user-menu').click();
    await expect(page.locator('.dropdown')).toBeVisible({ timeout: 2000 });

    // Click outside
    await page.locator('h1').click();
    await expect(page.locator('.dropdown')).toHaveCount(0, { timeout: 2000 });
  });
});
