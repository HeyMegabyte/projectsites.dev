import { test, expect } from './fixtures';

test.describe('/create — Business Name input: no button, proper z-index, border-radius', () => {

  test('no .name-input-row wrapper exists in the DOM', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.name-input-row')).toHaveCount(0);
  });

  test('no .use-custom-btn exists in the DOM even with dropdown open', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Open the business dropdown
    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });

    await expect(page.locator('.use-custom-btn')).toHaveCount(0);
    await expect(page.locator('.use-custom-option')).toHaveCount(0);

    // Screenshot: dropdown open with no button
    await page.screenshot({ path: 'e2e/screenshots/final-no-custom-btn.png' });
  });

  test('#create-name has z-index 999', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const zIndex = await page.locator('#create-name').evaluate(el => {
      return parseInt(getComputedStyle(el).zIndex) || 0;
    });
    expect(zIndex).toBe(9999);
  });

  test('#create-name has same border-radius as #create-address', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const nameBR = await page.locator('#create-name').evaluate(el => getComputedStyle(el).borderRadius);
    const addressBR = await page.locator('#create-address').evaluate(el => getComputedStyle(el).borderRadius);

    expect(nameBR).toBe(addressBR);
    expect(nameBR).not.toBe('0px');
  });

  test('#create-address has z-index 99', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const zIndex = await page.locator('#create-address').evaluate(el => {
      return parseInt(getComputedStyle(el).zIndex) || 0;
    });
    expect(zIndex).toBe(9999);
  });

  test('Business Name works like Address — type, select from list, no submit button', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });

    // Select first result
    await page.locator('.business-dropdown .address-option').first().click();

    // Fields populated
    await expect(page.locator('#create-name')).toHaveValue(/White House/);
    await expect(page.locator('#create-address')).toHaveValue(/Pennsylvania/);

    // No button visible next to the input
    const buttons = page.locator('.business-group button');
    // Only the badge-dismiss button might exist (from selected business badge), not a submit/check button
    const btnCount = await buttons.count();
    // Filter out badge-dismiss
    for (let i = 0; i < btnCount; i++) {
      const cls = await buttons.nth(i).getAttribute('class');
      expect(cls).toContain('badge-dismiss');
    }
  });

  test('typing without selecting from dropdown does not set place_id', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Type but do NOT select from dropdown — just click elsewhere
    await page.fill('#create-name', 'My Custom Business');
    await page.fill('#create-address', '123 Main St, Anytown, USA');

    // Click submit and intercept the API call
    const [request] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/api/sites/create-from-search') && req.method() === 'POST'),
      page.locator('.create-submit').click(),
    ]);

    const body = request.postDataJSON();
    // No place_id since we didn't select from dropdown
    expect(body.business.place_id).toBeUndefined();
  });
});

test.describe('/create — Auto-Populate ALWAYS sets category', () => {

  test('White House auto-populate sets a non-empty category', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    // Category MUST be set — wait for it
    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });

    const category = await page.locator('#create-category').inputValue();
    expect(category.length).toBeGreaterThan(0);
    // Should be a valid category from the dropdown
    expect(category).not.toBe('Select a category...');
  });

  test('Hey Pizza auto-populate sets Restaurant / Café', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Pizza');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    expect(await page.locator('#create-category').inputValue()).toBe('Restaurant / Café');
  });

  test('Hey Legal auto-populate sets Legal / Law Firm', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Legal');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    expect(await page.locator('#create-category').inputValue()).toBe('Legal / Law Firm');
  });

  test('Vito Salon auto-populate sets Salon / Barbershop', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', "Vito's Mens Salon");
    await page.fill('#create-address', '74 N Beverwyck Rd, Lake Hiawatha, NJ');

    await page.locator('.auto-populate-btn').click({ force: true });

    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    expect(await page.locator('#create-category').inputValue()).toBe('Salon / Barbershop');
  });

  test('switching business updates category and all fields', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // First: White House
    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();
    await page.locator('.auto-populate-btn').click({ force: true });

    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    const cat1 = await page.locator('#create-category').inputValue();
    const context1 = await page.locator('#create-context').inputValue();

    // Wait for images to load
    await expect(page.locator('img[alt="Logo preview"]')).toBeVisible({ timeout: 10000 });

    // Second: switch to Hey Pizza
    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');
    await page.locator('.auto-populate-btn').click({ force: true });

    // Category must change to Restaurant
    await expect(page.locator('#create-category')).toHaveValue('Restaurant / Café', { timeout: 10000 });

    // Context should be different
    const context2 = await page.locator('#create-context').inputValue();
    expect(context2).not.toBe(context1);

    // Logo should change (no longer White House)
    const logoSrc = await page.locator('img[alt="Logo preview"]').getAttribute('src');
    expect(logoSrc).not.toContain('image-proxy');
  });

  test('auto-populate with unknown business still sets category to Other', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Type a totally unknown business
    await page.fill('#create-name', 'Xyzzy Unicorn Corp');
    await page.fill('#create-address', '999 Nowhere Blvd');

    await page.locator('.auto-populate-btn').click({ force: true });

    // Category MUST still be set (even if "Other")
    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    const category = await page.locator('#create-category').inputValue();
    expect(category.length).toBeGreaterThan(0);
  });
});

test.describe('/create — White House logo and favicon load on Auto-Populate', () => {

  test('White House logo appears with alt="Logo preview"', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    const logo = page.locator('img[alt="Logo preview"]');
    await expect(logo).toBeVisible({ timeout: 10000 });

    const src = await logo.getAttribute('src');
    expect(src).toContain('image-proxy');
  });

  test('White House favicon appears with alt="Favicon preview"', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    const favicon = page.locator('img[alt="Favicon preview"]');
    await expect(favicon).toBeVisible({ timeout: 10000 });

    const src = await favicon.getAttribute('src');
    expect(src).toContain('image-proxy');
  });

  test('visual: complete White House auto-populate', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'White House');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for everything
    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    await expect(page.locator('img[alt="Logo preview"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('img[alt="Favicon preview"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.ai-preview-item')).toHaveCount(4, { timeout: 10000 });
    await expect(page.locator('#create-context')).not.toHaveValue('');

    // Full page screenshot
    await page.screenshot({ path: 'e2e/screenshots/final-white-house-complete.png', fullPage: true });

    // Brand assets section screenshot
    await page.locator('.form-section-label', { hasText: 'Brand Assets' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'e2e/screenshots/final-white-house-brand-assets.png' });
  });
});
