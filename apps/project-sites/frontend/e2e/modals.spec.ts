/**
 * Modal E2E tests.
 *
 * Covers: Details, Deploy, Files, Domains, Logs, Status, Reset, Delete modals.
 * Tests open/close, basic content rendering, and key interactions.
 */
import { test, expect } from './fixtures.js';

test.describe('Details Modal', () => {
  test('opens and shows site details heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Details' }).click();
    await expect(page.locator('ion-modal ion-title')).toContainText('Site Details', { timeout: 3000 });
  });

  test('shows business name in details', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Details' }).click();
    await expect(page.locator('ion-modal')).toContainText('Business Name', { timeout: 3000 });
  });

  test('close button dismisses modal', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Details' }).click();
    await expect(page.locator('ion-modal ion-title')).toContainText('Site Details', { timeout: 3000 });
    await page.locator('ion-modal ion-button', { hasText: 'Close' }).click();
    // Modal should dismiss
    await expect(page.locator('ion-modal ion-title')).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe('Files Modal', () => {
  test('opens and shows File Editor heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Files' }).click();
    await expect(page.locator('ion-modal ion-title')).toContainText('File Editor', { timeout: 3000 });
  });

  test('shows file tree panel', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Files' }).click();
    await expect(page.locator('ion-modal .file-tree')).toBeVisible({ timeout: 3000 });
  });

  test('shows editor panel', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Files' }).click();
    await expect(page.locator('ion-modal .file-editor')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Domains Modal', () => {
  test('opens and shows Domain Management heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Domains' }).click();
    await expect(page.locator('ion-modal ion-title')).toContainText('Domain Management', { timeout: 3000 });
  });

  test('shows Hostnames and CNAME tabs', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Domains' }).click();
    await expect(page.locator('ion-modal ion-segment-button', { hasText: 'Hostnames' })).toBeVisible({ timeout: 3000 });
    await expect(page.locator('ion-modal ion-segment-button', { hasText: 'CNAME' })).toBeVisible();
  });

  test('CNAME tab shows setup instructions', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Domains' }).click();
    await page.locator('ion-modal ion-segment-button', { hasText: 'CNAME' }).click();
    await expect(page.locator('ion-modal .cname-info')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('ion-modal .cname-info')).toContainText('Setup Instructions');
  });
});

test.describe('Logs Modal', () => {
  test('opens and shows Build Logs heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Logs' }).click();
    await expect(page.locator('ion-modal ion-title')).toContainText('Build Logs', { timeout: 3000 });
  });

  test('shows Copy for AI button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Logs' }).click();
    await expect(page.locator('ion-modal ion-button', { hasText: 'Copy for AI' })).toBeVisible({ timeout: 3000 });
  });

  test('shows Refresh button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Logs' }).click();
    await expect(page.locator('ion-modal ion-button', { hasText: 'Refresh' })).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Status Modal', () => {
  test('opens and shows Build Status heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Status' }).click();
    await expect(page.locator('ion-modal ion-title')).toContainText('Build Status', { timeout: 3000 });
  });

  test('shows terminal-style status display', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Status' }).click();
    await expect(page.locator('ion-modal .status-terminal')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Deploy Modal', () => {
  test('opens and shows Deploy ZIP heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Deploy' }).click();
    await expect(page.locator('ion-modal ion-title')).toContainText('Deploy ZIP', { timeout: 3000 });
  });

  test('shows drag and drop zone', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Deploy' }).click();
    await expect(page.locator('ion-modal .deploy-zone')).toBeVisible({ timeout: 3000 });
  });

  test('shows Browse Files button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Deploy' }).click();
    await expect(page.locator('ion-modal ion-button', { hasText: 'Browse Files' })).toBeVisible({ timeout: 3000 });
  });

  test('deploy button is disabled without file', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Deploy' }).click();
    const deployBtn = page.locator('ion-modal ion-button', { hasText: 'Deploy' }).last();
    await expect(deployBtn).toBeVisible({ timeout: 3000 });
    // The button text says "Deploy" and it should be disabled
    await expect(deployBtn).toHaveAttribute('disabled', '');
  });
});

test.describe('Reset Modal', () => {
  test('opens and shows Reset & Rebuild heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Reset' }).click();
    await expect(page.locator('ion-modal ion-title')).toContainText('Reset & Rebuild', { timeout: 3000 });
  });

  test('shows additional context textarea', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Reset' }).click();
    await expect(page.locator('ion-modal textarea')).toBeVisible({ timeout: 3000 });
  });

  test('shows Reset & Rebuild submit button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Reset' }).click();
    await expect(page.locator('ion-modal ion-button[color="warning"]')).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Delete Modal', () => {
  test('opens and shows Delete Site heading', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Delete' }).click();
    await expect(page.locator('ion-modal ion-title')).toContainText('Delete Site', { timeout: 3000 });
  });

  test('shows warning message', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Delete' }).click();
    await expect(page.locator('ion-modal .delete-warning h3')).toContainText('cannot be undone', { timeout: 3000 });
  });

  test('delete button is disabled without confirmation', async ({ authedPage: page }) => {
    await page.goto('/admin');
    const card = page.locator('.site-action-card').first();
    await expect(card).toBeVisible({ timeout: 5000 });
    await card.locator('ion-button', { hasText: 'Delete' }).click();
    const deleteBtn = page.locator('ion-modal ion-button[color="danger"]');
    await expect(deleteBtn).toBeVisible({ timeout: 3000 });
    await expect(deleteBtn).toHaveAttribute('disabled', '');
  });
});
