/**
 * @module e2e/golden-path
 * @description Comprehensive end-to-end tests that verify ENTIRE user flows
 * from homepage to build completion. Each test walks through a complete journey
 * covering search, details, authentication, build submission, and waiting.
 *
 * Uses the E2E test server's built-in mocks for realistic behavior.
 *
 * @packageDocumentation
 */

import { test, expect } from './fixtures.js';
import type { Page } from '@playwright/test';

// ─── Helpers ──────────────────────────────────────────────────

/** Type a query in the search input, wait for dropdown, select a result. */
async function searchAndSelect(page: Page, query: string, resultText: string) {
  const input = page.getByPlaceholder(/Enter your business name/);
  await input.click();
  await input.pressSequentially(query, { delay: 30 });

  const result = page.locator('.search-result').filter({ hasText: resultText });
  await expect(result.first()).toBeVisible({ timeout: 15_000 });
  await result.first().click();
}

/** Stub window.redirectTo so external navigations are captured instead of executed. */
async function stubRedirects(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    (window as any).__redirects = [] as string[];
    (window as any).redirectTo = (url: string) => {
      (window as any).__redirects.push(url);
    };
  });
  return async () => page.evaluate(() => (window as any).__redirects as string[]);
}

// ─── FULL FLOW: Phone OTP ─────────────────────────────────────

test.describe('Full Flow: Phone OTP Sign-In', () => {
  test('Search → Details → Build → Phone OTP → Auto-submit → Waiting', async ({ page }) => {
    // This test uses the E2E server's built-in mocks for search, lookup,
    // phone OTP, phone verify, and create-from-search. No Playwright
    // route overrides needed.

    await page.goto('/');
    const getRedirects = await stubRedirects(page);

    // ── 1. Search and select a business ──────────────────
    await searchAndSelect(page, 'Test Pizza', 'Test Pizza');

    // ── 2. Should land on Details screen (NOT sign-in) ───
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /tell us more/i })).toBeVisible();

    // Business badge should show selected business
    await expect(page.locator('#badge-biz-name')).toContainText('Test Pizza');
    await expect(page.locator('#badge-biz-addr')).toContainText('123 Main St');

    // ── 3. Fill details and click Build ──────────────────
    await page.locator('#details-textarea').fill(
      'Family-owned pizza restaurant since 1985. Wood-fired oven, fresh ingredients.',
    );
    await page.locator('#build-btn').click();

    // ── 4. Should redirect to Sign-In (not authenticated) ─
    await expect(page.locator('#screen-signin')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

    // All three sign-in options visible
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /phone/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /email/i })).toBeVisible();

    // ── 5. Sign in with Phone ────────────────────────────
    await page.getByRole('button', { name: /phone/i }).click();
    await expect(page.locator('#phone-input')).toBeVisible();

    // Enter phone number and send OTP
    await page.locator('#phone-input').fill('+19735551234');
    await page.locator('#phone-send-btn').click();

    // OTP input should appear (phone step transitions)
    await expect(page.locator('#otp-input')).toBeVisible({ timeout: 10_000 });

    // Enter the mock OTP code (E2E server accepts '123456')
    await page.locator('#otp-input').fill('123456');
    await page.locator('#otp-verify-btn').click();

    // ── 6. After verify: auto-navigates to details, auto-submits build ──
    // The deferred sign-in flow: verifyPhoneOtp → navigateTo('details')
    // → wrapper detects _pendingBuild → auto-calls submitBuild()
    // → submitBuild has session now → creates site → navigateTo('waiting')

    await expect(page.locator('#screen-waiting')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/building your website/i)).toBeVisible();
    await expect(page.getByText(/few minutes/i)).toBeVisible();

    // Verify waiting screen has status indicators
    await expect(page.locator('.status-dot')).toBeVisible();
  });
});

// ─── FULL FLOW: Email Magic Link ──────────────────────────────

test.describe('Full Flow: Email Magic Link Sign-In', () => {
  test('Search → Details → Build → Email → Check Email → Callback → Waiting', async ({ page }) => {
    await page.goto('/');
    const getRedirects = await stubRedirects(page);

    // ── 1. Search and select ─────────────────────────────
    await searchAndSelect(page, 'Test Plumbing', 'Test Plumbing');

    // ── 2. Details screen ────────────────────────────────
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });
    await page.locator('#details-textarea').fill('Licensed plumbing since 2001.');
    await page.locator('#build-btn').click();

    // ── 3. Sign-in screen ────────────────────────────────
    await expect(page.locator('#screen-signin')).toBeVisible({ timeout: 10_000 });

    // Click Email sign-in
    await page.getByRole('button', { name: /email/i }).click();
    await expect(page.locator('#email-input')).toBeVisible();

    // Enter email and send magic link
    await page.locator('#email-input').fill('test@plumbingco.com');
    await page.locator('#email-send-btn').click();

    // "Check your email" message should appear
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 10_000 });

    // ── 4. Simulate magic link callback ──────────────────
    // Save state to sessionStorage (the app does this for Google, we simulate it)
    await page.evaluate(() => {
      const s = (window as any).state;
      if (s.selectedBusiness) {
        sessionStorage.setItem('ps_selected_business', JSON.stringify(s.selectedBusiness));
        sessionStorage.setItem('ps_mode', s.mode);
      }
      sessionStorage.setItem('ps_pending_build', '1');
    });

    // Navigate as if user clicked the magic link and was redirected back
    await page.goto('/?token=e2e-magic-link-token&email=test@plumbingco.com&auth_callback=email');

    // ── 5. After callback: restores state → details → auto-submit → waiting
    await expect(page.getByText(/building your website/i)).toBeVisible({ timeout: 15_000 });
  });
});

// ─── FULL FLOW: Google OAuth ──────────────────────────────────

test.describe('Full Flow: Google OAuth Sign-In', () => {
  test('Search → Details → Build → Google → Redirect Callback → Waiting', async ({ page }) => {
    await page.goto('/');
    const getRedirects = await stubRedirects(page);

    // ── 1. Search and select ─────────────────────────────
    await searchAndSelect(page, 'Test Coffee', 'Test Coffee');

    // ── 2. Details screen ────────────────────────────────
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });
    await page.locator('#details-textarea').fill('Specialty coffee roaster and cafe.');
    await page.locator('#build-btn').click();

    // ── 3. Sign-in screen ────────────────────────────────
    await expect(page.locator('#screen-signin')).toBeVisible({ timeout: 10_000 });

    // Click Google sign-in - this tries to redirect to /api/auth/google
    // The E2E server returns 400 for this (missing OAuth config), but the
    // frontend calls redirectTo() which we've stubbed.
    // We need to verify the redirect was captured and then simulate the callback.
    await page.getByRole('button', { name: /google/i }).click();

    // The signInWithGoogle wrapper saves state to sessionStorage before redirect
    const savedBiz = await page.evaluate(() => sessionStorage.getItem('ps_selected_business'));
    expect(savedBiz).toBeTruthy();

    const savedPending = await page.evaluate(() => sessionStorage.getItem('ps_pending_build'));
    expect(savedPending).toBe('1');

    // Verify redirect was captured
    const redirects = await getRedirects();
    expect(redirects.length).toBeGreaterThan(0);
    expect(redirects[0]).toContain('/api/auth/google');

    // ── 4. Simulate Google OAuth callback ────────────────
    await page.goto('/?token=e2e-google-token&email=test@gmail.com&auth_callback=google');

    // ── 5. After callback: restores state → details → auto-submit → waiting
    await expect(page.getByText(/building your website/i)).toBeVisible({ timeout: 15_000 });
  });
});

// ─── FULL FLOW: Custom Website ────────────────────────────────

test.describe('Full Flow: Custom Website', () => {
  test('Search → Custom option → Details (custom mode) → Phone → Waiting', async ({ page }) => {
    await page.goto('/');
    await stubRedirects(page);

    // ── 1. Search and select "Custom Website" option ─────
    const input = page.getByPlaceholder(/Enter your business name/);
    await input.click();
    await input.pressSequentially('my new project', { delay: 30 });

    // Custom Website option should appear at bottom of dropdown
    const customOption = page.locator('.search-result-custom');
    await expect(customOption).toBeVisible({ timeout: 10_000 });
    await customOption.click();

    // ── 2. Details screen in custom mode ─────────────────
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('#details-title')).toContainText(/custom website/i);

    // Business badge should NOT be visible in custom mode
    // Fill description
    await page.locator('#details-textarea').fill(
      'A personal portfolio site showcasing my photography and design work.',
    );
    await page.locator('#build-btn').click();

    // ── 3. Sign-in with phone ────────────────────────────
    await expect(page.locator('#screen-signin')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /phone/i }).click();
    await page.locator('#phone-input').fill('+12125559876');
    await page.locator('#phone-send-btn').click();
    await expect(page.locator('#otp-input')).toBeVisible({ timeout: 10_000 });
    await page.locator('#otp-input').fill('123456');
    await page.locator('#otp-verify-btn').click();

    // ── 4. Auto-submit → Waiting ─────────────────────────
    await expect(page.locator('#screen-waiting')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/building your website/i)).toBeVisible();
  });
});

// ─── FULL FLOW: Pre-Authenticated User ───────────────────────

test.describe('Full Flow: Pre-Authenticated User', () => {
  test('Auth callback → Details → Build directly (no sign-in) → Waiting', async ({ page }) => {
    // User arrives with a token in the URL (e.g., from a previous magic link)
    await page.goto('/?token=e2e-preauth-token&email=user@example.com&auth_callback=email');
    await stubRedirects(page);

    // Should land on details screen (auth callback navigates there)
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });

    // No business selected yet, so we need to search first
    // Actually, handleAuthCallback navigates to 'details' directly.
    // Without a selectedBusiness, details shows custom mode.

    // Fill details
    await page.locator('#details-textarea').fill('Pre-authenticated user building a site.');
    await page.locator('#build-btn').click();

    // Should go DIRECTLY to waiting (already authenticated, no sign-in needed)
    await expect(page.locator('#screen-waiting')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/building your website/i)).toBeVisible();
  });

  test('Existing published site redirects to live URL', async ({ page }) => {
    // Override lookup to return an existing published site
    await page.route('**/api/sites/lookup*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            exists: true,
            site_id: 'site-existing-1',
            slug: 'existing-biz',
            status: 'published',
            has_build: true,
          },
        }),
      }),
    );

    await page.goto('/');
    const getRedirects = await stubRedirects(page);

    // Search and select a business that already has a published site
    await searchAndSelect(page, 'Existing Biz', 'Existing Biz');

    // Should redirect to the published site
    await page.waitForTimeout(2000);
    const redirects = await getRedirects();
    expect(redirects).toContain('https://existing-biz-sites.megabyte.space');
  });

  test('Queued/building site goes directly to waiting', async ({ page }) => {
    await page.route('**/api/sites/lookup*', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            exists: true,
            site_id: 'site-building-1',
            slug: 'building-biz',
            status: 'building',
            has_build: false,
          },
        }),
      }),
    );

    await page.goto('/');
    await stubRedirects(page);
    await searchAndSelect(page, 'Building Biz', 'Building Biz');

    await expect(page.locator('#screen-waiting')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/building your website/i)).toBeVisible();
  });
});

// ─── FULL FLOW: Validation & Error Handling ──────────────────

test.describe('Full Flow: Validation and Errors', () => {
  test('Phone: empty number, invalid number, wrong OTP - then success', async ({ page }) => {
    await page.goto('/');
    await stubRedirects(page);

    await searchAndSelect(page, 'Error Test', 'Error Test');
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });
    await page.locator('#details-textarea').fill('Testing error handling.');
    await page.locator('#build-btn').click();
    await expect(page.locator('#screen-signin')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /phone/i }).click();

    // ── Empty phone number ───────────────────────────────
    await page.locator('#phone-send-btn').click();
    await expect(page.locator('#phone-send-msg')).toContainText(/phone number/i);

    // ── Invalid short phone number ───────────────────────
    await page.locator('#phone-input').fill('123');
    await page.locator('#phone-send-btn').click();
    await expect(page.locator('#phone-send-msg')).toBeVisible();

    // ── Valid phone → OTP sent ───────────────────────────
    await page.locator('#phone-input').fill('+19735551111');
    await page.locator('#phone-send-btn').click();
    await expect(page.locator('#otp-input')).toBeVisible({ timeout: 10_000 });

    // ── Wrong OTP code ───────────────────────────────────
    await page.locator('#otp-input').fill('000000');
    await page.locator('#otp-verify-btn').click();
    await expect(page.locator('#phone-verify-msg')).toBeVisible({ timeout: 5_000 });

    // ── Correct OTP → success → waiting ──────────────────
    await page.locator('#otp-input').fill('123456');
    await page.locator('#otp-verify-btn').click();
    await expect(page.locator('#screen-waiting')).toBeVisible({ timeout: 15_000 });
  });

  test('Email: empty, invalid format, valid - then check-your-email', async ({ page }) => {
    await page.goto('/');
    await stubRedirects(page);

    await searchAndSelect(page, 'Email Test', 'Email Test');
    await expect(page.locator('#screen-details')).toBeVisible({ timeout: 10_000 });
    await page.locator('#details-textarea').fill('Testing email validation.');
    await page.locator('#build-btn').click();
    await expect(page.locator('#screen-signin')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /email/i }).click();

    // ── Empty email ──────────────────────────────────────
    await page.locator('#email-send-btn').click();
    await expect(page.locator('#email-send-msg')).toContainText(/valid email/i);

    // ── Invalid email ────────────────────────────────────
    await page.locator('#email-input').fill('not-an-email');
    await page.locator('#email-send-btn').click();
    await expect(page.locator('#email-send-msg')).toContainText(/valid email/i);

    // ── Valid email → success ────────────────────────────
    await page.locator('#email-input').fill('valid@test.com');
    await page.locator('#email-send-btn').click();
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 10_000 });
  });
});

// ─── MARKETING & UI FEATURES ─────────────────────────────────

test.describe('Homepage: Marketing Sections & Interactive Features', () => {
  test('All marketing sections render correctly with interactive elements', async ({ page }) => {
    await page.goto('/');

    // ── Hero ─────────────────────────────────────────────
    await expect(page.locator('.logo').getByText('Project')).toBeVisible();
    await expect(page.getByPlaceholder(/Enter your business name/)).toBeVisible();
    await expect(page.locator('.hero-brand').getByText(/handled/i)).toBeVisible();

    // ── Proof Section ────────────────────────────────────
    const proof = page.locator('#proof');
    await expect(proof).toBeVisible();
    await expect(proof.getByText(/sites we've built/i)).toBeVisible();
    await expect(proof.locator('.site-thumb')).toHaveCount(6);
    await expect(proof.locator('.testimonial-card')).toHaveCount(3);

    // ── How It Works ─────────────────────────────────────
    const howItWorks = page.locator('#how-it-works');
    await expect(howItWorks).toBeVisible();
    await expect(howItWorks.locator('.step-card')).toHaveCount(3);
    await expect(howItWorks.getByText(/search for your business/i)).toBeVisible();
    await expect(howItWorks.getByText(/review your ai-built site/i)).toBeVisible();
    await expect(howItWorks.getByText(/go live/i)).toBeVisible();

    // ── What's Handled ───────────────────────────────────
    const handled = page.locator('#handled');
    await expect(handled).toBeVisible();
    await expect(handled.locator('.handled-card')).toHaveCount(3);
    await expect(handled.getByText(/unlimited change requests/i)).toBeVisible();

    // ── Done-for-you vs DIY ──────────────────────────────
    const dvd = page.locator('#dvd');
    await expect(dvd).toBeVisible();
    await expect(dvd.getByText(/done-for-you vs/i)).toBeVisible();
    await expect(dvd.locator('.dvd-highlight')).toBeVisible();
    await expect(dvd.locator('.dvd-other')).toBeVisible();

    // ── FAQ Accordion ────────────────────────────────────
    const faq = page.locator('#faq');
    await expect(faq).toBeVisible();
    const faqItems = faq.locator('.faq-item');
    const faqCount = await faqItems.count();
    expect(faqCount).toBeGreaterThanOrEqual(6);

    // Click first FAQ → opens
    await faqItems.first().locator('.faq-question').click();
    await expect(faqItems.first()).toHaveClass(/open/);

    // Click second FAQ → first closes, second opens
    await faqItems.nth(1).locator('.faq-question').click();
    await expect(faqItems.first()).not.toHaveClass(/open/);
    await expect(faqItems.nth(1)).toHaveClass(/open/);

    // Click same FAQ again → closes (accordion collapse)
    await faqItems.nth(1).locator('.faq-question').click();
    await expect(faqItems.nth(1)).not.toHaveClass(/open/);

    // ── Pricing ──────────────────────────────────────────
    const pricing = page.locator('#pricing');
    await expect(pricing).toBeVisible();

    // Free preview card
    await expect(pricing.locator('.pricing-card-free')).toBeVisible();
    await expect(pricing.getByText(/free preview/i).first()).toBeVisible();

    // Paid plan with $50/mo
    await expect(pricing.locator('#pricing-amount')).toContainText('$50');
    await expect(pricing.locator('#pricing-amount')).toContainText('/mo');

    // Toggle to annual pricing
    await pricing.locator('#toggle-switch').click();
    await expect(pricing.locator('#pricing-amount')).toContainText('$480');
    await expect(pricing.locator('#pricing-amount')).toContainText('/yr');
    await expect(pricing.locator('#toggle-annual')).toHaveClass(/active/);

    // Toggle back to monthly
    await pricing.locator('#toggle-switch').click();
    await expect(pricing.locator('#pricing-amount')).toContainText('$50');
    await expect(pricing.locator('#pricing-amount')).toContainText('/mo');
    await expect(pricing.locator('#toggle-monthly')).toHaveClass(/active/);

    // 14-day guarantee text
    await expect(pricing.getByText(/14-day money-back/i)).toBeVisible();

    // ── Footer ───────────────────────────────────────────
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    await expect(footer.getByText(/© 2025 Megabyte LLC/)).toBeVisible();

    // Legal links
    await expect(footer.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/legal/privacy');
    await expect(footer.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/legal/terms');
    await expect(footer.getByRole('link', { name: /content policy/i })).toHaveAttribute('href', '/legal/content-policy');

    // Social links
    await expect(footer.locator('a[href*="github.com/HeyMegabyte"]')).toBeVisible();
    await expect(footer.locator('a[href*="x.com/HeyMegabyte"]')).toBeVisible();
  });
});

// ─── SEARCH FEATURES ─────────────────────────────────────────

test.describe('Search Features', () => {
  test('Search dropdown, API errors, and custom option all work', async ({ page }) => {
    await page.goto('/');
    const input = page.getByPlaceholder(/Enter your business name/);

    // ── Search shows results from E2E server ─────────────
    await input.click();
    await input.pressSequentially('Test', { delay: 50 });

    // E2E server returns "{query} Pizza" and "{query} Plumbing"
    await expect(page.locator('.search-result-name', { hasText: 'Test Pizza' })).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.search-result-name', { hasText: 'Test Plumbing' })).toBeVisible();
    await expect(page.locator('.search-result-address', { hasText: '123 Main St' })).toBeVisible();

    // Custom Website option always present
    await expect(page.locator('.search-result-custom')).toBeVisible();
    await expect(page.locator('.search-result-custom .search-result-name')).toContainText('Custom Website');

    // ── Close and clear ──────────────────────────────────
    await input.fill('');
    await page.waitForTimeout(500);

    // ── Search handles API errors gracefully ─────────────
    await page.route('**/api/search/businesses*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"fail"}' }),
    );
    await input.fill('');
    await input.pressSequentially('error test', { delay: 30 });

    // Page should not crash, input still works
    await page.waitForTimeout(1000);
    await expect(input).toBeVisible();
  });
});

// ─── API INTEGRATION ─────────────────────────────────────────

test.describe('API Integration', () => {
  test('Health, search, auth gates, and security headers all work', async ({ request }) => {
    // ── Health endpoint ──────────────────────────────────
    const healthRes = await request.get('/health');
    expect(healthRes.status()).toBe(200);
    const health = await healthRes.json();
    expect(health).toHaveProperty('status');
    expect(health).toHaveProperty('version');
    expect(health).toHaveProperty('timestamp');
    expect(new Date(health.timestamp).toISOString()).toBe(health.timestamp);

    // ── Security headers ─────────────────────────────────
    expect(healthRes.headers()['strict-transport-security']).toContain('max-age=');
    expect(healthRes.headers()['x-content-type-options']).toBe('nosniff');
    expect(healthRes.headers()['x-frame-options']).toBe('DENY');
    expect(healthRes.headers()['x-request-id']).toBeTruthy();

    // ── Request ID propagation ───────────────────────────
    const testId = `e2e-${Date.now()}`;
    const idRes = await request.get('/health', { headers: { 'x-request-id': testId } });
    expect(idRes.headers()['x-request-id']).toBe(testId);

    // ── Search API ───────────────────────────────────────
    const searchRes = await request.get('/api/search/businesses?q=pizza');
    expect(searchRes.headers()['content-type']).toContain('application/json');
    const searchJson = await searchRes.json();
    expect(searchJson.data).toBeInstanceOf(Array);
    expect(searchJson.data.length).toBeGreaterThan(0);

    // ── Search requires query ────────────────────────────
    const noQuery = await request.get('/api/search/businesses');
    expect(noQuery.status()).toBe(400);

    // ── Lookup API ───────────────────────────────────────
    const lookupRes = await request.get('/api/sites/lookup?place_id=nonexistent');
    expect(lookupRes.headers()['content-type']).toContain('application/json');

    // ── Auth-gated routes return 401 ─────────────────────
    for (const route of ['/api/sites', '/api/billing/subscription', '/api/hostnames', '/api/audit-logs']) {
      const res = await request.get(route);
      expect([401, 403]).toContain(res.status());
    }

    // ── Create-from-search requires auth ─────────────────
    const unauthed = await request.post('/api/sites/create-from-search', {
      data: { business_name: 'Test' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(unauthed.status()).toBe(401);

    // ── Create-from-search works with auth ───────────────
    const authed = await request.post('/api/sites/create-from-search', {
      data: { mode: 'business', business: { name: 'API Test Biz', address: '123 Main St' } },
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    });
    expect(authed.status()).toBe(201);
    const createJson = await authed.json();
    expect(createJson.data).toHaveProperty('site_id');
    expect(createJson.data).toHaveProperty('slug');
    expect(createJson.data).toHaveProperty('workflow_instance_id');

    // ── Phone OTP API ────────────────────────────────────
    const otpRes = await request.post('/api/auth/phone/otp', {
      data: { phone: '+19735551234' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(otpRes.status()).toBe(200);

    // Invalid phone returns 400
    const badPhone = await request.post('/api/auth/phone/otp', {
      data: { phone: '123' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(badPhone.status()).toBe(400);

    // Phone verify with correct OTP
    const verifyRes = await request.post('/api/auth/phone/verify', {
      data: { phone: '+19735551234', otp: '123456' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(verifyRes.status()).toBe(200);
    const verifyJson = await verifyRes.json();
    expect(verifyJson.data).toHaveProperty('token');

    // Phone verify with wrong OTP
    const wrongOtp = await request.post('/api/auth/phone/verify', {
      data: { phone: '+19735551234', otp: '000000' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(wrongOtp.status()).toBe(400);

    // ── Magic link API ───────────────────────────────────
    const mlRes = await request.post('/api/auth/magic-link', {
      data: { email: 'test@example.com' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(mlRes.status()).toBe(200);

    // Invalid email
    const badEmail = await request.post('/api/auth/magic-link', {
      data: { email: 'not-an-email' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(badEmail.status()).toBe(400);

    // ── Stripe webhook requires signature ────────────────
    const stripeRes = await request.post('/webhooks/stripe', {
      data: '{}',
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 401]).toContain(stripeRes.status());

    // ── 413 for oversized payloads ───────────────────────
    const largeBody = 'x'.repeat(300_000);
    const largeRes = await request.post('/api/auth/magic-link', {
      data: largeBody,
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(largeBody.length) },
    });
    expect([413, 400]).toContain(largeRes.status());
  });
});
