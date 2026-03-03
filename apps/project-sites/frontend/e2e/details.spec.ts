/**
 * Details page E2E tests.
 *
 * Covers: page rendering, form fields, additional context textarea,
 * build button state, character counter.
 */
import { test, expect } from './fixtures.js';

test.describe('Details Page - Rendering', () => {
  test('shows "Almost there" heading', async ({ page }) => {
    await page.goto('/details');
    await expect(page.locator('.details-card h2')).toContainText('Almost there');
  });

  test('shows subtitle', async ({ page }) => {
    await page.goto('/details');
    await expect(page.locator('.details-subtitle')).toContainText('Tell us about your business');
  });

  test('shows additional context textarea', async ({ page }) => {
    await page.goto('/details');
    await expect(page.locator('#details-textarea')).toBeVisible();
  });

  test('shows character counter', async ({ page }) => {
    await page.goto('/details');
    await expect(page.locator('.char-count')).toContainText('0 / 5000');
  });

  test('shows Build My Website button', async ({ page }) => {
    await page.goto('/details');
    await expect(page.getByText('Build My Website')).toBeVisible();
  });

  test('close button is present', async ({ page }) => {
    await page.goto('/details');
    await expect(page.locator('.details-modal-close')).toBeAttached();
  });
});

test.describe('Details Page - Custom Mode', () => {
  test('custom mode shows business name input', async ({ page }) => {
    // In custom mode (no selected business), manual fields show
    await page.goto('/details');
    await expect(page.locator('#business-name')).toBeVisible();
  });

  test('custom mode shows business address input', async ({ page }) => {
    await page.goto('/details');
    await expect(page.locator('#business-address')).toBeVisible();
  });

  test('typing in textarea updates character count', async ({ authedPage: page }) => {
    // Must be authenticated since details page redirects to /signin otherwise
    await page.goto('/details');
    const textarea = page.locator('#details-textarea');
    await expect(textarea).toBeVisible();
    await textarea.click();
    await page.keyboard.type('Hello world');
    await expect(page.locator('.char-count')).toContainText('11 / 5000');
  });
});
