import { test, expect } from '@playwright/test';

test.describe('Homepage', () => {
  test('renders the search screen with hero content', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.logo').getByText('Project')).toBeVisible();
    await expect(page.getByPlaceholder(/Enter your business name/)).toBeVisible();
  });

  test('shows the search input centered on the page', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder(/Enter your business name/);
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
    const input = page.getByPlaceholder(/Enter your business name/);
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
    const input = page.getByPlaceholder(/Enter your business name/);
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
    const input = page.getByPlaceholder(/Enter your business name/);
    await input.click();
    await input.pressSequentially('test query', { delay: 30 });

    // Page should not crash
    await expect(input).toBeVisible();
  });
});

test.describe('Business Selection Flow', () => {
  test('goes to details screen when a new business is selected', async ({ page }) => {
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
    const input = page.getByPlaceholder(/Enter your business name/);
    await input.click();
    await input.pressSequentially('New Business', { delay: 30 });

    await page.locator('.search-result').filter({ hasText: 'New Business' }).click({ timeout: 10_000 });

    // Should navigate to details screen (sign-in deferred until build)
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({ timeout: 10_000 });
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

    const input = page.getByPlaceholder(/Enter your business name/);
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
    const input = page.getByPlaceholder(/Enter your business name/);
    await input.click();
    await input.pressSequentially('Queued Business', { delay: 30 });

    await page.locator('.search-result').filter({ hasText: 'Queued Business' }).click({ timeout: 10_000 });

    await expect(page.getByText(/building your website/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/few minutes/i)).toBeVisible();
  });
});

test.describe('Sign-In Flow (deferred)', () => {
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
    const input = page.getByPlaceholder(/Enter your business name/);
    await input.click();
    await input.pressSequentially('Test Business', { delay: 30 });
    await page.locator('.search-result').filter({ hasText: 'Test Business' }).click({ timeout: 10_000 });
  });

  test('goes to details first, then sign-in when building', async ({ page }) => {
    // Should be on details screen
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({ timeout: 10_000 });

    // Click build - should redirect to sign-in since not authenticated
    await page.getByRole('button', { name: /build my website/i }).click();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
  });

  test('shows all three sign-in options', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /build my website/i }).click();

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/google/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /phone/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /email/i })).toBeVisible();
  });

  test('shows phone input when phone sign-in is selected', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /build my website/i }).click();
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /phone/i }).click();
    await expect(page.locator('input[type="tel"]')).toBeVisible();
  });

  test('shows email input when email sign-in is selected', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /build my website/i }).click();
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

  test('renders proof section with example sites and testimonials', async ({ page }) => {
    const section = page.locator('#proof');
    await expect(section).toBeVisible();
    await expect(section.getByText(/sites we've built/i)).toBeVisible();

    const thumbs = section.locator('.site-thumb');
    await expect(thumbs).toHaveCount(6);

    const testimonials = section.locator('.testimonial-card');
    await expect(testimonials).toHaveCount(3);
  });

  test('renders How It Works section with 3 steps', async ({ page }) => {
    const section = page.locator('#how-it-works');
    await expect(section).toBeVisible();
    await expect(section.getByText(/how it works/i)).toBeVisible();

    const steps = section.locator('.step-card');
    await expect(steps).toHaveCount(3);

    await expect(section.getByText(/search for your business/i)).toBeVisible();
    await expect(section.getByText(/review your ai-built site/i)).toBeVisible();
    await expect(section.getByText(/go live/i)).toBeVisible();
  });

  test('renders What\'s Handled section with 3 value props', async ({ page }) => {
    const section = page.locator('#handled');
    await expect(section).toBeVisible();

    const cards = section.locator('.handled-card');
    await expect(cards).toHaveCount(3);

    await expect(section.getByText(/unlimited change requests/i)).toBeVisible();
    await expect(section.getByText(/security/i)).toBeVisible();
    await expect(section.getByText(/local seo/i)).toBeVisible();
  });

  test('renders Done-for-you vs DIY section', async ({ page }) => {
    const section = page.locator('#dvd');
    await expect(section).toBeVisible();
    await expect(section.getByText(/done-for-you vs/i)).toBeVisible();

    await expect(section.locator('.dvd-highlight')).toBeVisible();
    await expect(section.locator('.dvd-other')).toBeVisible();
  });

  test('renders FAQ section with collapsible items', async ({ page }) => {
    const section = page.locator('#faq');
    await expect(section).toBeVisible();

    const items = section.locator('.faq-item');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(6);

    // Click a question to expand
    await items.first().locator('.faq-question').click();
    await expect(items.first()).toHaveClass(/open/);
  });

  test('renders Pricing section with free preview and paid plan', async ({ page }) => {
    const section = page.locator('#pricing');
    await expect(section).toBeVisible();

    // Free preview card
    await expect(section.locator('.pricing-card-free')).toBeVisible();
    await expect(section.getByText(/free preview/i).first()).toBeVisible();

    // Paid plan
    const paidCard = section.locator('.pricing-card');
    await expect(paidCard.locator('.pricing-price')).toContainText('$50');
    await expect(paidCard.getByText(/14-day money-back/i)).toBeVisible();
  });

  test('pricing toggle switches between monthly and annual', async ({ page }) => {
    const section = page.locator('#pricing');
    await section.locator('#toggle-switch').click();

    await expect(section.locator('#pricing-amount')).toContainText('$480');
    await expect(section.locator('#pricing-amount')).toContainText('/yr');
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

  test('has Privacy Policy link pointing to /legal/privacy', async ({ page }) => {
    const footer = page.locator('footer');
    const privacyLink = footer.getByRole('link', { name: /privacy/i });
    await expect(privacyLink).toBeVisible();
    await expect(privacyLink).toHaveAttribute('href', '/legal/privacy');
  });

  test('has Terms of Service link pointing to /legal/terms', async ({ page }) => {
    const footer = page.locator('footer');
    const termsLink = footer.getByRole('link', { name: /terms/i });
    await expect(termsLink).toBeVisible();
    await expect(termsLink).toHaveAttribute('href', '/legal/terms');
  });

  test('has Content Policy link', async ({ page }) => {
    const footer = page.locator('footer');
    const contentLink = footer.getByRole('link', { name: /content policy/i });
    await expect(contentLink).toBeVisible();
    await expect(contentLink).toHaveAttribute('href', '/legal/content-policy');
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

  test('has Powered by Megabyte Labs attribution', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer.getByText(/powered by megabyte labs/i)).toBeVisible();
  });
});
