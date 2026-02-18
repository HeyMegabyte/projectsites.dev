/**
 * E2E tests for the Logs modal, Delete with subscription option,
 * CTA buttons, and escaping fixes.
 */

import { test, expect } from './fixtures.js';

test.describe('Logs Modal UI', () => {
  test('Logs modal exists in the DOM and is initially hidden', async ({ page }) => {
    await page.goto('/');

    const logsModal = page.locator('#site-logs-modal');
    await expect(logsModal).toBeAttached();
    await expect(logsModal).not.toHaveClass(/visible/);
  });

  test('Logs modal has required child elements', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('#logs-modal-site-name')).toBeAttached();
    await expect(page.locator('#logs-container')).toBeAttached();
    await expect(page.locator('#logs-count-label')).toBeAttached();
    await expect(page.locator('.logs-refresh-btn')).toBeAttached();
  });
});

test.describe('Delete Modal with Subscription Option', () => {
  test('Delete modal exists and has subscription checkbox', async ({ page }) => {
    await page.goto('/');

    const deleteModal = page.locator('#delete-modal');
    await expect(deleteModal).toBeAttached();
    await expect(deleteModal).not.toHaveClass(/visible/);

    // Subscription option is hidden by default
    const subOption = page.locator('#delete-modal-sub-option');
    await expect(subOption).toBeAttached();
    await expect(subOption).toBeHidden();

    // Cancel checkbox exists
    await expect(page.locator('#delete-cancel-sub')).toBeAttached();
  });
});

test.describe('Credits Pill', () => {
  test('Credits pill element exists in the admin panel', async ({ page }) => {
    await page.goto('/');

    const creditsPill = page.locator('#admin-credits-pill');
    await expect(creditsPill).toBeAttached();
    // Hidden when not logged in
    await expect(creditsPill).toBeHidden();
  });
});

test.describe('CTA Buttons', () => {
  test('Build Your Free Website button calls startBuildFlow', async ({ page }) => {
    await page.goto('/');

    const ctaBtn = page.locator('.hero-ctas .btn-accent');
    await expect(ctaBtn).toBeVisible();
    await expect(ctaBtn).toHaveText('Build Your Free Website');

    // Should have onclick="startBuildFlow()"
    const onclick = await ctaBtn.getAttribute('onclick');
    expect(onclick).toContain('startBuildFlow()');
  });

  test('Get Started Now button calls startBuildFlow', async ({ page }) => {
    await page.goto('/');

    const footerCta = page.getByRole('button', { name: 'Get Started Now' });
    await expect(footerCta).toBeAttached();

    const onclick = await footerCta.getAttribute('onclick');
    expect(onclick).toContain('startBuildFlow()');
  });

  test('startBuildFlow navigates to signin when not logged in', async ({ page }) => {
    await page.goto('/');

    // Click the Build Your Free Website button
    await page.locator('.hero-ctas .btn-accent').click();

    // Should navigate to the sign-in screen
    await expect(page.locator('#screen-signin')).toHaveClass(/active/);
  });
});

test.describe('Google Place ID UI', () => {
  test('Place ID info element has a link and close button', async ({ page }) => {
    await page.goto('/');

    // Place ID link element
    const placeIdLink = page.locator('#details-place-id-text');
    await expect(placeIdLink).toBeAttached();

    // Should be an <a> tag
    const tagName = await placeIdLink.evaluate((el) => el.tagName);
    expect(tagName).toBe('A');

    // Close button (X) should exist inside the place-id-info container
    const closeBtn = page.locator('#details-place-id-info button');
    await expect(closeBtn).toBeAttached();
  });
});

test.describe('escapeAttr function', () => {
  test('page has the escapeAttr function defined', async ({ page }) => {
    await page.goto('/');

    // Verify escapeAttr exists and handles apostrophes
    const result = await page.evaluate(() => {
      return (window as unknown as Record<string, (s: string) => string>).escapeAttr(
        "Vito's Salon",
      );
    });
    expect(result).toContain('&#39;');
    expect(result).not.toContain("'");
  });
});

test.describe('Improve with AI without text', () => {
  test('Improve AI link exists and does not check for minimum text', async ({ page }) => {
    await page.goto('/');

    // The Improve with AI link should exist
    const improveBtn = page.locator('#improve-ai-btn');
    await expect(improveBtn).toBeAttached();

    // Verify the JS function does NOT contain the old validation
    const hasOldCheck = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, () => void>).improveWithAI;
      return fn ? fn.toString().includes('Please write some text first') : true;
    });
    expect(hasOldCheck).toBe(false);
  });
});
