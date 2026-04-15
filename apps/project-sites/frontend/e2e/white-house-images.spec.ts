import { test, expect } from './fixtures';

test.describe('White House Auto-Populate loads brand images', () => {

  test('White House auto-populate loads the official logo into the Logo preview', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'The White House');
    await page.fill('#create-address', '1600 Pennsylvania Avenue NW, Washington, DC 20500');

    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for logo preview to appear
    const logoImg = page.locator('.upload-preview img[alt="Logo preview"]');
    await expect(logoImg).toBeVisible({ timeout: 10000 });

    // Verify the logo src is the Wikimedia White House logo
    const src = await logoImg.getAttribute('src');
    expect(src).toContain('image-proxy');
  });

  test('White House auto-populate loads favicon', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'The White House');
    await page.fill('#create-address', '1600 Pennsylvania Avenue NW, Washington, DC 20500');

    await page.locator('.auto-populate-btn').click({ force: true });

    const faviconImg = page.locator('.upload-preview img[alt="Favicon preview"]');
    await expect(faviconImg).toBeVisible({ timeout: 10000 });

    const src = await faviconImg.getAttribute('src');
    expect(src).toContain('image-proxy');
  });

  test('White House auto-populate loads 4 images into the grid', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'The White House');
    await page.fill('#create-address', '1600 Pennsylvania Avenue NW, Washington, DC 20500');

    await page.locator('.auto-populate-btn').click({ force: true });

    const aiImages = page.locator('.ai-preview-item');
    await expect(aiImages).toHaveCount(4, { timeout: 10000 });

    // Verify image names include White House scenes
    const names = await page.locator('.ai-preview-item .upload-preview-name').allTextContents();
    expect(names.some(n => n.includes('front'))).toBe(true);
    expect(names.some(n => n.includes('south'))).toBe(true);
  });

  test('White House auto-populate shows AI badges on all discovered images', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'The White House');
    await page.fill('#create-address', '1600 Pennsylvania Avenue NW, Washington, DC 20500');

    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for images
    await expect(page.locator('.ai-preview-item')).toHaveCount(4, { timeout: 10000 });

    // Logo AI badge
    const logoBadge = page.locator('.upload-group').first().locator('.ai-badge');
    await expect(logoBadge).toBeVisible();

    // Grid AI badges
    const gridBadges = page.locator('.ai-preview-item .ai-badge');
    await expect(gridBadges).toHaveCount(4);
  });

  test('visual: White House brand assets screenshot', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'The White House');
    await page.fill('#create-address', '1600 Pennsylvania Avenue NW, Washington, DC 20500');

    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for all content
    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    await expect(page.locator('.ai-preview-item')).toHaveCount(4, { timeout: 10000 });

    await page.locator('.form-section-label', { hasText: 'Brand Assets' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'e2e/screenshots/white-house-brand-assets.png' });
  });
});

test.describe('Re-populate updates images for different business', () => {

  test('switching from White House to Hey Pizza clears old images and loads new ones', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // First: populate with White House
    await page.fill('#create-name', 'The White House');
    await page.fill('#create-address', '1600 Pennsylvania Avenue NW, Washington, DC 20500');
    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for White House images (4 grid images)
    await expect(page.locator('.ai-preview-item')).toHaveCount(4, { timeout: 10000 });

    // Verify White House logo is showing
    const logoSrc1 = await page.locator('.upload-preview img[alt="Logo preview"]').getAttribute('src');
    expect(logoSrc1).toContain('image-proxy');

    // Now: switch to Hey Pizza
    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');
    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for category to change (indicates re-populate happened)
    await expect(page.locator('#create-category')).toHaveValue('Restaurant / Café', { timeout: 10000 });

    // Images should now be Hey Pizza images (3 grid images, not 4)
    await expect(page.locator('.ai-preview-item')).toHaveCount(3, { timeout: 10000 });

    // Logo should have changed (no longer White House logo)
    const logoSrc2 = await page.locator('.upload-preview img[alt="Logo preview"]').getAttribute('src');
    expect(logoSrc2).not.toContain('image-proxy');
    expect(logoSrc2).toContain('hey-pizza-logo');
  });

  test('switching from Hey Pizza to Vito Salon updates category and images', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // First: Hey Pizza
    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');
    await page.locator('.auto-populate-btn').click({ force: true });

    await expect(page.locator('#create-category')).toHaveValue('Restaurant / Café', { timeout: 10000 });
    await expect(page.locator('.ai-preview-item')).toHaveCount(3, { timeout: 10000 });

    // Second: Vito's Salon
    await page.fill('#create-name', "Vito's Mens Salon");
    await page.fill('#create-address', '74 N Beverwyck Rd, Lake Hiawatha, NJ');
    await page.locator('.auto-populate-btn').click({ force: true });

    // Category should change to Salon
    await expect(page.locator('#create-category')).not.toHaveValue('Restaurant / Café', { timeout: 10000 });
    const category = await page.locator('#create-category').inputValue();
    expect(category).toBe('Salon / Barbershop');

    // Images should be Vito's images now
    await expect(page.locator('.ai-preview-item')).toHaveCount(3, { timeout: 10000 });
    const logoSrc = await page.locator('.upload-preview img[alt="Logo preview"]').getAttribute('src');
    expect(logoSrc).toContain('vito');
  });

  test('re-populate clears old images immediately before loading new ones', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // First populate
    await page.fill('#create-name', 'The White House');
    await page.fill('#create-address', '1600 Pennsylvania Avenue NW, Washington, DC 20500');
    await page.locator('.auto-populate-btn').click({ force: true });
    await expect(page.locator('.ai-preview-item')).toHaveCount(4, { timeout: 10000 });

    // Start second populate — images should clear
    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');

    // Intercept the discover-images request to verify it fires
    const [request] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/api/ai/discover-images') && req.method() === 'POST'),
      page.locator('.auto-populate-btn').click({ force: true }),
    ]);

    const body = request.postDataJSON();
    expect(body.name).toBe('Hey Pizza');

    // After completion, should show Hey Pizza images
    await expect(page.locator('.ai-preview-item')).toHaveCount(3, { timeout: 10000 });
  });
});
