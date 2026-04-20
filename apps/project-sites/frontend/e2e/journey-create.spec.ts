import { test, expect } from './fixtures';
import { Page } from '@playwright/test';

function setupConsoleCollector(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

function filterNoise(errors: string[]): string[] {
  return errors.filter(
    (e) => !e.includes('favicon') && !e.includes('posthog') && !e.includes('Failed to load resource')
  );
}

test.describe('Journey 7: Create Flow', () => {
  test('Create page renders with form fields', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/create');
    await authedPage.waitForLoadState('networkidle');
    // Page heading
    await expect(authedPage.locator('h1')).toContainText('Create Your Website');
    // Required form fields should exist
    await expect(authedPage.locator('#create-name')).toBeVisible();
    await expect(authedPage.locator('#create-address')).toBeVisible();
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Create page pre-fills from localStorage business data', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    // Set selected business in localStorage before navigating
    await authedPage.goto('/');
    await authedPage.waitForLoadState('networkidle');
    await authedPage.evaluate(() => {
      localStorage.setItem('ps_selected_business', JSON.stringify({
        name: "Vito's Mens Salon",
        address: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
        place_id: 'place-vitos',
        phone: '(973) 123-4567',
        website: 'https://vitos-salon.com',
      }));
      localStorage.setItem('ps_mode', 'business');
    });
    await authedPage.goto('/create');
    await authedPage.waitForLoadState('networkidle');
    // Name should be pre-filled
    const nameInput = authedPage.locator('#create-name');
    await expect(nameInput).toHaveValue("Vito's Mens Salon");
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Business name autocomplete works (type "Vito", see results)', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/create');
    await authedPage.waitForLoadState('networkidle');
    const nameInput = authedPage.locator('#create-name');
    await nameInput.fill('Vito');
    // Wait for debounced autocomplete (300ms)
    const dropdown = authedPage.locator('#create-name + div, .z-\\[999\\]').last();
    // Wait for the business suggestion to appear
    await expect(authedPage.locator("text=Vito's Mens Salon").last()).toBeVisible({ timeout: 5000 });
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Auto-populate button fills context from AI', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/create');
    await authedPage.waitForLoadState('networkidle');
    const nameInput = authedPage.locator('#create-name');
    await nameInput.fill("Vito's Mens Salon");
    // Click auto-populate
    const autoPopBtn = authedPage.locator('text=Auto-Populate with AI');
    await expect(autoPopBtn).toBeVisible();
    await autoPopBtn.click();
    // Wait for auto-populate to complete (toast appears)
    await expect(authedPage.locator('text=Auto-populated').first()).toBeVisible({ timeout: 10000 });
    // Context textarea should now have content
    const contextField = authedPage.locator('#create-context');
    const contextValue = await contextField.inputValue();
    expect(contextValue.length).toBeGreaterThan(10);
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Category dropdown has options', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/create');
    await authedPage.waitForLoadState('networkidle');
    const categorySelect = authedPage.locator('#create-category');
    await expect(categorySelect).toBeVisible();
    // Should have multiple options
    const options = categorySelect.locator('option');
    const count = await options.count();
    // At least: default empty + 14 categories = 15
    expect(count).toBeGreaterThanOrEqual(10);
    // Check for a known category
    await expect(categorySelect).toContainText('Restaurant / Caf');
    await expect(categorySelect).toContainText('Salon / Barbershop');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Submit without name shows error', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/create');
    await authedPage.waitForLoadState('networkidle');
    // Clear name field, set address
    await authedPage.locator('#create-name').fill('');
    await authedPage.locator('#create-address').fill('123 Test St');
    // Click submit
    await authedPage.locator('text=Build My Website').click();
    // Should see toast error about business name required
    await expect(authedPage.locator('text=Business name is required')).toBeVisible({ timeout: 3000 });
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Submit without address shows error', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/create');
    await authedPage.waitForLoadState('networkidle');
    // Set name but clear address
    await authedPage.locator('#create-name').fill('Test Business');
    await authedPage.locator('#create-address').fill('');
    // Click submit
    await authedPage.locator('text=Build My Website').click();
    // Should see toast error about address required
    await expect(authedPage.locator('text=Business address is required')).toBeVisible({ timeout: 3000 });
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Successful submit navigates to /waiting', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/create');
    await authedPage.waitForLoadState('networkidle');
    await authedPage.locator('#create-name').fill('Test Business');
    await authedPage.locator('#create-address').fill('123 Test St, Newark, NJ 07102');
    // Click submit
    await authedPage.locator('text=Build My Website').click();
    // Should navigate to /waiting with query params
    await authedPage.waitForURL('**/waiting**', { timeout: 10000 });
    expect(authedPage.url()).toContain('/waiting');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Form draft persists in localStorage', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/create');
    await authedPage.waitForLoadState('networkidle');
    // Fill form fields
    await authedPage.locator('#create-name').fill('Draft Business');
    await authedPage.locator('#create-address').fill('456 Draft St');
    // The phone field blur calls saveFormDraft(), so fill and blur it
    await authedPage.locator('#create-phone').fill('555-1234');
    await authedPage.locator('#create-phone').blur();
    // Allow time for the save to complete
    await authedPage.waitForTimeout(300);
    // Check localStorage for the draft
    const draft = await authedPage.evaluate(() => {
      return localStorage.getItem('ps_create_draft');
    });
    expect(draft).not.toBeNull();
    const parsed = JSON.parse(draft!);
    expect(parsed.businessName).toBe('Draft Business');
    expect(parsed.businessAddress).toBe('456 Draft St');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Address autocomplete shows suggestions', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/create');
    await authedPage.waitForLoadState('networkidle');
    const addressInput = authedPage.locator('#create-address');
    await addressInput.fill('74 N Beverwyck');
    // Wait for debounced address search (300ms, min 3 chars)
    await expect(authedPage.locator('text=74 N Beverwyck Rd, Lake Hiawatha').first()).toBeVisible({ timeout: 5000 });
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Phone and website fields are optional', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/create');
    await authedPage.waitForLoadState('networkidle');
    // Phone label should say (optional)
    await expect(authedPage.locator('text=Phone').first()).toBeVisible();
    await expect(authedPage.locator('label[for="create-phone"]')).toContainText('optional');
    // Website label should say (optional)
    await expect(authedPage.locator('label[for="create-website"]')).toContainText('optional');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Unauthenticated submit redirects to /signin', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/create');
    await page.waitForLoadState('networkidle');
    await page.locator('#create-name').fill('Test Unauthed Business');
    await page.locator('#create-address').fill('123 Main St');
    await page.locator('text=Build My Website').click();
    // Should redirect to signin since not authenticated
    await page.waitForURL('**/signin', { timeout: 5000 });
    expect(page.url()).toContain('/signin');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Brand Assets section is visible', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/create');
    await authedPage.waitForLoadState('networkidle');
    // Scroll to brand assets section
    const brandSection = authedPage.locator('text=Brand Assets').first();
    await brandSection.scrollIntoViewIfNeeded();
    await expect(brandSection).toBeVisible();
    // Logo and favicon upload labels should be visible
    await expect(authedPage.locator('label[for="create-logo"]')).toBeVisible();
    await expect(authedPage.locator('label[for="create-favicon"]')).toBeVisible();
    expect(filterNoise(errors)).toEqual([]);
  });
});
