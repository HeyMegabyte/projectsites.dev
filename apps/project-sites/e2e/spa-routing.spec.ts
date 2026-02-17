/**
 * E2E tests for SPA routing — verifying that /privacy, /terms, /content
 * redirect to the homepage (those pages have been removed), and the
 * contact section is visible on the homepage.
 */

import { test, expect } from './fixtures.js';

test.describe('SPA Routing: Direct URL Navigation', () => {
  test('/ shows the search screen by default', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#screen-search')).toHaveClass(/active/);
  });

  test('/privacy redirects to homepage', async ({ page }) => {
    const response = await page.goto('/privacy');
    // Server returns 301 redirect to homepage
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#screen-search')).toHaveClass(/active/);
  });

  test('/terms redirects to homepage', async ({ page }) => {
    const response = await page.goto('/terms');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#screen-search')).toHaveClass(/active/);
  });

  test('/content redirects to homepage', async ({ page }) => {
    const response = await page.goto('/content');
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#screen-search')).toHaveClass(/active/);
  });

  test('/contact redirects to homepage with contact section anchor', async ({ page }) => {
    const response = await page.goto('/contact');
    await expect(page).toHaveURL(/\/#contact-section$/);
    await expect(page.locator('#screen-search')).toHaveClass(/active/);
  });
});

test.describe('SPA Routing: Footer Links', () => {
  test('Support footer link has correct email', async ({ page }) => {
    await page.goto('/');

    const supportLink = page.locator('a[href="mailto:hey@megabyte.space"]');
    await expect(supportLink).toBeVisible();
  });

  test('Contact footer link scrolls to contact section', async ({ page }) => {
    await page.goto('/');

    const contactLink = page.locator('.footer-links a:has-text("Contact")');
    await expect(contactLink).toBeVisible();
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
