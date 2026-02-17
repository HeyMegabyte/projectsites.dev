/**
 * E2E tests for the contact form flow.
 */

import { test, expect } from './fixtures.js';

test.describe('Contact Form', () => {
  test('navigating to /contact shows the form', async ({ page }) => {
    await page.goto('/contact');

    await expect(page.locator('#screen-contact')).toHaveClass(/active/);
    await expect(page.locator('#contact-name')).toBeVisible();
    await expect(page.locator('#contact-email')).toBeVisible();
    await expect(page.locator('#contact-message')).toBeVisible();
    await expect(page.locator('#contact-submit')).toBeVisible();
  });

  test('footer Contact link navigates to contact form', async ({ page }) => {
    await page.goto('/');

    await page.click('footer a:has-text("Contact")');

    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.locator('#screen-contact')).toHaveClass(/active/);
  });

  test('submit with empty name shows validation error', async ({ page }) => {
    await page.goto('/contact');

    await page.fill('#contact-email', 'test@example.com');
    await page.fill('#contact-message', 'This is a test message for validation.');
    await page.click('#contact-submit');

    await expect(page.locator('#contact-msg')).toBeVisible();
    await expect(page.locator('#contact-msg')).toContainText(/name/i);
  });

  test('submit with invalid email shows validation error', async ({ page }) => {
    await page.goto('/contact');

    await page.fill('#contact-name', 'Test User');
    await page.fill('#contact-email', 'not-an-email');
    await page.fill('#contact-message', 'This is a test message for validation.');
    await page.click('#contact-submit');

    await expect(page.locator('#contact-msg')).toBeVisible();
    await expect(page.locator('#contact-msg')).toContainText(/email/i);
  });

  test('submit with short message shows validation error', async ({ page }) => {
    await page.goto('/contact');

    await page.fill('#contact-name', 'Test User');
    await page.fill('#contact-email', 'test@example.com');
    await page.fill('#contact-message', 'Short');
    await page.click('#contact-submit');

    await expect(page.locator('#contact-msg')).toBeVisible();
    await expect(page.locator('#contact-msg')).toContainText(/10 characters/i);
  });

  test('back button returns to previous screen', async ({ page }) => {
    await page.goto('/');
    await page.click('footer a:has-text("Contact")');
    await expect(page.locator('#screen-contact')).toHaveClass(/active/);

    await page.click('.legal-back');

    await expect(page.locator('#screen-search')).toHaveClass(/active/);
  });
});
