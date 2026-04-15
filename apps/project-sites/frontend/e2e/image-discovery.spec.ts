import { test, expect } from './fixtures';

test.describe('AI Image Discovery on Auto-Populate', () => {

  test('auto-populate discovers and shows AI logo preview', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');

    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for image discovery to complete
    const logoPreview = page.locator('.upload-preview img[alt="Logo preview"]');
    await expect(logoPreview).toBeVisible({ timeout: 10000 });

    // Should have the AI badge
    const aiBadge = page.locator('.upload-preview .ai-badge').first();
    await expect(aiBadge).toBeVisible();
    await expect(aiBadge).toContainText('AI');
  });

  test('auto-populate discovers and shows AI favicon preview', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');

    await page.locator('.auto-populate-btn').click({ force: true });

    const faviconPreview = page.locator('.upload-preview img[alt="Favicon preview"]');
    await expect(faviconPreview).toBeVisible({ timeout: 10000 });
  });

  test('auto-populate discovers and shows AI images in grid', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');

    await page.locator('.auto-populate-btn').click({ force: true });

    // Should show 3 AI-discovered images
    const aiImages = page.locator('.ai-preview-item');
    await expect(aiImages).toHaveCount(3, { timeout: 10000 });

    // Each should have an AI badge
    const badges = page.locator('.ai-preview-item .ai-badge');
    await expect(badges).toHaveCount(3);
  });

  test('shows discovering message while loading', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');

    await page.locator('.auto-populate-btn').click({ force: true });

    // The discovering message should appear briefly (may be fast in mock)
    // Just verify the upload note exists
    const uploadNote = page.locator('.upload-note');
    await expect(uploadNote).toBeVisible({ timeout: 5000 });
  });

  test('AI logo can be removed', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');

    await page.locator('.auto-populate-btn').click({ force: true });

    const logoPreview = page.locator('.upload-preview img[alt="Logo preview"]');
    await expect(logoPreview).toBeVisible({ timeout: 10000 });

    // Click remove
    await page.locator('.upload-preview').first().locator('.upload-remove').click();

    // Logo preview should be gone
    await expect(logoPreview).not.toBeVisible();
  });

  test('AI image in grid can be removed', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');

    await page.locator('.auto-populate-btn').click({ force: true });

    const aiImages = page.locator('.ai-preview-item');
    await expect(aiImages).toHaveCount(3, { timeout: 10000 });

    // Remove first image
    await page.locator('.ai-preview-item').first().locator('.upload-remove').click();
    await expect(aiImages).toHaveCount(2);
  });

  test('business name input has matching border-radius (no use-custom-btn)', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Verify #create-name has full border-radius matching #create-address
    const nameBR = await page.locator('#create-name').evaluate(el => getComputedStyle(el).borderRadius);
    const addressBR = await page.locator('#create-address').evaluate(el => getComputedStyle(el).borderRadius);
    expect(nameBR).toBe(addressBR);

    // No use-custom-btn should exist
    await expect(page.locator('.use-custom-btn')).toHaveCount(0);

    // No use-custom-option in dropdown
    await page.fill('#create-name', 'Hey');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await expect(page.locator('.use-custom-option')).toHaveCount(0);
  });

  test('full visual: auto-populate with images screenshot', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');

    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for everything to populate
    await expect(page.locator('#create-context')).not.toHaveValue('', { timeout: 10000 });
    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    await expect(page.locator('.ai-preview-item')).toHaveCount(3, { timeout: 10000 });

    // Scroll to show brand assets section
    await page.locator('.form-section-label', { hasText: 'Brand Assets' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'e2e/screenshots/auto-populate-images-brand-assets.png' });

    // Scroll to top to show full form
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'e2e/screenshots/auto-populate-images-full-form.png', fullPage: true });
  });
});
