import { test, expect } from './fixtures';

test.describe('Dropdown z-index — long lists overlay content', () => {

  test('homepage search dropdown with "Hey" shows 10+ results over content below', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Dismiss location modal if it appears
    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'Hey');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });

    // Should show many results (10 businesses + 1 custom = 11)
    const results = page.locator('.search-result');
    await expect(results).toHaveCount(11);

    // Dropdown z-index must be >= 999
    const dropdown = page.locator('.search-dropdown');
    const zIndex = await dropdown.evaluate(el => {
      const z = getComputedStyle(el).zIndex;
      return parseInt(z) || 0;
    });
    expect(zIndex).toBeGreaterThanOrEqual(999);
  });

  test('homepage search dropdown renders above How It Works section', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'Hey');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });

    // The dropdown should visually overlap the content below
    const dropdownBox = await page.locator('.search-dropdown').boundingBox();
    const howSection = await page.locator('#how-it-works').boundingBox();

    // Dropdown bottom edge should extend past the How It Works section top
    expect(dropdownBox).not.toBeNull();
    expect(howSection).not.toBeNull();
    if (dropdownBox && howSection) {
      expect(dropdownBox.y + dropdownBox.height).toBeGreaterThan(howSection.y);
    }

    // Take screenshot for visual inspection
    await page.screenshot({ path: 'e2e/screenshots/dropdown-zindex-homepage.png' });
  });

  test('/create business dropdown has z-index >= 999', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });

    const dropdown = page.locator('.business-dropdown');
    const zIndex = await dropdown.evaluate(el => {
      const z = getComputedStyle(el).zIndex;
      return parseInt(z) || 0;
    });
    expect(zIndex).toBeGreaterThanOrEqual(999);
  });

  test('/create business dropdown with "Hey" shows 10+ results over address field', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });

    // Should have many suggestions (10 businesses)
    const options = page.locator('.business-dropdown .address-option');
    await expect(options).toHaveCount(10);

    // Dropdown should visually cover the address field
    const dropdownBox = await page.locator('.business-dropdown').boundingBox();
    const addressBox = await page.locator('#create-address').boundingBox();
    expect(dropdownBox).not.toBeNull();
    expect(addressBox).not.toBeNull();
    if (dropdownBox && addressBox) {
      expect(dropdownBox.y + dropdownBox.height).toBeGreaterThan(addressBox.y);
    }

    // Screenshot for visual inspection
    await page.screenshot({ path: 'e2e/screenshots/dropdown-zindex-create.png' });
  });
});

test.describe('Auto-Populate always sets category via AI', () => {

  test('auto-populate sets Restaurant category for Hey Pizza', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Type "Hey Pizza" and select from dropdown
    await page.fill('#create-name', 'Hey Pizza');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    // Category should be empty initially (just selected, not auto-populated yet)
    // Click Auto-Populate
    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for category to be set
    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });

    const category = await page.locator('#create-category').inputValue();
    expect(category).toBe('Restaurant / Café');

    // Textarea should also be populated
    await expect(page.locator('#create-context')).not.toHaveValue('', { timeout: 5000 });
  });

  test('auto-populate sets Salon category for Hey Salon & Spa', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Salon');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    // Select Hey Salon & Spa (should be second in list after Hey Pizza for "Hey" search,
    // but "Hey Salon" search might only match that one)
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    const category = await page.locator('#create-category').inputValue();
    expect(category).toBe('Salon / Barbershop');
  });

  test('auto-populate sets Legal category for Hey Legal Associates', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Legal');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    const category = await page.locator('#create-category').inputValue();
    expect(category).toBe('Legal / Law Firm');
  });

  test('auto-populate sets Fitness category for Hey Fitness Gym', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Fitness');
    await page.waitForSelector('.business-dropdown', { timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await page.locator('.auto-populate-btn').click({ force: true });

    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });
    const category = await page.locator('#create-category').inputValue();
    expect(category).toBe('Fitness / Gym');
  });

  test('auto-populate overwrites previously set category', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Manually select a wrong category
    await page.selectOption('#create-category', 'Technology / SaaS');
    await expect(page.locator('#create-category')).toHaveValue('Technology / SaaS');

    // Now fill pizza business and auto-populate — should overwrite to Restaurant
    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');

    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for category to change from Technology / SaaS (the categorize API is async)
    await expect(page.locator('#create-category')).not.toHaveValue('Technology / SaaS', { timeout: 10000 });

    const category = await page.locator('#create-category').inputValue();
    expect(category).toBe('Restaurant / Café');
  });

  test('auto-populate populates textarea with design recommendations', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Hey Pizza');
    await page.fill('#create-address', '100 Main St, Newark, NJ');

    await page.locator('.auto-populate-btn').click({ force: true });

    await expect(page.locator('#create-context')).not.toHaveValue('', { timeout: 10000 });
    const context = await page.locator('#create-context').inputValue();

    expect(context).toContain('Design style:');
    expect(context).toContain('Brand colors:');
    expect(context).toContain('Typography:');
    expect(context).toContain('Target audience:');
    expect(context).toContain('Recommended sections:');

    // Screenshot for visual verification
    await page.screenshot({ path: 'e2e/screenshots/auto-populate-pizza-result.png' });
  });
});
