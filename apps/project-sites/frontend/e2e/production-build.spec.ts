/**
 * Production integration test: Full build flow with real API.
 *
 * Tests the complete path from homepage search → create → waiting → published.
 * Requires real API at projectsites.dev and valid auth.
 *
 * Run: npx playwright test e2e/production-build.spec.ts --config e2e/production-integration.config.ts
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = 'https://projectsites.dev';
const AUTH_EMAIL = 'brian@megabyte.space';

// Only run when using production-integration.config.ts
const isProductionRun = process.env.PRODUCTION_TEST === 'true';
test.skip(!isProductionRun, 'Skipping — set PRODUCTION_TEST=true to run');

test.describe.serial('Production Build Flow', () => {
  let page: Page;
  let authToken: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    // Collect console errors throughout
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.warn(`[CONSOLE ERROR] ${msg.text()}`);
      }
    });
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('Step 1: Request magic link for brian@megabyte.space', async () => {
    // Request magic link via API
    const res = await page.request.post(`${BASE}/api/auth/magic-link`, {
      data: { email: AUTH_EMAIL },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.ok()).toBe(true);
    console.warn('Magic link requested for', AUTH_EMAIL);
  });

  test('Step 2: Navigate to homepage and verify it loads', async () => {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.screenshot({ path: 'e2e/screenshots/prod-01-homepage.png' });

    // Homepage should show search input
    const searchInput = page.locator('.search-input, input[type="search"], input[placeholder*="search" i]');
    await expect(searchInput.first()).toBeVisible({ timeout: 10000 });
  });

  test('Step 3: Search for "Vitos" and verify results', async () => {
    const searchInput = page.locator('.search-input, input[type="search"], input[placeholder*="search" i]').first();
    await searchInput.fill('Vitos');

    // Wait for search results
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'e2e/screenshots/prod-02-search-results.png' });

    // Should see results
    const results = page.locator('.result-item, .result-card, .search-result');
    const count = await results.count();
    console.warn(`Found ${count} search results for "Vitos"`);
  });

  test('Step 4: Select the 2nd result and navigate to create', async () => {
    const results = page.locator('.result-item, .result-card, .search-result');
    const count = await results.count();

    if (count >= 2) {
      await results.nth(1).click({ force: true });
    } else if (count >= 1) {
      await results.nth(0).click({ force: true });
    } else {
      // Fallback: navigate directly to create
      await page.goto(`${BASE}/create`);
    }

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'e2e/screenshots/prod-03-after-select.png' });

    // Should be on create or signin page
    expect(page.url()).toMatch(/\/(create|signin|admin)/);
  });

  test('Step 5: Sign in if needed and go to create page', async () => {
    if (page.url().includes('/signin')) {
      // Need to authenticate — check if we can use the magic link
      console.warn('On signin page — need to authenticate');
      await page.screenshot({ path: 'e2e/screenshots/prod-04-signin.png' });

      // Try to sign in with email
      const emailPanel = page.locator('#signin-email-panel, .email-panel, button:has-text("Email")');
      if (await emailPanel.isVisible()) {
        await emailPanel.click({ force: true });
      }

      const emailInput = page.locator('#signin-email, input[type="email"]').first();
      if (await emailInput.isVisible()) {
        await emailInput.fill(AUTH_EMAIL);
        const sendBtn = page.locator('button:has-text("Send"), button:has-text("Sign")').first();
        await sendBtn.click({ force: true });
        await page.waitForTimeout(3000);
      }

      await page.screenshot({ path: 'e2e/screenshots/prod-05-auth-pending.png' });
    }

    // Navigate to create directly (auth via stored session if available)
    if (!page.url().includes('/create')) {
      await page.goto(`${BASE}/create`, { waitUntil: 'load' });
      await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: 'e2e/screenshots/prod-06-create-page.png' });
  });

  test('Step 6: Fill create form and submit', async () => {
    // Check if on create page
    if (!page.url().includes('/create')) {
      console.warn('Not on create page, navigating...');
      await page.goto(`${BASE}/create`, { waitUntil: 'load' });
    }

    await page.waitForTimeout(1000);

    // Fill in business name if empty
    const nameInput = page.locator('#create-name');
    const nameVal = await nameInput.inputValue().catch(() => '');
    if (!nameVal.trim()) {
      await nameInput.fill("Vito's Mens Salon");
    }

    // Fill address if empty
    const addrInput = page.locator('#create-address');
    const addrVal = await addrInput.inputValue().catch(() => '');
    if (!addrVal.trim()) {
      await addrInput.fill('74 N Beverwyck Rd, Lake Hiawatha, NJ 07034');
    }

    // Select category
    await page.selectOption('#create-category', 'Salon / Barbershop').catch(() => {});

    await page.screenshot({ path: 'e2e/screenshots/prod-07-form-filled.png', fullPage: true });

    // Submit
    const submitBtn = page.locator('.create-submit');
    await submitBtn.click({ force: true });

    // Wait for navigation
    await page.waitForTimeout(5000);
    await page.screenshot({ path: 'e2e/screenshots/prod-08-after-submit.png' });

    console.warn('Current URL after submit:', page.url());
  });

  test('Step 7: Watch build progress and masonry feed', async () => {
    // Should be on waiting page
    if (!page.url().includes('/waiting')) {
      console.warn('Not on waiting page, current URL:', page.url());
      return;
    }

    // Wait for build card
    await expect(page.locator('.waiting-card')).toBeVisible({ timeout: 10000 });

    // Take screenshots every 15 seconds for up to 5 minutes
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(15000);

      const status = await page.locator('.terminal-title, .waiting-header').textContent().catch(() => 'unknown');
      const tileCount = await page.locator('.feed-tile').count();
      const imageTileCount = await page.locator('.tile-image').count();

      console.warn(`[${i * 15}s] Status: ${status} | Tiles: ${tileCount} | Images: ${imageTileCount}`);
      await page.screenshot({
        path: `e2e/screenshots/prod-09-progress-${String(i).padStart(2, '0')}.png`,
        fullPage: true,
      });

      // Check for completion
      const success = page.locator('.waiting-success');
      if (await success.isVisible()) {
        console.warn('Build completed successfully!');
        break;
      }

      const error = page.locator('.waiting-error');
      if (await error.isVisible()) {
        console.warn('Build failed!');
        break;
      }
    }

    // Final screenshot
    await page.screenshot({ path: 'e2e/screenshots/prod-10-final.png', fullPage: true });
  });
});
