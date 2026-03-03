/**
 * Authentication E2E tests.
 *
 * Covers: signin page rendering, Google OAuth button, magic link flow,
 * email panel switching, navigation between panels.
 */
import { test, expect } from './fixtures.js';

test.describe('Signin Page - Rendering', () => {
  test('signin page renders welcome heading', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('.signin-card h2')).toContainText('Welcome');
  });

  test('shows signin subtitle', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('.signin-subtitle')).toContainText('Sign in to get your AI-powered website');
  });

  test('shows Google sign-in button', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('.google-btn')).toContainText('Continue with Google');
  });

  test('shows Email sign-in button', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('.signin-methods ion-button').nth(1)).toContainText('Continue with Email');
  });

  test('shows divider between auth methods', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('.signin-divider')).toContainText('or');
  });

  test('shows back to search link', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('.back-link').last()).toContainText('Back to search');
  });
});

test.describe('Signin Page - Email Panel', () => {
  test('clicking email button shows email panel', async ({ page }) => {
    await page.goto('/signin');
    await page.locator('.signin-methods ion-button').nth(1).click();
    await expect(page.locator('#signin-email')).toBeVisible();
  });

  test('email panel shows Send Magic Link button', async ({ page }) => {
    await page.goto('/signin');
    await page.locator('.signin-methods ion-button').nth(1).click();
    await expect(page.locator('.signin-panel ion-button')).toContainText('Send Magic Link');
  });

  test('email panel shows back link', async ({ page }) => {
    await page.goto('/signin');
    await page.locator('.signin-methods ion-button').nth(1).click();
    await expect(page.locator('.signin-panel .back-link')).toContainText('Back to sign-in options');
  });

  test('clicking back returns to main panel', async ({ page }) => {
    await page.goto('/signin');
    await page.locator('.signin-methods ion-button').nth(1).click();
    await expect(page.locator('#signin-email')).toBeVisible();
    await page.locator('.signin-panel .back-link').click();
    await expect(page.locator('.google-btn')).toBeVisible();
  });

  test('send magic link button disabled without email', async ({ page }) => {
    await page.goto('/signin');
    await page.locator('.signin-methods ion-button').nth(1).click();
    const btn = page.locator('.signin-panel ion-button').first();
    await expect(btn).toHaveAttribute('disabled', '');
  });

  test('sending magic link shows success message', async ({ page }) => {
    await page.goto('/signin');
    await page.locator('.signin-methods ion-button').nth(1).click();
    await page.fill('#signin-email', 'test@example.com');
    await page.locator('.signin-panel ion-button').first().click();
    await expect(page.locator('.msg-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.msg-success')).toContainText('Check your email');
  });
});

test.describe('Signin Page - Footer', () => {
  test('shows social links', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('.signin-footer-social a')).toHaveCount(3);
  });

  test('shows legal links', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('.signin-footer-legal')).toContainText('Terms');
    await expect(page.locator('.signin-footer-legal')).toContainText('Privacy');
  });
});

test.describe('Signin Page - Navigation', () => {
  test('back to search navigates to homepage', async ({ page }) => {
    await page.goto('/signin');
    await page.locator('.back-link').last().click();
    await expect(page).toHaveURL('/');
  });
});
