/**
 * Production flow test: Sign in via magic link, search, create, watch masonry.
 *
 * Run: npx playwright test e2e/production-flow.spec.ts --config e2e/production-integration.config.ts --timeout 300000
 */
import { test, expect } from '@playwright/test';

const BASE = 'https://projectsites.dev';

test.describe('Production: Full Build with Masonry', () => {
  test('search somethin, select first result, fill form, build, watch masonry', async ({ browser }) => {
    test.setTimeout(300000);

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    // Collect console errors
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (text.includes('favicon') || text.includes('net::ERR') || text.includes('404') || text.includes('posthog') || text.includes('gtm')) return;
        consoleErrors.push(text);
      }
    });

    // ── Step 1: Go to homepage ──
    await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'e2e/screenshots/prod-flow-01-homepage.png' });
    console.log('Step 1: Homepage loaded');

    // ── Step 2: Click Sign In and authenticate with brian@megabyte.space ──
    // First try to sign in via the UI
    const signInBtn = page.locator('text=Sign In').first();
    if (await signInBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await signInBtn.click({ force: true });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: 'e2e/screenshots/prod-flow-02a-signin-page.png' });
    }

    // Look for email sign-in panel
    const emailBtn = page.locator('text=Email, text=email, .email-tab, button:has-text("Email")').first();
    if (await emailBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailBtn.click({ force: true });
      await page.waitForTimeout(500);
    }

    // Fill email and send magic link
    const emailInput = page.locator('input[type="email"]').first();
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailInput.fill('brian@megabyte.space');
      const sendBtn = page.locator('button:has-text("Send"), button:has-text("Magic"), button[type="submit"]').first();
      if (await sendBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await sendBtn.click({ force: true });
      }
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'e2e/screenshots/prod-flow-02b-magic-link-sent.png' });
      console.log('Step 2: Magic link requested for brian@megabyte.space');
      console.log('NOTE: Check email for magic link. Will wait 60s for auth...');

      // Wait for the user to click the magic link (poll for session)
      for (let i = 0; i < 12; i++) {
        await page.waitForTimeout(5000);
        const hasSession = await page.evaluate(() => {
          const s = localStorage.getItem('ps_session');
          return s && JSON.parse(s).token ? true : false;
        }).catch(() => false);
        if (hasSession) {
          console.log('Authenticated via magic link!');
          await page.reload({ waitUntil: 'load' });
          break;
        }
        console.log(`Waiting for auth... (${(i + 1) * 5}s)`);
      }
    }

    await page.screenshot({ path: 'e2e/screenshots/prod-flow-02c-after-auth.png' });

    // Check if signed in
    const isSignedIn = await page.evaluate(() => {
      const s = localStorage.getItem('ps_session');
      return s && JSON.parse(s).token ? true : false;
    }).catch(() => false);
    console.log('Signed in:', isSignedIn);

    if (!isSignedIn) {
      console.log('Not signed in — cannot proceed with build. Test will show what the user sees.');
    }

    // ── Step 3: Go back to homepage and search ──
    await page.goto(BASE, { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(1000);

    const searchInput = page.locator('#search-input, .search-input, input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.click();
    await searchInput.fill('somethin');
    console.log('Step 3: Typed "somethin" in search');

    // Wait for search results
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'e2e/screenshots/prod-flow-03-search-results.png' });

    // ── Step 4: Click first search result ──
    const firstResult = page.locator('.search-result, .result-item, .search-result-item, #search-dropdown > div').first();
    const resultVisible = await firstResult.isVisible({ timeout: 5000 }).catch(() => false);
    console.log('Search result visible:', resultVisible);

    if (resultVisible) {
      await firstResult.click({ force: true });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: 'e2e/screenshots/prod-flow-04-after-select.png' });
      console.log('Step 4: Clicked first result. URL:', page.url());
    } else {
      console.log('No search results visible — taking screenshot');
      await page.screenshot({ path: 'e2e/screenshots/prod-flow-04-no-results.png', fullPage: true });
    }

    // ── Step 5: If on create page, fill form and submit ──
    if (page.url().includes('/create')) {
      console.log('Step 5: On create page');
      await page.screenshot({ path: 'e2e/screenshots/prod-flow-05-create-page.png', fullPage: true });

      // Fill any empty required fields
      const nameInput = page.locator('#create-name');
      const nameVal = await nameInput.inputValue().catch(() => '');
      if (!nameVal.trim()) {
        await nameInput.fill('somethin test business');
      }

      const addrInput = page.locator('#create-address');
      const addrVal = await addrInput.inputValue().catch(() => '');
      if (!addrVal.trim()) {
        await addrInput.fill('123 Test St, Test City, NJ 07000');
      }

      await page.screenshot({ path: 'e2e/screenshots/prod-flow-05b-form-filled.png', fullPage: true });

      // Click Build My Website
      const buildBtn = page.locator('.create-submit, button:has-text("Build My Website")').first();
      await buildBtn.click({ force: true });
      console.log('Step 5: Clicked Build My Website');

      // Wait and see what happens
      await page.waitForTimeout(5000);
      await page.screenshot({ path: 'e2e/screenshots/prod-flow-06-after-build.png', fullPage: true });
      console.log('Step 6: URL after build click:', page.url());
    }

    // ── Step 6: If on waiting page, watch the masonry ──
    if (page.url().includes('/waiting')) {
      console.log('Step 6: ON WAITING PAGE — watching masonry');

      for (let i = 0; i < 20; i++) {
        await page.waitForTimeout(10000);
        const tileCount = await page.locator('.feed-tile').count();
        const imageTileCount = await page.locator('.tile-image').count();
        const stepsDone = await page.locator('.step-done').count();
        const feedVisible = await page.locator('.feed-container').isVisible().catch(() => false);

        console.log(`[${(i + 1) * 10}s] Tiles: ${tileCount} | Images: ${imageTileCount} | Steps done: ${stepsDone} | Feed visible: ${feedVisible}`);
        await page.screenshot({
          path: `e2e/screenshots/prod-flow-07-masonry-${String(i).padStart(2, '0')}.png`,
          fullPage: true,
        });

        // Check for completion
        if (await page.locator('.waiting-success').isVisible().catch(() => false)) {
          console.log('BUILD COMPLETE!');
          break;
        }
        if (await page.locator('.waiting-error').isVisible().catch(() => false)) {
          console.log('BUILD FAILED!');
          break;
        }
      }
    } else {
      console.log('NOT on waiting page. Current URL:', page.url());
      await page.screenshot({ path: 'e2e/screenshots/prod-flow-07-not-waiting.png', fullPage: true });
    }

    // Final screenshot
    await page.screenshot({ path: 'e2e/screenshots/prod-flow-08-final.png', fullPage: true });

    // Report
    console.log('Console errors:', consoleErrors.length > 0 ? consoleErrors : 'NONE');
    await context.close();
  });
});
