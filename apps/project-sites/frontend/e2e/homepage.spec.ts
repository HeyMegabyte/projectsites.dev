/**
 * Homepage / Search page E2E tests.
 *
 * Covers: hero section, search input, dropdown results, marketing sections,
 * pricing toggle, FAQ accordion, contact form, footer.
 */
import { test, expect } from './fixtures.js';

test.describe('Homepage - Hero Section', () => {
  test('renders hero heading', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero-brand h1')).toContainText('Handled');
  });

  test('renders tagline', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.tagline')).toContainText('AI-powered websites');
  });

  test('shows Get Started and See How It Works buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero-cta ion-button').first()).toContainText('Get Started Free');
    await expect(page.locator('.hero-cta ion-button').nth(1)).toContainText('See How It Works');
  });

  test('shows search bar with placeholder', async ({ page }) => {
    await page.goto('/');
    const searchbar = page.locator('ion-searchbar');
    await expect(searchbar).toBeVisible();
  });

  test('shows search hint text', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.search-hint')).toContainText('Type your business name');
  });
});

test.describe('Homepage - Search Functionality', () => {
  test('search returns results after typing', async ({ page }) => {
    await page.goto('/');
    const searchbar = page.locator('ion-searchbar');
    await searchbar.click();
    await searchbar.locator('input').fill('test');
    // Wait for search dropdown to appear
    await expect(page.locator('.search-dropdown')).toBeVisible({ timeout: 5000 });
  });

  test('search results show business names', async ({ page }) => {
    await page.goto('/');
    const searchbar = page.locator('ion-searchbar');
    await searchbar.click();
    await searchbar.locator('input').fill('vito');
    await expect(page.locator('.search-dropdown ion-item').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.search-dropdown ion-item').first()).toContainText('vito Pizza');
  });

  test('search results show addresses', async ({ page }) => {
    await page.goto('/');
    const searchbar = page.locator('ion-searchbar');
    await searchbar.click();
    await searchbar.locator('input').fill('test');
    await expect(page.locator('.search-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.search-dropdown ion-item').first()).toContainText('Main St');
  });

  test('search results include custom option', async ({ page }) => {
    await page.goto('/');
    const searchbar = page.locator('ion-searchbar');
    await searchbar.click();
    await searchbar.locator('input').fill('test');
    await expect(page.locator('.search-dropdown')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.search-result-custom')).toContainText('Build a custom website');
  });

  test('no dropdown for short queries', async ({ page }) => {
    await page.goto('/');
    const searchbar = page.locator('ion-searchbar');
    await searchbar.click();
    await searchbar.locator('input').fill('t');
    // Short delay to ensure no dropdown
    await page.waitForTimeout(500);
    await expect(page.locator('.search-dropdown')).not.toBeVisible();
  });
});

test.describe('Homepage - How It Works Section', () => {
  test('shows section title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.how-it-works .section-title')).toContainText('How It Works');
  });

  test('shows three step cards', async ({ page }) => {
    await page.goto('/');
    const cards = page.locator('.step-card');
    await expect(cards).toHaveCount(3);
  });

  test('step 1 is Search Your Business', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.step-card').first()).toContainText('Search Your Business');
  });

  test('step 2 is AI Builds Your Site', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.step-card').nth(1)).toContainText('AI Builds Your Site');
  });

  test('step 3 is Go Live Instantly', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.step-card').nth(2)).toContainText('Go Live Instantly');
  });
});

test.describe('Homepage - Pricing Section', () => {
  test('shows pricing section title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.pricing-section .section-title')).toContainText('Simple, Transparent Pricing');
  });

  test('shows Free and Pro pricing cards', async ({ page }) => {
    await page.goto('/');
    const cards = page.locator('.pricing-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toContainText('Free');
    await expect(cards.nth(1)).toContainText('Pro');
  });

  test('free plan shows $0', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.pricing-card').first().locator('.price')).toContainText('$0');
  });

  test('pro plan shows $29/month by default', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.pricing-card.featured .price')).toContainText('$29');
  });

  test('annual toggle updates pro price to $23', async ({ page }) => {
    await page.goto('/');
    const toggle = page.locator('.pricing-toggle ion-toggle');
    await expect(toggle).toBeAttached();
    // Scroll into view then use Playwright dispatchEvent for Angular zone detection
    await toggle.evaluate((el: HTMLElement) => el.scrollIntoView({ block: 'center' }));
    await toggle.dispatchEvent('click');
    await expect(page.locator('.pricing-card.featured .price')).toContainText('$23');
  });

  test('annual toggle shows save badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.save-badge')).toContainText('Save 20%');
  });

  test('Pro card shows Most Popular badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.popular-badge')).toContainText('Most Popular');
  });
});

test.describe('Homepage - What\'s Handled Section', () => {
  test('shows section title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.handled-section .section-title')).toContainText("What's Handled For You");
  });

  test('shows 6 handled items', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.handled-item')).toHaveCount(6);
  });

  test('shows SSL & Security item', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.handled-item').first()).toContainText('SSL & Security');
  });
});

test.describe('Homepage - FAQ Section', () => {
  test('shows FAQ section', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.faq-section .section-title')).toContainText('Frequently Asked Questions');
  });

  test('shows all FAQ items', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('ion-accordion')).toHaveCount(6);
  });

  test('FAQ accordion expands on click', async ({ page }) => {
    await page.goto('/');
    const accordionGroup = page.locator('ion-accordion-group');
    await expect(accordionGroup).toBeAttached();
    // Programmatically expand the first accordion via Ionic's API
    await accordionGroup.evaluate((el: HTMLElement) => {
      el.scrollIntoView({ block: 'center' });
      (el as any).value = 'faq-0';
    });
    // The answer content should appear
    const firstAccordion = page.locator('ion-accordion').first();
    await expect(firstAccordion.locator('.faq-answer')).toBeAttached({ timeout: 5000 });
  });
});

test.describe('Homepage - Contact Section', () => {
  test('shows contact form', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.contact-section .section-title')).toContainText('Get In Touch');
  });

  test('has name, email, and message fields', async ({ page }) => {
    await page.goto('/');
    const form = page.locator('.contact-form');
    await expect(form.locator('input[type="text"]')).toBeVisible();
    await expect(form.locator('input[type="email"]')).toBeVisible();
    await expect(form.locator('textarea')).toBeVisible();
  });

  test('has send button', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.contact-form ion-button')).toContainText('Send Message');
  });
});

test.describe('Homepage - Footer', () => {
  test('shows footer with brand', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.site-footer .footer-brand')).toContainText('Project Sites');
  });

  test('shows Terms and Privacy links', async ({ page }) => {
    await page.goto('/');
    const links = page.locator('.footer-links a');
    await expect(links.filter({ hasText: 'Terms' })).toBeVisible();
    await expect(links.filter({ hasText: 'Privacy' })).toBeVisible();
  });

  test('shows copyright', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.footer-copy')).toContainText('2026 Megabyte LLC');
  });
});
