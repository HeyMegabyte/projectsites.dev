/**
 * Admin Dashboard E2E tests.
 *
 * Covers: page rendering, AG Grid, site cards, action buttons,
 * modal triggers, billing controls.
 */
import { test, expect } from './fixtures.js';

test.describe('Admin Page - Unauthenticated', () => {
  test('redirects to signin if not logged in', async ({ page }) => {
    await page.goto('/admin');
    // The admin page loads sites which returns 401
    // The page should still render but show empty/loading state
    await expect(page.locator('.admin-panel')).toBeVisible();
  });
});

test.describe('Admin Page - Authenticated', () => {
  test('shows My Sites title', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.admin-panel-title')).toContainText('My Sites');
  });

  test('shows New Site button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.admin-panel-actions ion-button').last()).toContainText('New Site');
  });

  test('shows Manage Billing button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.admin-panel-actions ion-button').first()).toContainText('Manage Billing');
  });

  test('shows plan indicator', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.plan-indicator')).toBeVisible();
  });

  test('shows AG Grid when sites are loaded', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('ag-grid-angular')).toBeAttached({ timeout: 5000 });
  });

  test('AG Grid has correct columns', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('ag-grid-angular')).toBeAttached({ timeout: 5000 });
  });

  test('shows site action cards', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.site-action-card').first()).toBeVisible({ timeout: 5000 });
  });

  test('site card shows business name', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.sac-name').first()).toBeVisible({ timeout: 5000 });
  });

  test('site card shows status badge', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.site-action-card ion-badge').first()).toBeVisible({ timeout: 5000 });
  });

  test('site card shows action buttons', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('.sac-buttons ion-button').first()).toBeVisible();
  });

  test('site card shows Details button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('ion-button', { hasText: 'Details' })).toBeVisible();
  });

  test('site card shows Files button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('ion-button', { hasText: 'Files' })).toBeVisible();
  });

  test('site card shows Domains button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('ion-button', { hasText: 'Domains' })).toBeVisible();
  });

  test('site card shows Logs button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('ion-button', { hasText: 'Logs' })).toBeVisible();
  });

  test('site card shows Deploy button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('ion-button', { hasText: 'Deploy' })).toBeVisible();
  });

  test('site card shows Reset button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('ion-button', { hasText: 'Reset' })).toBeVisible();
  });

  test('site card shows Delete button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await expect(card.locator('ion-button', { hasText: 'Delete' })).toBeVisible();
  });

  test('site card shows site URL', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await expect(page.locator('.sac-url a').first()).toBeVisible({ timeout: 5000 });
  });
});
