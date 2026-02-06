import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('renders the search screen with hero content', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.logo').getByText('Project')).toBeVisible();
    await expect(page.getByPlaceholder(/Search for your business/)).toBeVisible();
  });

  test('shows the search input centered on the page', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder(/Search for your business/);
    await expect(input).toBeVisible();
  });

  test('displays the tagline text', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero-brand').getByText(/handled/i)).toBeVisible();
  });
});

test.describe('Search Functionality', () => {
  test('shows search results dropdown when typing', async ({ page }) => {
    // Set up route interception BEFORE navigation
    await page.route('**/api/search/businesses*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { place_id: 'ChIJ_test1', name: "Joe's Pizza", address: '123 Main St, New York, NY', types: ['restaurant'] },
            { place_id: 'ChIJ_test2', name: "Joe's Plumbing", address: '456 Oak Ave, Brooklyn, NY', types: ['plumber'] },
          ],
        }),
      }),
    );

    await page.goto('/');
    const input = page.getByPlaceholder(/Search for your business/);
    await input.click();
    await input.pressSequentially('Joe', { delay: 50 });

    await expect(page.getByText("Joe's Pizza")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Joe's Plumbing")).toBeVisible();
    await expect(page.getByText('123 Main St')).toBeVisible();
  });

  test('always shows the Custom Website option at the bottom', async ({ page }) => {
    await page.route('**/api/search/businesses*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [] }),
      }),
    );

    await page.goto('/');
    const input = page.getByPlaceholder(/Search for your business/);
    await input.click();
    await input.pressSequentially('xyz nonexistent', { delay: 30 });

    await expect(page.locator('.search-dropdown .search-result-custom')).toBeVisible({ timeout: 10_000 });
  });

  test('handles search API errors gracefully', async ({ page }) => {
    await page.route('**/api/search/businesses*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Internal Server Error' }),
      }),
    );

    await page.goto('/');
    const input = page.getByPlaceholder(/Search for your business/);
    await input.click();
    await input.pressSequentially('test query', { delay: 30 });

    // Page should not crash
    await expect(input).toBeVisible();
  });
});

test.describe('Business Selection Flow', () => {
  test('checks site existence when a business result is clicked', async ({ page }) => {
    await page.route('**/api/search/businesses*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ place_id: 'ChIJ_new', name: 'New Business', address: '789 Elm St', types: ['store'] }],
        }),
      }),
    );

    await page.route('**/api/sites/lookup*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { exists: false } }),
      }),
    );

    await page.goto('/');
    const input = page.getByPlaceholder(/Search for your business/);
    await input.click();
    await input.pressSequentially('New Business', { delay: 30 });

    await page.locator('.search-result').filter({ hasText: 'New Business' }).click({ timeout: 10_000 });

    // Should navigate to sign-in screen
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
  });

  test('redirects to existing published site', async ({ page }) => {
    await page.route('**/api/search/businesses*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ place_id: 'ChIJ_existing', name: 'Existing Biz', address: '111 Pine St', types: ['restaurant'] }],
        }),
      }),
    );

    await page.route('**/api/sites/lookup*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { exists: true, site_id: 'site-123', slug: 'existing-biz', status: 'published', has_build: true },
        }),
      }),
    );

    await page.goto('/');

    // Capture the redirect URL by intercepting redirectTo
    let redirectUrl = '';
    await page.exposeFunction('__captureRedirect', (url: string) => {
      redirectUrl = url;
    });
    await page.evaluate(() => {
      (window as any).redirectTo = (url: string) => {
        (window as any).__captureRedirect(url);
      };
    });

    const input = page.getByPlaceholder(/Search for your business/);
    await input.click();
    await input.pressSequentially('Existing Biz', { delay: 30 });

    await page.locator('.search-result').filter({ hasText: 'Existing Biz' }).click({ timeout: 10_000 });

    // Wait for the redirect to fire
    await page.waitForTimeout(1000);
    expect(redirectUrl).toBe('https://existing-biz-sites.megabyte.space');
  });

  test('shows waiting screen for queued sites', async ({ page }) => {
    await page.route('**/api/search/businesses*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ place_id: 'ChIJ_queued', name: 'Queued Business', address: '222 Oak St', types: ['store'] }],
        }),
      }),
    );

    await page.route('**/api/sites/lookup*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: { exists: true, site_id: 'site-456', slug: 'queued-business', status: 'queued', has_build: false },
        }),
      }),
    );

    await page.goto('/');
    const input = page.getByPlaceholder(/Search for your business/);
    await input.click();
    await input.pressSequentially('Queued Business', { delay: 30 });

    await page.locator('.search-result').filter({ hasText: 'Queued Business' }).click({ timeout: 10_000 });

    await expect(page.getByText(/building your website/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/few minutes/i)).toBeVisible();
  });
});

test.describe('Sign-In Screen', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/search/businesses*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [{ place_id: 'ChIJ_signin_test', name: 'Test Business', address: '333 Main St', types: ['store'] }],
        }),
      }),
    );

    await page.route('**/api/sites/lookup*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { exists: false } }),
      }),
    );

    await page.goto('/');
    const input = page.getByPlaceholder(/Search for your business/);
    await input.click();
    await input.pressSequentially('Test Business', { delay: 30 });
    await page.locator('.search-result').filter({ hasText: 'Test Business' }).click({ timeout: 10_000 });
  });

  test('shows all three sign-in options', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/google/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /phone/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /email/i })).toBeVisible();
  });

  test('shows phone input when phone sign-in is selected', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /phone/i }).click();
    await expect(page.locator('input[type="tel"]')).toBeVisible();
  });

  test('shows email input when email sign-in is selected', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /email/i }).click();
    await expect(page.locator('input[type="email"]')).toBeVisible();
  });
});

test.describe('API Health', () => {
  test('health endpoint works', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('status');
  });

  test('search API returns valid JSON', async ({ request }) => {
    const res = await request.get('/api/search/businesses?q=pizza');
    expect(res.headers()['content-type']).toContain('application/json');
  });

  test('lookup API returns valid JSON', async ({ request }) => {
    const res = await request.get('/api/sites/lookup?place_id=nonexistent');
    expect(res.headers()['content-type']).toContain('application/json');
  });

  test('create-from-search requires auth', async ({ request }) => {
    const res = await request.post('/api/sites/create-from-search', {
      data: { business_name: 'Test' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(res.status());
  });
});

test.describe('Homepage Marketing Sections', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders How It Works section with 3 steps', async ({ page }) => {
    const section = page.locator('#how-it-works');
    await expect(section).toBeVisible();
    await expect(section.getByText(/how it works/i)).toBeVisible();

    const steps = section.locator('.step-card');
    await expect(steps).toHaveCount(3);

    await expect(section.getByText(/tell us about your business/i)).toBeVisible();
    await expect(section.getByText(/ai builds your site/i)).toBeVisible();
    await expect(section.getByText(/go live/i)).toBeVisible();
  });

  test('renders Features section with 4 selling points', async ({ page }) => {
    const section = page.locator('#features');
    await expect(section).toBeVisible();

    const cards = section.locator('.feature-card');
    await expect(cards).toHaveCount(4);

    await expect(section.getByText(/ai-generated content/i)).toBeVisible();
    await expect(section.getByText(/custom domains/i)).toBeVisible();
    await expect(section.getByText(/mobile-first/i)).toBeVisible();
    await expect(section.getByText(/analytics/i)).toBeVisible();
  });

  test('renders Competitor Comparison table', async ({ page }) => {
    const section = page.locator('#comparison');
    await expect(section).toBeVisible();

    // Check column headers in thead
    const thead = section.locator('thead');
    await expect(thead.getByText('Project Sites')).toBeVisible();
    await expect(thead.getByText('Squarespace')).toBeVisible();
    await expect(thead.getByText('Wix')).toBeVisible();
    await expect(thead.getByText('WordPress')).toBeVisible();

    // Check row categories
    await expect(section.getByText(/price/i)).toBeVisible();
    await expect(section.getByText(/setup time/i)).toBeVisible();
    await expect(section.getByText(/ai content/i)).toBeVisible();
  });

  test('renders Pricing section with $50/mo plan', async ({ page }) => {
    const section = page.locator('#pricing');
    await expect(section).toBeVisible();

    await expect(section.locator('.pricing-price')).toContainText('$50');
    await expect(section.locator('.pricing-price')).toContainText('/mo');
    await expect(section.locator('.pricing-features')).toContainText(/cancel anytime/i);
  });
});

test.describe('Footer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders footer with copyright notice', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.getByText(/© 2025 Megabyte LLC/)).toBeVisible();
  });

  test('has Privacy Policy link pointing to megabyte.space/privacy', async ({ page }) => {
    const footer = page.locator('footer');
    const privacyLink = footer.getByRole('link', { name: /privacy/i });
    await expect(privacyLink).toBeVisible();
    await expect(privacyLink).toHaveAttribute('href', 'https://megabyte.space/privacy');
  });

  test('has Terms of Service link pointing to megabyte.space/terms', async ({ page }) => {
    const footer = page.locator('footer');
    const termsLink = footer.getByRole('link', { name: /terms/i });
    await expect(termsLink).toBeVisible();
    await expect(termsLink).toHaveAttribute('href', 'https://megabyte.space/terms');
  });

  test('has social media links', async ({ page }) => {
    const footer = page.locator('footer');

    // Check for all 6 social links
    await expect(footer.locator('a[href*="github.com/HeyMegabyte"]')).toBeVisible();
    await expect(footer.locator('a[href*="x.com/HeyMegabyte"]')).toBeVisible();
    await expect(footer.locator('a[href*="linkedin.com"]')).toBeVisible();
    await expect(footer.locator('a[href*="youtube.com"]')).toBeVisible();
    await expect(footer.locator('a[href*="instagram.com"]')).toBeVisible();
    await expect(footer.locator('a[href*="facebook.com"]')).toBeVisible();
  });

  test('has Powered by Cloudflare attribution', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer.getByText(/powered by cloudflare/i)).toBeVisible();
  });
});
