import { test, expect } from './fixtures';

test.describe('/create — z-index and border-radius', () => {

  test('#create-address has z-index: 9999', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const z = await page.locator('#create-address').evaluate(el =>
      parseInt(getComputedStyle(el).zIndex) || 0
    );
    expect(z).toBe(9999);
  });

  test('#create-name has border-radius: var(--radius)', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const br = await page.locator('#create-name').evaluate(el =>
      getComputedStyle(el).borderRadius
    );
    expect(br).not.toBe('0px');
    // Should match #create-address
    const addrBr = await page.locator('#create-address').evaluate(el =>
      getComputedStyle(el).borderRadius
    );
    expect(br).toBe(addrBr);
  });

  test('#create-name has z-index: 9999', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const z = await page.locator('#create-name').evaluate(el =>
      parseInt(getComputedStyle(el).zIndex) || 0
    );
    expect(z).toBe(9999);
  });

  test('.business-group has z-index: 999', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const z = await page.locator('.business-group').evaluate(el =>
      parseInt(getComputedStyle(el).zIndex) || 0
    );
    expect(z).toBe(999);
  });

  test('.business-dropdown has z-index: 999', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });

    const z = await page.locator('.business-dropdown').evaluate(el =>
      parseInt(getComputedStyle(el).zIndex) || 0
    );
    expect(z).toBe(999);
  });

  test('no .use-custom-btn in DOM at any point', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Before typing
    await expect(page.locator('.use-custom-btn')).toHaveCount(0);

    // With dropdown open
    await page.fill('#create-name', 'Hey');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await expect(page.locator('.use-custom-btn')).toHaveCount(0);

    // After selecting
    await page.locator('.business-dropdown .address-option').first().click();
    await expect(page.locator('.use-custom-btn')).toHaveCount(0);
  });
});

test.describe('/create — switch from Vito to White House repopulates everything', () => {

  test('Vito auto-populate then White House auto-populate updates all fields', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // ── Step 1: Populate with Vito's ──
    await page.fill('#create-name', "Vito's Mens Salon");
    await page.fill('#create-address', '74 N Beverwyck Rd, Lake Hiawatha, NJ');
    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for Vito's category
    await expect(page.locator('#create-category')).toHaveValue('Salon / Barbershop', { timeout: 10000 });

    // Wait for Vito's context
    await expect(page.locator('#create-context')).not.toHaveValue('', { timeout: 5000 });
    const vitoContext = await page.locator('#create-context').inputValue();
    expect(vitoContext).toContain('Design style:');

    // Wait for Vito's images
    await expect(page.locator('img[alt="Logo preview"]')).toBeVisible({ timeout: 10000 });

    // Screenshot: Vito's loaded
    await page.screenshot({ path: 'e2e/screenshots/repopulate-01-vitos.png', fullPage: true });

    // ── Step 2: Switch to White House ──
    await page.fill('#create-name', 'The White House');
    await page.fill('#create-address', '1600 Pennsylvania Avenue NW, Washington, DC 20500');
    await page.locator('.auto-populate-btn').click({ force: true });

    // Category MUST change from Salon
    await expect(page.locator('#create-category')).not.toHaveValue('Salon / Barbershop', { timeout: 10000 });
    const whCategory = await page.locator('#create-category').inputValue();
    expect(whCategory.length).toBeGreaterThan(0);

    // Additional details MUST change
    await expect(page.locator('#create-context')).not.toHaveValue(vitoContext, { timeout: 10000 });
    const whContext = await page.locator('#create-context').inputValue();
    expect(whContext).toContain('Design style:');
    expect(whContext).not.toContain('Salon');

    // Phone must update (White House phone)
    await expect(page.locator('#create-phone')).toHaveValue('(202) 456-1111');

    // Website must update
    await expect(page.locator('#create-website')).toHaveValue('https://www.whitehouse.gov');

    // Logo must change to White House logo
    const logoImg = page.locator('img[alt="Logo preview"]');
    await expect(logoImg).toBeVisible({ timeout: 10000 });
    const logoSrc = await logoImg.getAttribute('src');
    expect(logoSrc).toContain('image-proxy');

    // Favicon must load
    const faviconImg = page.locator('img[alt="Favicon preview"]');
    await expect(faviconImg).toBeVisible({ timeout: 10000 });
    const favSrc = await faviconImg.getAttribute('src');
    expect(favSrc).toContain('image-proxy');

    // Images must be White House images (4 images)
    await expect(page.locator('.ai-preview-item')).toHaveCount(4, { timeout: 10000 });

    // Screenshot: White House loaded
    await page.screenshot({ path: 'e2e/screenshots/repopulate-02-whitehouse.png', fullPage: true });
  });

  test('White House logo loads through image proxy', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'The White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    const logoImg = page.locator('img[alt="Logo preview"]');
    await expect(logoImg).toBeVisible({ timeout: 10000 });

    const src = await logoImg.getAttribute('src');
    expect(src).toContain('image-proxy');
  });

  test('switching back from White House to Hey Pizza updates everything again', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Load White House first
    await page.fill('#create-name', 'The White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();
    await page.locator('.auto-populate-btn').click({ force: true });

    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    await expect(page.locator('img[alt="Logo preview"]')).toBeVisible({ timeout: 10000 });

    // Now switch to Hey Pizza
    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');
    await page.locator('.auto-populate-btn').click({ force: true });

    // Category must change to Restaurant
    await expect(page.locator('#create-category')).toHaveValue('Restaurant / Café', { timeout: 10000 });

    // Logo must change (not White House anymore)
    const logoSrc = await page.locator('img[alt="Logo preview"]').getAttribute('src');
    expect(logoSrc).not.toContain('image-proxy');
    expect(logoSrc).toContain('hey-pizza');

    // Images must be 3 (not 4 like White House)
    await expect(page.locator('.ai-preview-item')).toHaveCount(3, { timeout: 10000 });

    // Context must mention restaurant
    const ctx = await page.locator('#create-context').inputValue();
    expect(ctx.toLowerCase()).toContain('restaurant');

    // Screenshot
    await page.screenshot({ path: 'e2e/screenshots/repopulate-03-heypizza.png', fullPage: true });
  });

  test('visual: brand assets section after White House auto-populate', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'The White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();
    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for all content
    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    await expect(page.locator('img[alt="Logo preview"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('img[alt="Favicon preview"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ai-preview-item')).toHaveCount(4, { timeout: 10000 });

    // Scroll to brand assets and screenshot
    await page.locator('.form-section-label', { hasText: 'Brand Assets' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'e2e/screenshots/repopulate-04-wh-brand-assets.png' });
  });
});
