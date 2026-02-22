/**
 * E2E tests for the contact form flow.
 * The contact form is embedded in the marketing sections on the search screen.
 * /contact redirects to /#contact-section.
 */

import { test, expect } from './fixtures.js';

async function scrollToContact(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    document.getElementById('contact-section')?.scrollIntoView({ behavior: 'instant', block: 'center' });
  });
  await page.waitForTimeout(500);
}

test.describe('Contact Form', () => {
  test('contact section exists on the homepage', async ({ page }) => {
    await page.goto('/');

    const contactSection = page.locator('#contact-section');
    await expect(contactSection).toBeAttached();
  });

  test('contact form fields are present on homepage', async ({ page }) => {
    await page.goto('/');
    await scrollToContact(page);

    await expect(page.locator('#contact-name')).toBeAttached();
    await expect(page.locator('#contact-email')).toBeAttached();
    await expect(page.locator('#contact-message')).toBeAttached();
    await expect(page.locator('#contact-submit-btn')).toBeAttached();
  });

  test('submit with empty name shows validation error', async ({ page }) => {
    await page.goto('/');
    await scrollToContact(page);

    await page.locator('#contact-email').scrollIntoViewIfNeeded();
    await page.fill('#contact-email', 'test@example.com');
    await page.locator('#contact-message').scrollIntoViewIfNeeded();
    await page.fill('#contact-message', 'This is a test message for validation.');
    await page.locator('#contact-submit-btn').scrollIntoViewIfNeeded();
    await page.click('#contact-submit-btn');

    await expect(page.locator('#contact-msg')).toBeVisible();
    await expect(page.locator('#contact-msg')).toContainText(/name/i);
  });

  test('submit with invalid email shows validation error', async ({ page }) => {
    await page.goto('/');
    await scrollToContact(page);

    await page.locator('#contact-name').scrollIntoViewIfNeeded();
    await page.fill('#contact-name', 'Test User');
    await page.fill('#contact-email', 'not-an-email');
    await page.locator('#contact-message').scrollIntoViewIfNeeded();
    await page.fill('#contact-message', 'This is a test message for validation.');
    await page.locator('#contact-submit-btn').scrollIntoViewIfNeeded();
    await page.click('#contact-submit-btn');

    await expect(page.locator('#contact-msg')).toBeVisible();
    await expect(page.locator('#contact-msg')).toContainText(/email/i);
  });

  test('submit with short message shows validation error', async ({ page }) => {
    await page.goto('/');
    await scrollToContact(page);

    await page.locator('#contact-name').scrollIntoViewIfNeeded();
    await page.fill('#contact-name', 'Test User');
    await page.fill('#contact-email', 'test@example.com');
    await page.locator('#contact-message').scrollIntoViewIfNeeded();
    await page.fill('#contact-message', 'Short');
    await page.locator('#contact-submit-btn').scrollIntoViewIfNeeded();
    await page.click('#contact-submit-btn');

    await expect(page.locator('#contact-msg')).toBeVisible();
    await expect(page.locator('#contact-msg')).toContainText(/10 characters/i);
  });
});
