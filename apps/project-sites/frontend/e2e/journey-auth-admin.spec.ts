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

test.describe('Journey 2: Auth & Admin', () => {
  test('Signin page shows Google and Email options', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/signin');
    await page.waitForLoadState('networkidle');
    // Google button
    await expect(page.locator('text=Continue with Google')).toBeVisible();
    // Email button
    await expect(page.locator('text=Continue with Email')).toBeVisible();
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Email panel shows on click and has email input', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/signin');
    await page.waitForLoadState('networkidle');
    // Click email button
    await page.locator('text=Continue with Email').click();
    // Email input should be visible
    const emailInput = page.locator('#signin-email');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('type', 'email');
    // "Send Magic Link" button should be visible
    await expect(page.locator('text=Send Magic Link')).toBeVisible();
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Email validation shows error for invalid format', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/signin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Continue with Email').click();
    const emailInput = page.locator('#signin-email');
    await emailInput.fill('not-an-email');
    await page.locator('text=Send Magic Link').click();
    // Should see a toast or error message about invalid email
    // The toast service shows: "Please enter a valid email address"
    await expect(page.locator('text=Please enter a valid email address')).toBeVisible({ timeout: 3000 });
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Magic link sends successfully with valid email', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/signin');
    await page.waitForLoadState('networkidle');
    await page.locator('text=Continue with Email').click();
    const emailInput = page.locator('#signin-email');
    await emailInput.fill('test@example.com');
    await page.locator('text=Send Magic Link').click();
    // Should see success message about checking email (use .first() as toast + inline both show)
    await expect(page.locator('text=Check your email').first()).toBeVisible({ timeout: 5000 });
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Admin dashboard loads with site data for authenticated user', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/admin');
    await authedPage.waitForLoadState('networkidle');
    // Sidebar should be visible with site selector
    await expect(authedPage.locator('aside')).toBeVisible();
    // The site name "Vito's Mens Salon" should appear in the site selector
    await expect(authedPage.locator('text=Vito\'s Mens Salon').first()).toBeVisible({ timeout: 5000 });
    // Breadcrumb should show "Dashboard"
    await expect(authedPage.locator('text=Dashboard').first()).toBeVisible();
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Sidebar navigation works - click Editor, verify URL changes', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/admin');
    await authedPage.waitForLoadState('networkidle');
    // Wait for sites to load
    await expect(authedPage.locator('text=Vito\'s Mens Salon').first()).toBeVisible({ timeout: 5000 });
    // Click Editor nav item
    await authedPage.locator('a.nav-item:has-text("Editor")').click();
    await authedPage.waitForURL('**/admin/editor');
    expect(authedPage.url()).toContain('/admin/editor');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Sidebar navigation - Analytics section', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/admin');
    await authedPage.waitForLoadState('networkidle');
    await expect(authedPage.locator('text=Vito\'s Mens Salon').first()).toBeVisible({ timeout: 5000 });
    await authedPage.locator('a.nav-item:has-text("Analytics")').click();
    await authedPage.waitForURL('**/admin/analytics');
    expect(authedPage.url()).toContain('/admin/analytics');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Site dropdown opens and lists sites', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/admin');
    await authedPage.waitForLoadState('networkidle');
    await expect(authedPage.locator('text=Vito\'s Mens Salon').first()).toBeVisible({ timeout: 5000 });
    // Click the site selector button (has chevron svg)
    const siteSelector = authedPage.locator('aside .px-3.pt-3 button').first();
    await siteSelector.click();
    // Dropdown should appear with the site name and "Add New Site"
    const dropdown = authedPage.locator('.site-dropdown-anim');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    await expect(dropdown).toContainText("Vito's Mens Salon");
    await expect(dropdown).toContainText('Add New Site');
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Breadcrumbs update per section', async ({ authedPage }) => {
    const errors = setupConsoleCollector(authedPage);
    await authedPage.goto('/admin');
    await authedPage.waitForLoadState('networkidle');
    await expect(authedPage.locator('text=Vito\'s Mens Salon').first()).toBeVisible({ timeout: 5000 });
    // Navigate to Billing
    await authedPage.locator('a.nav-item:has-text("Billing")').click();
    await authedPage.waitForURL('**/admin/billing');
    // Breadcrumb should show section name (the last breadcrumb text)
    // The breadcrumb chain: ProjectSites > {site name} > {section}
    const breadcrumbText = authedPage.locator('.flex.items-center.gap-1\\.5 span.text-white.font-semibold');
    await expect(breadcrumbText).toBeVisible({ timeout: 3000 });
    expect(filterNoise(errors)).toEqual([]);
  });

  test('Unauthenticated /admin shows sign-in prompt', async ({ page }) => {
    const errors = setupConsoleCollector(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    // Should show the sign-in prompt (not the dashboard)
    await expect(page.locator('text=Sign in to access your admin dashboard')).toBeVisible();
    // Sign In button/link should be visible
    await expect(page.locator('a[href="/signin"]:has-text("Sign In")')).toBeVisible();
    expect(filterNoise(errors)).toEqual([]);
  });
});
