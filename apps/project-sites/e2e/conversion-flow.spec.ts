/**
 * E2E test for the conversion flow on a live project site.
 *
 * Tests the domain availability check triggered by the CTA bar
 * on a published site. Verifies that the RDAP fallback works
 * correctly when WhoisXML credits are exhausted.
 *
 * Run with:
 *   BASE_URL=https://blue-bottle-coffee.projectsites.dev npx playwright test conversion-flow
 */

import { test, expect } from '@playwright/test';

const SITE_URL =
  process.env.CONVERSION_SITE_URL || 'https://blue-bottle-coffee.projectsites.dev';

test.describe('Conversion Flow — Domain Availability', () => {
  test.setTimeout(60_000);

  test('shakebootyshake8.com shows as available via domain check', async ({ browser }) => {
    // Use a fresh context without the CDN-blocking fixture (needs real external assets)
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // 1. Navigate to the live site
      await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // 2. Scroll down to trigger the sticky CTA bar
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

      // 3. Click the "Claim for $50/mo" button to open the ownership modal
      const claimButton = page.locator('#ps-claim-btn');
      await expect(claimButton).toBeVisible({ timeout: 10_000 });
      await claimButton.click();

      // 4. Wait for the modal to appear
      const modal = page.locator('#ps-modal');
      await expect(modal).toBeVisible({ timeout: 5_000 });

      // 5. Type the domain name in the input field
      const domainInput = page.locator('#ps-dinput');
      await expect(domainInput).toBeVisible({ timeout: 5_000 });
      await domainInput.fill('shakebootyshake8');

      // 6. Wait for domain results to load (debounced fetch + render)
      // The tags replace the "Checking availability..." shimmer
      const domainTag = page.locator('.ps-tag').first();
      await expect(domainTag).toBeVisible({ timeout: 20_000 });

      // 7. Verify shakebootyshake8.com shows as available (green tag)
      const availableTag = page.locator('.ps-tag-avail', { hasText: 'shakebootyshake8.com' });
      await expect(availableTag).toBeVisible({ timeout: 10_000 });

      // 8. Verify at least one domain shows as available
      const allAvailableTags = page.locator('.ps-tag-avail');
      const availableCount = await allAvailableTags.count();
      expect(availableCount).toBeGreaterThanOrEqual(1);
    } finally {
      await context.close();
    }
  });
});
