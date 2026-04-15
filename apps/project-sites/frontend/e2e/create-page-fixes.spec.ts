import { test, expect } from './fixtures';

test.describe('/create page — Business Name has no .use-custom-btn', () => {

  test('no .use-custom-btn exists anywhere on the page', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.use-custom-btn')).toHaveCount(0);
  });

  test('no .use-custom-btn appears when business dropdown is open', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });

    // Dropdown is open — still no use-custom-btn
    await expect(page.locator('.use-custom-btn')).toHaveCount(0);

    // Also no use-custom-option in the dropdown
    await expect(page.locator('.use-custom-option')).toHaveCount(0);
  });

  test('Business Name input matches Business Address border-radius', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const nameBR = await page.locator('#create-name').evaluate(el => getComputedStyle(el).borderRadius);
    const addressBR = await page.locator('#create-address').evaluate(el => getComputedStyle(el).borderRadius);
    expect(nameBR).toBe(addressBR);
    expect(nameBR).not.toBe('0px');
  });

  test('Business Name dropdown works like Address — select from list', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });

    // Select first result
    await page.locator('.business-dropdown .address-option').first().click();

    // Name should be filled with selected business
    await expect(page.locator('#create-name')).toHaveValue(/White House/);
    // Address should be filled too
    await expect(page.locator('#create-address')).toHaveValue(/Pennsylvania/);
  });
});

test.describe('/create page — #create-address z-index: 99', () => {

  test('#create-address has z-index 99', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const zIndex = await page.locator('#create-address').evaluate(el => {
      const z = getComputedStyle(el).zIndex;
      return parseInt(z) || 0;
    });
    expect(zIndex).toBe(9999);
  });
});

test.describe('/create — White House Auto-Populate sets category + loads images', () => {

  test('select White House from dropdown then Auto-Populate sets category', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Type and select from dropdown
    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    // Verify fields are populated from selection
    await expect(page.locator('#create-name')).toHaveValue(/White House/);
    await expect(page.locator('#create-address')).toHaveValue(/1600 Pennsylvania/);

    // Click Auto-Populate
    await page.locator('.auto-populate-btn').click({ force: true });

    // Category should be auto-selected by AI
    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    const category = await page.locator('#create-category').inputValue();
    expect(category.length).toBeGreaterThan(0);
  });

  test('Auto-Populate loads White House logo with "Logo preview" alt', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    // Logo preview should appear in the DOM with alt="Logo preview"
    const logoImg = page.locator('img[alt="Logo preview"]');
    await expect(logoImg).toBeVisible({ timeout: 10000 });

    // Verify the src contains the White House logo
    const src = await logoImg.getAttribute('src');
    expect(src).toContain('image-proxy');

    // Screenshot for visual inspection
    await page.screenshot({ path: 'e2e/screenshots/white-house-logo-preview.png' });
  });

  test('Auto-Populate loads White House app icon with "Favicon preview" alt', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    // Favicon preview should appear in the DOM with alt="Favicon preview"
    const faviconImg = page.locator('img[alt="Favicon preview"]');
    await expect(faviconImg).toBeVisible({ timeout: 10000 });

    const src = await faviconImg.getAttribute('src');
    expect(src).toContain('image-proxy');
  });

  test('Auto-Populate loads additional images into the grid', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    // 4 images should appear in the grid
    await expect(page.locator('.ai-preview-item')).toHaveCount(4, { timeout: 10000 });
  });

  test('visual: full form after White House auto-populate', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for everything to load
    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    await expect(page.locator('img[alt="Logo preview"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ai-preview-item')).toHaveCount(4, { timeout: 10000 });

    // Full page screenshot for visual inspection
    await page.screenshot({ path: 'e2e/screenshots/white-house-full-auto-populate.png', fullPage: true });
  });
});
