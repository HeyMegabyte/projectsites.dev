import { test, expect } from './fixtures';

test.describe('Homepage Sections', () => {
  test('hero section renders with search bar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Handled');
    await expect(page.locator('.tagline')).toBeVisible();
    await expect(page.locator('.search-input')).toBeVisible();
    await expect(page.locator('.search-hint')).toBeVisible();
  });

  test('hero action buttons are visible', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.btn-accent', { hasText: 'Build Your Free Website' })).toBeVisible();
    await expect(page.locator('.btn-ghost', { hasText: 'How it works' })).toBeVisible();
  });

  test('how it works section has 3 step cards', async ({ page }) => {
    await page.goto('/');
    await page.locator('#how-it-works').scrollIntoViewIfNeeded();
    await expect(page.locator('.step-card')).toHaveCount(3);
    await expect(page.locator('.step-number')).toHaveCount(3);
  });

  test('handled section has 3 feature cards', async ({ page }) => {
    await page.goto('/');
    await page.locator('#handled').scrollIntoViewIfNeeded();
    await expect(page.locator('.handled-card')).toHaveCount(3);
  });

  test('trust bar shows all trust items', async ({ page }) => {
    await page.goto('/');
    await page.locator('#trust').scrollIntoViewIfNeeded();
    await expect(page.locator('.trust-item')).toHaveCount(4);
  });

  test('done-for-you vs DIY comparison renders', async ({ page }) => {
    await page.goto('/');
    await page.locator('#dvd').scrollIntoViewIfNeeded();
    await expect(page.locator('.dvd-highlight')).toBeVisible();
    await expect(page.locator('.dvd-other')).toBeVisible();
  });

  test('FAQ section has 8 questions', async ({ page }) => {
    await page.goto('/');
    await page.locator('#faq').scrollIntoViewIfNeeded();
    await expect(page.locator('.faq-item')).toHaveCount(8);
  });

  test('FAQ accordion toggles open and closed', async ({ page }) => {
    await page.goto('/');
    await page.locator('#faq').scrollIntoViewIfNeeded();

    const firstQuestion = page.locator('.faq-question').first();
    const firstItem = page.locator('.faq-item').first();

    // Initially closed
    await expect(firstItem).not.toHaveClass(/open/);

    // Click to open
    await firstQuestion.click();
    await expect(firstItem).toHaveClass(/open/);

    // Click again to close
    await firstQuestion.click();
    await expect(firstItem).not.toHaveClass(/open/);
  });

  test('pricing section shows free and paid plans', async ({ page }) => {
    await page.goto('/');
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await expect(page.locator('.pricing-card-free')).toBeVisible();
    await expect(page.locator('.pricing-card-paid')).toBeVisible();
  });

  test('pricing toggle switches between monthly and annual', async ({ page }) => {
    await page.goto('/');
    await page.locator('#pricing').scrollIntoViewIfNeeded();

    // Default monthly: $50/mo
    await expect(page.locator('.pricing-card-paid .pricing-price')).toContainText('$50');

    // Toggle to annual
    await page.locator('.pricing-toggle-switch').click();
    await expect(page.locator('.pricing-card-paid .pricing-price')).toContainText('$40');

    // Toggle back to monthly
    await page.locator('.pricing-toggle-switch').click();
    await expect(page.locator('.pricing-card-paid .pricing-price')).toContainText('$50');
  });

  test('contact form renders with required fields', async ({ page }) => {
    await page.goto('/');
    await page.locator('#contact-section').scrollIntoViewIfNeeded();
    await expect(page.locator('#contact-name')).toBeVisible();
    await expect(page.locator('#contact-email')).toBeVisible();
    await expect(page.locator('#contact-message')).toBeVisible();
    await expect(page.locator('#contact-phone')).toBeVisible();
  });

  test('contact form validates required fields', async ({ page }) => {
    await page.goto('/');
    await page.locator('#contact-section').scrollIntoViewIfNeeded();

    // Submit empty form
    await page.locator('#contact-section .btn-accent').click();

    // Should show toast error
    await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.toast')).toContainText('required');
  });

  test('contact form submits successfully', async ({ page }) => {
    await page.goto('/');
    await page.locator('#contact-section').scrollIntoViewIfNeeded();

    await page.fill('#contact-name', 'Test User');
    await page.fill('#contact-email', 'test@example.com');
    await page.fill('#contact-message', 'Hello from tests!');
    await page.locator('#contact-section .btn-accent').click();

    // Should show success message
    await expect(page.locator('.contact-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.contact-success h3')).toContainText('Message sent');
  });

  test('footer shows social links and legal', async ({ page }) => {
    await page.goto('/');
    await page.locator('.site-footer').scrollIntoViewIfNeeded();
    await expect(page.locator('.footer-social a')).toHaveCount(6);
    await expect(page.locator('.footer-bottom')).toContainText('Megabyte LLC');
  });

  test('search dropdown appears on input', async ({ page }) => {
    await page.goto('/');
    await page.fill('.search-input', "Vito's Mens");
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });
    await expect(page.locator('.search-result')).toHaveCount(3); // 2 results + custom option
  });

  test('search shows custom build option', async ({ page }) => {
    await page.goto('/');
    await page.fill('.search-input', "Vito's Mens");
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });
    await expect(page.locator('.search-result-custom')).toBeVisible();
    await expect(page.locator('.search-result-custom')).toContainText('Build a custom website');
  });
});
