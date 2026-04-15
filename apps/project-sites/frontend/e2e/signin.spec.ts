import { test, expect } from './fixtures';

test.describe('Sign In Page', () => {
  test('signin page renders with Google and Email options', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('h2')).toContainText('Welcome');
    await expect(page.locator('.signin-btn-google')).toBeVisible();
    await expect(page.getByText('Continue with Email')).toBeVisible();
  });

  test('back to search link navigates home', async ({ page }) => {
    await page.goto('/signin');
    await page.locator('.back-link', { hasText: 'Back to search' }).click();
    await page.waitForURL('**/');
    await expect(page.locator('h1')).toContainText('Handled');
  });

  test('email panel shows input and send button', async ({ page }) => {
    await page.goto('/signin');
    await page.getByText('Continue with Email').click();
    await expect(page.locator('#signin-email')).toBeVisible();
    await expect(page.getByText('Send Magic Link')).toBeVisible();
  });

  test('back to main from email panel', async ({ page }) => {
    await page.goto('/signin');
    await page.getByText('Continue with Email').click();
    await expect(page.locator('#signin-email')).toBeVisible();
    await page.locator('.back-link', { hasText: 'Back to sign-in options' }).click();
    await expect(page.locator('.signin-btn-google')).toBeVisible();
  });

  test('sending magic link shows success message', async ({ page }) => {
    await page.goto('/signin');
    await page.getByText('Continue with Email').click();
    await page.fill('#signin-email', 'test@example.com');
    await page.getByText('Send Magic Link').click();

    // Mock server returns token, so it should show success
    await expect(page.locator('.msg-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.msg-success')).toContainText('test@example.com');
  });

  test('invalid email shows validation error', async ({ page }) => {
    await page.goto('/signin');
    await page.getByText('Continue with Email').click();
    await page.fill('#signin-email', 'notanemail');
    await page.getByText('Send Magic Link').click();

    // Should show toast error for invalid email
    await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.toast')).toContainText('valid email');
  });

  test('signin footer shows social links and legal', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.locator('.signin-footer-social')).toBeVisible();
    await expect(page.locator('.signin-footer-legal')).toBeVisible();
  });

  test('send magic link button disabled when email empty', async ({ page }) => {
    await page.goto('/signin');
    await page.getByText('Continue with Email').click();
    const sendBtn = page.locator('.btn-accent', { hasText: 'Send Magic Link' });
    await expect(sendBtn).toBeDisabled();
  });
});
