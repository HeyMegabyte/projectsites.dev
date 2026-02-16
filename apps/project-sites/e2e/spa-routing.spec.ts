/**
 * E2E tests for SPA routing — verifying that direct navigation to
 * /privacy, /terms, /content, /contact shows the correct screen
 * via server-side rendering (SSR).
 */

import { test, expect } from './fixtures.js';

test.describe('SPA Routing: Direct URL Navigation', () => {
  test('/ shows the search screen by default', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#screen-search')).toHaveClass(/active/);
    await expect(page.locator('#screen-privacy')).not.toHaveClass(/active/);
    await expect(page.locator('#screen-terms')).not.toHaveClass(/active/);
    await expect(page.locator('#screen-content')).not.toHaveClass(/active/);
  });

  test('/privacy shows the privacy policy screen (SSR)', async ({ page }) => {
    await page.goto('/privacy');

    await expect(page.locator('#screen-privacy')).toHaveClass(/active/);
    await expect(page.locator('#screen-search')).not.toHaveClass(/active/);
    await expect(page.locator('h2')).toContainText(/Privacy Policy/i);
  });

  test('/terms shows the terms of service screen (SSR)', async ({ page }) => {
    await page.goto('/terms');

    await expect(page.locator('#screen-terms')).toHaveClass(/active/);
    await expect(page.locator('#screen-search')).not.toHaveClass(/active/);
    await expect(page.locator('h2')).toContainText(/Terms of Service/i);
  });

  test('/content shows the content policy screen (SSR)', async ({ page }) => {
    await page.goto('/content');

    await expect(page.locator('#screen-content')).toHaveClass(/active/);
    await expect(page.locator('#screen-search')).not.toHaveClass(/active/);
    await expect(page.locator('h2')).toContainText(/Content Policy/i);
  });

  test('/contact shows the contact form screen (SSR)', async ({ page }) => {
    await page.goto('/contact');

    await expect(page.locator('#screen-contact')).toHaveClass(/active/);
    await expect(page.locator('#screen-search')).not.toHaveClass(/active/);
    await expect(page.locator('h2')).toContainText(/Contact Us|Get in Touch/i);
  });
});

test.describe('SPA Routing: Footer Links', () => {
  test('Privacy Policy footer link navigates to /privacy', async ({ page }) => {
    await page.goto('/');

    await page.click('a:has-text("Privacy Policy")');

    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.locator('#screen-privacy')).toHaveClass(/active/);
  });

  test('Terms footer link navigates to /terms', async ({ page }) => {
    await page.goto('/');

    await page.click('a:has-text("Terms of Service")');

    await expect(page).toHaveURL(/\/terms$/);
    await expect(page.locator('#screen-terms')).toHaveClass(/active/);
  });

  test('Content Policy footer link navigates to /content', async ({ page }) => {
    await page.goto('/');

    await page.click('a:has-text("Content Policy")');

    await expect(page).toHaveURL(/\/content$/);
    await expect(page.locator('#screen-content')).toHaveClass(/active/);
  });
});

test.describe('SPA Routing: Back Button', () => {
  test('Back button on legal page returns to search', async ({ page }) => {
    await page.goto('/');
    await page.click('a:has-text("Privacy Policy")');
    await expect(page.locator('#screen-privacy')).toHaveClass(/active/);

    // Click the back button within the legal page
    await page.click('.legal-back');

    await expect(page.locator('#screen-search')).toHaveClass(/active/);
    await expect(page.locator('#screen-privacy')).not.toHaveClass(/active/);
  });

  test('Browser back after footer navigation returns to search', async ({ page }) => {
    await page.goto('/');
    await page.click('a:has-text("Terms of Service")');
    await expect(page.locator('#screen-terms')).toHaveClass(/active/);

    await page.goBack();

    await expect(page.locator('#screen-search')).toHaveClass(/active/);
  });
});
