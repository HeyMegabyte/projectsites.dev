/**
 * Production test: Submit "make a batman website" on editor.projectsites.dev
 * and monitor for errors over 2 minutes.
 *
 * Run: npx playwright test e2e/production-editor-prompt.spec.ts --config e2e/production-integration.config.ts
 */
import { test, expect } from '@playwright/test';

test.describe('editor.projectsites.dev — Prompt Submission', () => {
  test('submit "make a batman website" and monitor for 2 minutes', async ({ browser }) => {
    test.setTimeout(180000);

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();

    const consoleErrors: { time: number; text: string }[] = [];
    const networkErrors: { time: number; url: string; status: number }[] = [];
    const allConsole: { time: number; type: string; text: string }[] = [];
    const startTime = Date.now();

    page.on('console', (msg) => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const text = msg.text();

      if (msg.type() === 'error') {
        // Skip truly benign stuff
        if (text.includes('favicon.ico')) return;
        consoleErrors.push({ time: Date.now() - startTime, text });
        console.log(`[${elapsed}s] CONSOLE ERROR: ${text.substring(0, 200)}`);
      }

      // Also log warnings and info for context
      if (msg.type() === 'warning' && text.includes('[')) {
        allConsole.push({ time: Date.now() - startTime, type: 'warn', text: text.substring(0, 150) });
      }
    });

    page.on('response', (response) => {
      if (response.status() >= 500) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        networkErrors.push({ time: Date.now() - startTime, url: response.url(), status: response.status() });
        console.log(`[${elapsed}s] HTTP ${response.status()}: ${response.url()}`);
      }
    });

    // ── Step 1: Load editor ──
    console.log('Loading editor.projectsites.dev...');
    await page.goto('https://editor.projectsites.dev/', { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(3000);
    console.log('Editor loaded');

    // ── Step 2: Find and fill the textarea ──
    const textarea = page.locator('textarea').first();
    await expect(textarea).toBeVisible({ timeout: 10000 });
    await textarea.click();
    await textarea.fill('make a batman website');

    // Verify the text is in the textarea
    const val = await textarea.inputValue();
    expect(val).toBe('make a batman website');
    console.log('Prompt entered: "make a batman website"');

    await page.screenshot({ path: 'e2e/screenshots/batman-01-prompt-entered.png' });

    // ── Step 3: Submit the prompt ──
    // bolt.diy submits on Enter key when textarea is focused
    console.log('Pressing Enter to submit...');
    await textarea.press('Enter');
    await page.waitForTimeout(2000);

    // Close any modal that might have appeared (e.g., "Choose Repository Provider")
    const modalClose = page.locator('button:has-text("×"), button[aria-label="Close"], .modal-close').first();
    if (await modalClose.isVisible({ timeout: 1000 }).catch(() => false)) {
      await modalClose.click({ force: true });
      await page.waitForTimeout(500);
    }

    // Dismiss any overlay by pressing Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    console.log('Prompt submitted — monitoring for 2 minutes...');
    await page.screenshot({ path: 'e2e/screenshots/batman-02-submitted.png' });

    // ── Step 4: Monitor for 2 minutes ──
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(10000); // Every 10 seconds
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

      // Take periodic screenshots
      if (i % 3 === 0) { // Every 30 seconds
        await page.screenshot({ path: `e2e/screenshots/batman-03-monitor-${String(i).padStart(2, '0')}.png` });
      }

      console.log(`[${elapsed}s] Errors so far: ${consoleErrors.length} console, ${networkErrors.length} network`);
    }

    // ── Step 5: Final screenshot ──
    await page.screenshot({ path: 'e2e/screenshots/batman-04-final.png' });

    // ── Step 6: Report ──
    console.log('\n=== ERROR REPORT ===');
    console.log(`Duration: ${((Date.now() - startTime) / 1000).toFixed(0)}s`);
    console.log(`Console errors: ${consoleErrors.length}`);
    console.log(`Network 500s: ${networkErrors.length}`);

    if (consoleErrors.length > 0) {
      console.log('\nConsole errors:');
      for (const err of consoleErrors) {
        console.log(`  [${(err.time / 1000).toFixed(1)}s] ${err.text.substring(0, 200)}`);
      }
    }

    if (networkErrors.length > 0) {
      console.log('\nNetwork errors:');
      for (const err of networkErrors) {
        console.log(`  [${(err.time / 1000).toFixed(1)}s] ${err.status} ${err.url}`);
      }
    }

    console.log('\n=== SCREENSHOTS ===');
    console.log('Prompt entered:  e2e/screenshots/batman-01-prompt-entered.png');
    console.log('Submitted:       e2e/screenshots/batman-02-submitted.png');
    console.log('Monitor (30s):   e2e/screenshots/batman-03-monitor-00.png');
    console.log('Monitor (60s):   e2e/screenshots/batman-03-monitor-03.png');
    console.log('Monitor (90s):   e2e/screenshots/batman-03-monitor-06.png');
    console.log('Monitor (120s):  e2e/screenshots/batman-03-monitor-09.png');
    console.log('Final:           e2e/screenshots/batman-04-final.png');

    // ── Assertions ──
    // No network 500 errors at all
    expect(networkErrors).toEqual([]);

    // No console errors at all
    expect(consoleErrors).toEqual([]);

    await context.close();
  });
});
