import { test, expect } from './fixtures';

test.describe('택배 HEYO / EXPRESS HEYO category selection', () => {

  test('auto-populate selects Retail / Shop for express delivery business', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', '택배 HEYO / EXPRESS HEYO');
    await page.fill('#create-address', '123 Delivery Rd, Newark, NJ 07102');

    await page.locator('.auto-populate-btn').click({ force: true });

    // Category MUST be set — not empty
    await expect(page.locator('#create-category')).not.toHaveValue('', { timeout: 10000 });

    const category = await page.locator('#create-category').inputValue();
    expect(category).toBe('Retail / Shop');

    // Screenshot for visual inspection
    await page.screenshot({ path: 'e2e/screenshots/heyo-express-category.png', fullPage: true });
  });

  test('auto-populate fills textarea for express delivery business', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', '택배 HEYO / EXPRESS HEYO');
    await page.fill('#create-address', '123 Delivery Rd, Newark, NJ 07102');

    await page.locator('.auto-populate-btn').click({ force: true });

    // Context should be populated with design recommendations
    await expect(page.locator('#create-context')).not.toHaveValue('', { timeout: 10000 });
    const ctx = await page.locator('#create-context').inputValue();
    expect(ctx).toContain('Design style:');
  });

  test('switching from HEYO to White House updates category', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // First: HEYO
    await page.fill('#create-name', '택배 HEYO / EXPRESS HEYO');
    await page.fill('#create-address', '123 Delivery Rd, Newark, NJ 07102');
    await page.locator('.auto-populate-btn').click({ force: true });
    await expect(page.locator('#create-category')).toHaveValue('Retail / Shop', { timeout: 10000 });

    // Switch to White House
    await page.fill('#create-name', 'The White House');
    await page.fill('#create-address', '1600 Pennsylvania Avenue NW, Washington, DC 20500');
    await page.locator('.auto-populate-btn').click({ force: true });

    // Category must change from Retail / Shop
    await expect(page.locator('#create-category')).not.toHaveValue('Retail / Shop', { timeout: 10000 });
    const cat = await page.locator('#create-category').inputValue();
    expect(cat.length).toBeGreaterThan(0);

    // Logo should be White House
    const logo = page.locator('img[alt="Logo preview"]');
    await expect(logo).toBeVisible({ timeout: 10000 });
    const src = await logo.getAttribute('src');
    expect(src).toContain('image-proxy');
  });
});
