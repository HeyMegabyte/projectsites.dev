import { test, expect } from './fixtures';

test.describe('Auto-Create with AI — Full Flow', () => {

  test('search for "White House" shows results in dropdown', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Dismiss location modal if it appears
    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'White House');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });

    // Should show White House in results
    await expect(page.locator('.search-result-name').first()).toContainText('White House');
  });

  test('selecting White House from dropdown shows Auto-Create button', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'White House');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });

    // The first business result should have an Auto-Create button
    const firstResult = page.locator('.search-result').first();
    await expect(firstResult.locator('.auto-create-btn')).toBeVisible();
  });

  test('clicking Auto-Create navigates to /create with auto-populate', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'White House');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });

    // Click the Auto-Create button on the first result
    await page.locator('.auto-create-btn').first().click({ force: true });

    // Should navigate to /create
    await page.waitForURL('**/create', { timeout: 5000 });
    await expect(page).toHaveURL(/\/create/);
  });

  test('Auto-Create auto-populates business name on /create', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'White House');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });
    await page.locator('.auto-create-btn').first().click({ force: true });

    await page.waitForURL('**/create', { timeout: 5000 });

    // Business name should be pre-filled
    await expect(page.locator('#create-name')).toHaveValue(/White House/i);
  });

  test('Auto-Create auto-populates address on /create', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'White House');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });
    await page.locator('.auto-create-btn').first().click({ force: true });

    await page.waitForURL('**/create', { timeout: 5000 });

    // Address should be pre-filled
    await expect(page.locator('#create-address')).toHaveValue(/1600 Pennsylvania/i);
  });

  test('Auto-Create auto-selects category on /create', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'White House');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });
    await page.locator('.auto-create-btn').first().click({ force: true });

    await page.waitForURL('**/create', { timeout: 5000 });

    // Wait for auto-populate to complete (category is set asynchronously)
    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });

    const category = await page.locator('#create-category').inputValue();
    expect(category.length).toBeGreaterThan(0);
  });

  test('Auto-Create auto-fills textarea with thorough context', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'White House');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });
    await page.locator('.auto-create-btn').first().click({ force: true });

    await page.waitForURL('**/create', { timeout: 5000 });

    // Wait for textarea to be auto-populated
    await expect(page.locator('#create-context')).not.toHaveValue('', { timeout: 10000 });

    const context = await page.locator('#create-context').inputValue();

    // Should contain design recommendations
    expect(context).toContain('Design style:');
    expect(context).toContain('Brand colors:');
    expect(context).toContain('Typography:');
    expect(context).toContain('Target audience:');
    expect(context).toContain('Recommended sections:');

    // Should NOT contain phone or address (those are already in form fields)
    expect(context).not.toContain('1600 Pennsylvania');
    expect(context).not.toContain('(202)');
    expect(context).not.toContain('Phone:');
  });

  test('Auto-Create textarea does not include address or phone info', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'White House');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });
    await page.locator('.auto-create-btn').first().click({ force: true });

    await page.waitForURL('**/create', { timeout: 5000 });
    await expect(page.locator('#create-context')).not.toHaveValue('', { timeout: 10000 });

    const context = await page.locator('#create-context').inputValue();

    // Must NOT contain location info (already in address field)
    expect(context).not.toMatch(/located at/i);
    expect(context).not.toContain('Phone:');
    expect(context).not.toContain('Existing website:');
  });

  test('Auto-Create populates phone and website fields', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'White House');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });
    await page.locator('.auto-create-btn').first().click({ force: true });

    await page.waitForURL('**/create', { timeout: 5000 });

    // Phone and website should be populated from Google Places data
    await expect(page.locator('#create-phone')).toHaveValue('(202) 456-1111');
    await expect(page.locator('#create-website')).toHaveValue('https://www.whitehouse.gov');
  });

  test('selected business badge shows on /create after Auto-Create', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'White House');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });
    await page.locator('.auto-create-btn').first().click({ force: true });

    await page.waitForURL('**/create', { timeout: 5000 });

    // Selected business badge should appear
    const badge = page.locator('.selected-business-badge');
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toContainText('White House');
  });

  test('unauthenticated Auto-Create redirects to signin', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
    }

    await page.fill('.search-input', 'White House');
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });
    await page.locator('.auto-create-btn').first().click({ force: true });

    // Unauthenticated users go to signin first
    await page.waitForURL('**/signin', { timeout: 5000 });
    await expect(page).toHaveURL(/\/signin/);
  });
});
