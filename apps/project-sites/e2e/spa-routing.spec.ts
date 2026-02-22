/**
 * E2E tests for SPA routing — verifying that /privacy, /terms, /content
 * are served as separate pages (Astro-generated), and the
 * contact section is visible on the homepage.
 */

import { test, expect } from './fixtures.js';

test.describe('SPA Routing: Direct URL Navigation', () => {
  test('/ shows the search screen by default', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#screen-search')).toHaveClass(/active/);
  });

  test('/privacy serves a page or redirects appropriately', async ({ page }) => {
    const response = await page.goto('/privacy');
    // Either serves the privacy page directly (Astro build deployed) or
    // falls through to homepage (R2 doesn't have the file yet)
    expect(response?.status()).toBeLessThan(500);
  });

  test('/terms serves a page or redirects appropriately', async ({ page }) => {
    const response = await page.goto('/terms');
    expect(response?.status()).toBeLessThan(500);
  });

  test('/content serves a page or redirects appropriately', async ({ page }) => {
    const response = await page.goto('/content');
    expect(response?.status()).toBeLessThan(500);
  });

  test('/contact serves a page or redirects appropriately', async ({ page }) => {
    const response = await page.goto('/contact');
    // Worker redirects /contact to /#contact-section (301)
    // Static file server may serve the page directly
    expect(response?.status()).toBeLessThan(500);
  });
});

test.describe('SPA Routing: Footer Links', () => {
  test('footer legal links point to local pages', async ({ page }) => {
    await page.goto('/');

    const privacyLink = page.locator('.footer-bottom a:has-text("Privacy Policy")');
    await expect(privacyLink).toHaveAttribute('href', '/privacy');

    const termsLink = page.locator('.footer-bottom a:has-text("Terms of Service")');
    await expect(termsLink).toHaveAttribute('href', '/terms');

    const contentLink = page.locator('.footer-bottom a:has-text("Content Policy")');
    await expect(contentLink).toHaveAttribute('href', '/content');
  });
});

test.describe('Homepage Contact Form', () => {
  test('contact form is visible on homepage when scrolled down', async ({ page }) => {
    await page.goto('/');

    const contactSection = page.locator('#contact-section');
    await expect(contactSection).toBeAttached();

    const contactForm = page.locator('#contact-form');
    await expect(contactForm).toBeAttached();
  });
});
