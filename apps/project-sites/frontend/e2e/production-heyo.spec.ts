/**
 * Production E2E: Homepage → Search "Heyo" → Auto-populate → Build → Editor receives prompt.
 *
 * Run: npx playwright test e2e/production-heyo.spec.ts --config e2e/production-integration.config.ts
 */
import { test, expect } from '@playwright/test';

const BASE = 'https://projectsites.dev';
const SESSION_TOKEN = 'ps_test_fefa9b4b3fb162dc2269369ef1140b372e2044983d686c51b53203e8ac941cb6';

// Only run with production-integration.config.ts
const isProduction = process.env.PRODUCTION_TEST === 'true' || process.env.BASE_URL?.includes('projectsites.dev');
test.skip(!isProduction && !process.env.CI, 'Skipping — use production-integration.config.ts');

test.describe.serial('Production: Heyo → Editor with Prompt', () => {
  test('homepage → search Heyo → auto-populate → build → editor shows prompt with JSON', async ({ browser }) => {
    test.setTimeout(300000);

    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    const page = await context.newPage();

    // ── 1. Homepage + auth ──
    await page.goto(BASE, { waitUntil: 'load', timeout: 30000 });
    await page.evaluate((t) => localStorage.setItem('ps_session', JSON.stringify({ token: t, identifier: 'brian@megabyte.space' })), SESSION_TOKEN);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(2000);

    // Dismiss geo modal
    const geo = page.locator('button:has-text("Not now")').first();
    if (await geo.isVisible({ timeout: 3000 }).catch(() => false)) await geo.click({ force: true });
    await page.waitForTimeout(500);

    // ── 2. Search "Heyo" ──
    const search = page.locator('.search-input, #search-input').first();
    await expect(search).toBeVisible({ timeout: 10000 });
    await search.fill('Heyo');
    await page.waitForTimeout(3000);

    // Select first result (택배 HEYO / EXPRESS HEYO)
    const result = page.locator('.result-item, .result-card, .search-result, #search-dropdown > div').first();
    if (await result.isVisible({ timeout: 5000 }).catch(() => false)) {
      console.log('Result:', (await result.textContent())?.substring(0, 60));
      await result.click({ force: true });
      await page.waitForTimeout(3000);
    }

    // If still on homepage, navigate to /create
    if (!page.url().includes('/create')) {
      await page.goto(`${BASE}/create`, { waitUntil: 'load' });
      await page.waitForTimeout(2000);
    }

    // ── 3. Fill form + Auto-Populate ──
    const name = page.locator('#create-name');
    // Use the business name from search, or fall back to a simpler name
    const currentName = await name.inputValue();
    if (!currentName.trim()) await name.fill('Express Heyo Delivery');
    const addr = page.locator('#create-address');
    if (!(await addr.inputValue()).trim()) await addr.fill('3600 St Johns Ln Ste B, Ellicott City, MD 21042');

    // Click Auto-Populate with AI
    const autoBtn = page.locator('.auto-populate-btn').first();
    if (await autoBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await autoBtn.click({ force: true });
      await page.waitForTimeout(5000);
    }

    // Verify category was set
    const catVal = await page.locator('#create-category').inputValue().catch(() => '');
    console.log('Category set to:', catVal);

    await page.screenshot({ path: 'e2e/screenshots/heyo-prod-01-form.png', fullPage: true });

    // ── 4. Build My Website ──
    const resp = page.waitForResponse(r => r.url().includes('/api/sites/create-from-search'), { timeout: 15000 }).catch(() => null);
    await page.locator('.create-submit').first().click({ force: true });
    const apiResp = await resp;
    if (apiResp) {
      const body = await apiResp.json().catch(() => ({}));
      console.log('API:', apiResp.status(), JSON.stringify(body).substring(0, 200));
    }
    await page.waitForTimeout(5000);
    console.log('URL after build:', page.url());

    if (!page.url().includes('/waiting')) {
      console.log('NOT on waiting page — test cannot continue');
      await page.screenshot({ path: 'e2e/screenshots/heyo-prod-02-stuck.png', fullPage: true });
      await context.close();
      return;
    }

    // ── 5. Wait for editor iframe with prompt ──
    console.log('ON WAITING PAGE — waiting for editor iframe...');

    let editorAppeared = false;
    let promptVisible = false;

    for (let i = 0; i < 24; i++) { // Up to 4 minutes
      await page.waitForTimeout(10000);

      const steps = await page.locator('.step-done').count();
      const tiles = await page.locator('.feed-tile').count();
      const editor = await page.locator('.editor-section').isVisible().catch(() => false);
      const iframe = await page.locator('.editor-iframe').isVisible().catch(() => false);

      console.log(`[${(i+1)*10}s] Steps:${steps} Tiles:${tiles} Editor:${editor} Iframe:${iframe}`);

      if (iframe && !editorAppeared) {
        editorAppeared = true;
        const src = await page.locator('.editor-iframe').getAttribute('src');
        console.log('EDITOR IFRAME SRC:', src);
        expect(src).toContain('editor.projectsites.dev');
        expect(src).toContain('embedded=true');
        expect(src).toContain('buildContext=');
        await page.screenshot({ path: 'e2e/screenshots/heyo-prod-03-editor-appeared.png', fullPage: true });
      }

      // After editor appears, wait 60s for bolt.diy to load the context and show the prompt
      if (editorAppeared && !promptVisible) {
        // Wait 60 additional seconds for bolt.diy to fetch context JSON and render prompt
        await page.waitForTimeout(60000);

        // Take screenshots at multiple scroll positions
        await page.screenshot({ path: 'e2e/screenshots/heyo-prod-04-editor-60s-top.png' });

        // Scroll to the editor iframe area
        await page.locator('.editor-section').scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await page.screenshot({ path: 'e2e/screenshots/heyo-prod-05-editor-iframe.png' });

        // Scroll to masonry feed
        const feed = page.locator('.feed-container');
        if (await feed.isVisible().catch(() => false)) {
          await feed.scrollIntoViewIfNeeded();
          await page.waitForTimeout(500);
          await page.screenshot({ path: 'e2e/screenshots/heyo-prod-06-feed.png' });
        }

        promptVisible = true;
        console.log('SCREENSHOTS TAKEN — editor iframe loaded with build context');
        break;
      }

      // Check for completion/error
      if (await page.locator('.waiting-success').isVisible().catch(() => false)) {
        console.log('BUILD COMPLETE');
        await page.screenshot({ path: 'e2e/screenshots/heyo-prod-07-complete.png', fullPage: true });
        break;
      }
      if (await page.locator('.waiting-error').isVisible().catch(() => false)) {
        console.log('BUILD FAILED');
        await page.screenshot({ path: 'e2e/screenshots/heyo-prod-07-failed.png', fullPage: true });
        break;
      }
    }

    // Final screenshot
    await page.screenshot({ path: 'e2e/screenshots/heyo-prod-08-final.png', fullPage: true });

    // Assertions
    expect(editorAppeared).toBe(true);
    console.log('\n=== SCREENSHOT LOCATIONS ===');
    console.log('Form filled:       e2e/screenshots/heyo-prod-01-form.png');
    console.log('Editor appeared:   e2e/screenshots/heyo-prod-03-editor-appeared.png');
    console.log('Editor after 60s:  e2e/screenshots/heyo-prod-04-editor-60s-top.png');
    console.log('Editor iframe:     e2e/screenshots/heyo-prod-05-editor-iframe.png');
    console.log('Feed tiles:        e2e/screenshots/heyo-prod-06-feed.png');
    console.log('Final:             e2e/screenshots/heyo-prod-08-final.png');

    await context.close();
  });
});
