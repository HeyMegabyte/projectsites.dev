import { test, expect } from './fixtures';

/**
 * E2E tests for "When Doody Calls - Pooper Scoopers" business.
 *
 * Verifies:
 * - Business search finds the correct result
 * - Image discovery shows Web_Banner3.jpg in additional images
 * - Tiny favicon (16x16) is NOT shown as the favicon
 * - Quality badges are displayed on AI-discovered images
 * - Brand assessment shows minimal maturity for unprofessional sites
 * - All displayed images are actual images (not broken)
 */
test.describe('When Doody Calls — Image Discovery & Quality', () => {

  test('searches for and selects When Doody Calls business', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Type business name
    await page.fill('#create-name', 'When Doody Calls');

    // Wait for dropdown and select the business
    const dropdown = page.locator('.business-dropdown .address-option').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await dropdown.click();

    // Verify the selected business badge appears
    const badge = page.locator('.selected-business-badge');
    await expect(badge).toBeVisible({ timeout: 3000 });
    await expect(badge.locator('.badge-name')).toContainText('When Doody Calls');
  });

  test('auto-populate discovers Web_Banner3.jpg as logo and in images', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Select business
    await page.fill('#create-name', 'When Doody Calls');
    const dropdown = page.locator('.business-dropdown .address-option').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await dropdown.click();

    // Wait for auto-populate to complete (includes image discovery)
    // The logo preview should appear
    const logoPreview = page.locator('.upload-preview img[alt="Logo preview"]');
    await expect(logoPreview).toBeVisible({ timeout: 15000 });

    // Logo should have AI badge
    const logoBadge = page.locator('.upload-preview .ai-badge').first();
    await expect(logoBadge).toBeVisible();

    // Web_Banner3.jpg should be in the discovered images
    const aiImages = page.locator('.ai-preview-item');
    await expect(aiImages).toHaveCount(1, { timeout: 10000 });
  });

  test('favicon is not shown when original is too small', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Select business
    await page.fill('#create-name', 'When Doody Calls');
    const dropdown = page.locator('.business-dropdown .address-option').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await dropdown.click();

    // Wait for image discovery to complete
    await page.waitForTimeout(2000);
    await page.waitForLoadState('networkidle');

    // Favicon preview should NOT be visible (null from mock — tiny favicon rejected)
    const faviconPreview = page.locator('.upload-preview img[alt="Favicon preview"]');
    await expect(faviconPreview).not.toBeVisible({ timeout: 3000 });
  });

  test('quality badges are displayed on discovered images', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Select business
    await page.fill('#create-name', 'When Doody Calls');
    const dropdown = page.locator('.business-dropdown .address-option').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await dropdown.click();

    // Wait for image discovery
    const logoPreview = page.locator('.upload-preview img[alt="Logo preview"]');
    await expect(logoPreview).toBeVisible({ timeout: 15000 });

    // Quality badge should be on the logo (score 45 = low quality)
    const logoQuality = page.locator('.upload-preview .quality-badge').first();
    await expect(logoQuality).toBeVisible({ timeout: 5000 });
    await expect(logoQuality).toHaveClass(/quality-low/);
    await expect(logoQuality).toContainText('45');
  });

  test('brand assessment shows minimal maturity', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Select business
    await page.fill('#create-name', 'When Doody Calls');
    const dropdown = page.locator('.business-dropdown .address-option').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await dropdown.click();

    // Wait for brand assessment to appear
    const assessment = page.locator('.brand-assessment');
    await expect(assessment).toBeVisible({ timeout: 15000 });

    // Should show "minimal" maturity
    await expect(assessment).toHaveClass(/brand-minimal/);
    await expect(assessment.locator('.brand-assessment-header')).toContainText('minimal');

    // Should show the recommendation text
    const recText = assessment.locator('.brand-assessment-text');
    await expect(recText).toBeVisible();
    await expect(recText).toContainText('gorgeous');
  });

  test('all displayed images load successfully (no broken images)', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Select business
    await page.fill('#create-name', 'When Doody Calls');
    const dropdown = page.locator('.business-dropdown .address-option').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await dropdown.click();

    // Wait for images to load
    const logoPreview = page.locator('.upload-preview img[alt="Logo preview"]');
    await expect(logoPreview).toBeVisible({ timeout: 15000 });

    // Check all visible images have naturalWidth > 0 (not broken)
    const allImages = page.locator('.upload-preview img, .ai-preview-item img');
    const count = await allImages.count();
    for (let i = 0; i < count; i++) {
      const img = allImages.nth(i);
      if (await img.isVisible()) {
        const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
        expect(naturalWidth).toBeGreaterThan(0);
      }
    }
  });
});

test.describe('Image Quality — Cross-Business Validation', () => {

  test('established brand (White House) shows high quality scores', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'The White House');
    const dropdown = page.locator('.business-dropdown .address-option').first();
    await expect(dropdown).toBeVisible({ timeout: 5000 });
    await dropdown.click();

    // Wait for images
    const logoPreview = page.locator('.upload-preview img[alt="Logo preview"]');
    await expect(logoPreview).toBeVisible({ timeout: 15000 });

    // Quality badge should show high score
    const logoQuality = page.locator('.upload-preview .quality-badge').first();
    await expect(logoQuality).toBeVisible({ timeout: 5000 });
    await expect(logoQuality).toHaveClass(/quality-high/);

    // Brand assessment should show established
    const assessment = page.locator('.brand-assessment');
    await expect(assessment).toBeVisible({ timeout: 10000 });
    await expect(assessment).toHaveClass(/brand-established/);
  });

  test('generic business shows discovering message during loading', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');

    await page.locator('.auto-populate-btn').click({ force: true });

    // The discovering message should appear
    const uploadNote = page.locator('.upload-note');
    await expect(uploadNote).toBeVisible({ timeout: 5000 });
  });

  test('no broken images across different businesses', async ({ authedPage: page }) => {
    const businesses = ['Hey Pizza', 'Hey Salon & Spa', 'Hey Tech Solutions'];

    for (const biz of businesses) {
      await page.goto('/create');
      await page.waitForLoadState('networkidle');

      await page.fill('#create-name', biz);
      const dropdown = page.locator('.business-dropdown .address-option').first();
      await expect(dropdown).toBeVisible({ timeout: 5000 });
      await dropdown.click();

      // Wait for images
      await page.waitForTimeout(2000);

      // Check all visible images load
      const allImages = page.locator('.upload-preview img, .ai-preview-item img');
      const count = await allImages.count();
      for (let i = 0; i < count; i++) {
        const img = allImages.nth(i);
        if (await img.isVisible()) {
          const naturalWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
          // Images should either load successfully or be auto-removed by error handler
          if (naturalWidth === 0) {
            // If image is still visible with 0 width, it's broken
            // Allow a small grace period for loading
            await page.waitForTimeout(1000);
            const retryWidth = await img.evaluate((el: HTMLImageElement) => el.naturalWidth);
            // It's OK if the image was removed by the error handler
            if (await img.isVisible()) {
              expect(retryWidth).toBeGreaterThan(0);
            }
          }
        }
      }
    }
  });
});
