import { test, expect } from './fixtures';
import { Page } from '@playwright/test';

/**
 * Helper: collect console errors and filter out noise (favicon, posthog).
 */
function setupConsoleCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

function filterNoise(errors: string[]): string[] {
  return errors.filter(
    (e) => !e.includes('favicon') && !e.includes('posthog') && !e.includes('Failed to load resource')
  );
}

test.describe('Journey 1: Homepage', () => {
  test('page loads and h1 contains "Handled"', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const h1 = page.locator('h1');
    await expect(h1).toContainText('Handled');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('hero search input is visible', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const searchInput = page.locator('#hero input[type="text"]');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute('placeholder', /search/i);
    expect(filterNoise(errors)).toEqual([]);
  });

  test('typing in hero search triggers debounced dropdown', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const searchInput = page.locator('#hero input[type="text"]');
    await searchInput.fill('Vito');
    // Wait for debounced search (300ms) + API response
    const dropdown = page.locator('#hero .absolute.top-full');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    expect(filterNoise(errors)).toEqual([]);
  });

  test('search results show business names', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const searchInput = page.locator('#hero input[type="text"]');
    await searchInput.fill('Vito');
    const dropdown = page.locator('#hero .absolute.top-full');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    // Should contain Vito's Mens Salon from mock
    await expect(dropdown).toContainText("Vito's Mens Salon");
    expect(filterNoise(errors)).toEqual([]);
  });

  test('selecting a business (unauthenticated) navigates to /signin', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const searchInput = page.locator('#hero input[type="text"]');
    await searchInput.fill('Vito');
    const dropdown = page.locator('#hero .absolute.top-full');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    // Use dispatchEvent to avoid pointer interception from CTA overlay
    const firstResult = dropdown.locator('button').first();
    await firstResult.dispatchEvent('mousedown');
    await page.waitForURL('**/signin');
    expect(page.url()).toContain('/signin');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('selecting a business (authenticated) navigates to /create', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/');
    await authedPage.waitForLoadState('networkidle');
    const searchInput = authedPage.locator('#hero input[type="text"]');
    await searchInput.fill('Vito');
    const dropdown = authedPage.locator('#hero .absolute.top-full');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    // Use dispatchEvent to avoid pointer interception from CTA overlay
    const firstResult = dropdown.locator('button').first();
    await firstResult.dispatchEvent('mousedown');
    await authedPage.waitForURL('**/create');
    expect(authedPage.url()).toContain('/create');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('How It Works section renders 3 step cards', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const section = page.locator('#how-it-works');
    await expect(section).toBeVisible();
    // 3 steps with the step numbers 01, 02, 03
    const stepLabels = section.locator('span.text-primary\\/40');
    await expect(stepLabels).toHaveCount(3);
    await expect(stepLabels.nth(0)).toHaveText('01');
    await expect(stepLabels.nth(1)).toHaveText('02');
    await expect(stepLabels.nth(2)).toHaveText('03');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Pricing section shows $50/month', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const pricingSection = page.locator('#pricing');
    await expect(pricingSection).toBeVisible();
    await expect(pricingSection).toContainText('$50');
    await expect(pricingSection).toContainText('/month');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('FAQ accordion opens on click', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const faqSection = page.locator('#faq');
    await faqSection.scrollIntoViewIfNeeded();
    // Click the first FAQ question
    const firstQuestion = faqSection.locator('button').first();
    await firstQuestion.click();
    // The answer should now be visible
    const answer = faqSection.locator('.animate-fade-in-up').first();
    await expect(answer).toBeVisible();
    // Answer text should contain content from en.json faq.a1
    await expect(answer).toContainText('15 minutes');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('FAQ accordion closes on second click', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const faqSection = page.locator('#faq');
    await faqSection.scrollIntoViewIfNeeded();
    const firstQuestion = faqSection.locator('button').first();
    // Open
    await firstQuestion.click();
    const answer = faqSection.locator('.animate-fade-in-up').first();
    await expect(answer).toBeVisible();
    // Close
    await firstQuestion.click();
    await expect(answer).not.toBeVisible();
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Footer renders with social links', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const footer = page.locator('footer');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer).toBeVisible();
    // Check for GitHub and Twitter links
    const github = footer.locator('a[aria-label="GitHub"]');
    await expect(github).toBeVisible();
    const twitter = footer.locator('a[aria-label="Twitter"]');
    await expect(twitter).toBeVisible();
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Language toggle switches text to Spanish', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // The toggle button shows "ES" when current lang is "en" — use exact match
    const langBtn = page.getByRole('button', { name: 'ES', exact: true });
    await expect(langBtn).toBeVisible();
    await langBtn.click();
    // After switching, button should show "EN"
    const enBtn = page.getByRole('button', { name: 'EN', exact: true });
    await expect(enBtn).toBeVisible({ timeout: 3000 });
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Nav gets glassmorphism class on scroll', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const nav = page.locator('nav').first();
    // Initially no nav-scrolled class
    await expect(nav).not.toHaveClass(/nav-scrolled/);
    // Scroll down
    await page.evaluate(() => window.scrollTo(0, 200));
    // Wait for scroll handler
    await page.waitForTimeout(200);
    await expect(nav).toHaveClass(/nav-scrolled/);
    expect(filterNoise(errors)).toEqual([]);
  });

  test('CTA section search bar works', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Scroll to CTA section (bottom of page)
    const ctaInput = page.locator('input[type="text"]').last();
    await ctaInput.scrollIntoViewIfNeeded();
    await ctaInput.fill('Hey');
    // Should see dropdown with "Hey" businesses from mock
    const dropdown = page.locator('.absolute.top-full').last();
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await expect(dropdown).toContainText('Hey Pizza');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Features section renders 6 feature cards', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const featuresSection = page.locator('#features');
    await expect(featuresSection).toBeVisible();
    // 6 feature headings (h3 inside feature cards)
    const featureCards = featuresSection.locator('.grid h3');
    await expect(featureCards).toHaveCount(6);
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Social proof section shows stats', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Social proof section is right after hero, has 4 stats
    const socialSection = page.locator('section.reveal').first();
    await expect(socialSection).toContainText('1,200+');
    await expect(socialSection).toContainText('99.9%');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('"Build a custom website" option in dropdown', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const searchInput = page.locator('#hero input[type="text"]');
    await searchInput.fill('Vito');
    const dropdown = page.locator('#hero .absolute.top-full');
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    // The custom option should always appear at the bottom
    await expect(dropdown).toContainText('Build a custom website');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('no console errors throughout page navigation', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    // Scroll through sections
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    expect(filterNoise(errors)).toEqual([]);
  });
});
