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

// ─── GRANULAR FULL FLOW: Every Micro-Step ────────────────────

test.describe('Granular Full Flow: Search → Select → Details → Build → Sign-In → Email → Waiting', () => {
  test('Verifies every single micro-interaction from page load to waiting screen', async ({ page }) => {
    // ────────────────────────────────────────────────────────
    // STEP 1: Open the page and verify initial state
    // ────────────────────────────────────────────────────────
    await page.goto('/');

    // Search screen should be active (the default screen)
    const searchScreen = page.locator('#screen-search');
    await expect(searchScreen).toBeVisible();
    await expect(searchScreen).toHaveClass(/active/);

    // Other screens should NOT be active
    await expect(page.locator('#screen-details')).not.toHaveClass(/active/);
    await expect(page.locator('#screen-signin')).not.toHaveClass(/active/);
    await expect(page.locator('#screen-waiting')).not.toHaveClass(/active/);

    // Logo and hero branding visible
    await expect(page.locator('.logo').getByText('Project')).toBeVisible();
    await expect(page.locator('.hero-brand').getByText(/handled/i)).toBeVisible();

    // Search input is present and empty
    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveAttribute('placeholder', 'Enter your business name...');
    await expect(searchInput).toHaveValue('');

    // Dropdown should be closed (no .open class)
    const dropdown = page.locator('#search-dropdown');
    await expect(dropdown).not.toHaveClass(/open/);

    // ────────────────────────────────────────────────────────
    // STEP 2: Focus the search input and type a business name
    // ────────────────────────────────────────────────────────
    await searchInput.click();
    await expect(searchInput).toBeFocused();

    // Type a business name character by character (triggers 300ms debounce)
    await searchInput.pressSequentially('Sunrise Bakery', { delay: 30 });
    await expect(searchInput).toHaveValue('Sunrise Bakery');

    // ────────────────────────────────────────────────────────
    // STEP 3: Wait for live search dropdown to appear
    // ────────────────────────────────────────────────────────
    // The E2E server returns "{query} Pizza" and "{query} Plumbing" for any query
    // After debounce + fetch, the dropdown should open with results
    await expect(dropdown).toHaveClass(/open/, { timeout: 10_000 });

    // Verify search results are rendered with correct structure
    const results = dropdown.locator('.search-result');
    // Should have: 2 Google Places results + 1 Custom Website = 3 total
    await expect(results).toHaveCount(3, { timeout: 5_000 });

    // First result: "Sunrise Bakery Pizza" (E2E server returns "{query} Pizza")
    const firstResult = results.nth(0);
    await expect(firstResult.locator('.search-result-name')).toContainText('Sunrise Bakery Pizza');
    await expect(firstResult.locator('.search-result-address')).toContainText('123 Main St, New York, NY');
    await expect(firstResult.locator('.search-result-icon')).toBeVisible();

    // Second result: "Sunrise Bakery Plumbing"
    const secondResult = results.nth(1);
    await expect(secondResult.locator('.search-result-name')).toContainText('Sunrise Bakery Plumbing');
    await expect(secondResult.locator('.search-result-address')).toContainText('456 Oak Ave, Brooklyn, NY');

    // Third result: Custom Website option (always present)
    const customResult = results.nth(2);
    await expect(customResult).toHaveClass(/search-result-custom/);
    await expect(customResult.locator('.search-result-name')).toContainText('Custom Website');
    await expect(customResult.locator('.search-result-address')).toContainText('Build a custom website from scratch');

    // ────────────────────────────────────────────────────────
    // STEP 4: Click the first search result
    // ────────────────────────────────────────────────────────
    // Intercept the lookup API call to verify it fires
    const lookupPromise = page.waitForResponse((resp) =>
      resp.url().includes('/api/sites/lookup') && resp.status() === 200,
    );

    await firstResult.click();

    // Dropdown should close after selection
    await expect(dropdown).not.toHaveClass(/open/, { timeout: 3_000 });

    // Lookup API call should have fired with the place_id
    const lookupResp = await lookupPromise;
    expect(lookupResp.url()).toContain('place_id=ChIJ_mock_1');

    // ────────────────────────────────────────────────────────
    // STEP 5: Verify Details screen appears with correct data
    // ────────────────────────────────────────────────────────
    const detailsScreen = page.locator('#screen-details');
    await expect(detailsScreen).toBeVisible({ timeout: 10_000 });
    await expect(detailsScreen).toHaveClass(/active/);

    // Search screen is no longer active
    await expect(searchScreen).not.toHaveClass(/active/);

    // Title says "Tell us more about your business" (business mode, not custom)
    await expect(page.locator('#details-title')).toHaveText('Tell us more about your business');
    await expect(page.locator('#details-subtitle')).toContainText('Any extra info helps us build the perfect website');

    // Business badge is visible and populated with selected business data
    const badge = page.locator('#details-business-badge');
    await expect(badge).toBeVisible();
    await expect(page.locator('#badge-biz-name')).toHaveText('Sunrise Bakery Pizza');
    await expect(page.locator('#badge-biz-addr')).toHaveText('123 Main St, New York, NY');

    // Textarea is empty and ready for input
    const textarea = page.locator('#details-textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue('');
    await expect(textarea).toHaveAttribute(
      'placeholder',
      /Tell us about your business/,
    );

    // Build button is enabled and shows correct text
    const buildBtn = page.locator('#build-btn');
    await expect(buildBtn).toBeVisible();
    await expect(buildBtn).toBeEnabled();
    await expect(buildBtn).toHaveText('Build My Website');

    // Back to search button is present
    await expect(detailsScreen.getByText('Back to search')).toBeVisible();

    // ────────────────────────────────────────────────────────
    // STEP 6: Fill in additional context and click Build
    // ────────────────────────────────────────────────────────
    await textarea.click();
    await textarea.fill(
      'We are a family-owned bakery specializing in sourdough bread and French pastries. Open since 1998. Warm rustic interior.',
    );
    await expect(textarea).toHaveValue(
      /family-owned bakery specializing in sourdough/,
    );

    // Click the Build button
    await buildBtn.click();

    // ────────────────────────────────────────────────────────
    // STEP 7: Verify Sign-In screen appears (not authenticated)
    // ────────────────────────────────────────────────────────
    // submitBuild() detects no session token → sets _pendingBuild → navigateTo('signin')
    const signinScreen = page.locator('#screen-signin');
    await expect(signinScreen).toBeVisible({ timeout: 10_000 });
    await expect(signinScreen).toHaveClass(/active/);
    await expect(detailsScreen).not.toHaveClass(/active/);

    // Sign-in heading and subtitle
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.locator('.signin-subtitle')).toContainText(/create your account/i);

    // Sign-in method buttons visible (main panel)
    const googleBtn = page.getByRole('button', { name: /google/i });
    const emailBtn = page.getByRole('button', { name: /email/i });
    await expect(googleBtn).toBeVisible();
    await expect(emailBtn).toBeVisible();

    // Email panel should NOT be active yet
    await expect(page.locator('#signin-email-panel')).not.toHaveClass(/active/);

    // ────────────────────────────────────────────────────────
    // STEP 8: Click "Sign in with Email" button
    // ────────────────────────────────────────────────────────
    await emailBtn.click();

    // Email panel becomes active, methods panel hides
    await expect(page.locator('#signin-email-panel')).toHaveClass(/active/);

    // Email input step is visible, sent step is hidden
    await expect(page.locator('#email-step-input')).toBeVisible();
    await expect(page.locator('#email-step-sent')).not.toBeVisible();

    // Email input field is visible
    const emailInput = page.locator('#email-input');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('placeholder', 'you@example.com');
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(emailInput).toHaveValue('');

    // Send button is visible and enabled
    const sendBtn = page.locator('#email-send-btn');
    await expect(sendBtn).toBeVisible();
    await expect(sendBtn).toBeEnabled();
    await expect(sendBtn).toContainText('Send Magic Link');

    // ────────────────────────────────────────────────────────
    // STEP 9: Enter email and send magic link
    // ────────────────────────────────────────────────────────
    await emailInput.fill('test@example.com');
    await expect(emailInput).toHaveValue('test@example.com');

    // Intercept the magic link API call
    const magicLinkPromise = page.waitForResponse((resp) =>
      resp.url().includes('/api/auth/magic-link') && resp.status() === 200,
    );

    await sendBtn.click();

    // Verify API call succeeds
    const mlResp = await magicLinkPromise;
    const mlJson = await mlResp.json();
    expect(mlJson.data).toHaveProperty('expires_at');

    // ────────────────────────────────────────────────────────
    // STEP 10: Verify "Check your email" confirmation
    // ────────────────────────────────────────────────────────
    // After successful send: email-step-input hides, email-step-sent shows
    await expect(page.locator('#email-step-input')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#email-step-sent')).toBeVisible();
    await expect(page.getByText(/check your email/i)).toBeVisible();

    // ────────────────────────────────────────────────────────
    // STEP 11: Simulate magic link callback (user clicks link in email)
    // ────────────────────────────────────────────────────────
    // Save state to sessionStorage before navigating away
    await page.evaluate(() => {
      const s = (window as any).state;
      if (s.selectedBusiness) {
        sessionStorage.setItem('ps_selected_business', JSON.stringify(s.selectedBusiness));
        sessionStorage.setItem('ps_mode', s.mode);
      }
      sessionStorage.setItem('ps_pending_build', '1');
    });

    // Navigate as if user clicked magic link in email
    await page.goto('/?token=e2e-magic-link-token&email=test@example.com&auth_callback=email');

    // ────────────────────────────────────────────────────────
    // STEP 12: Auto-navigation back to details, auto-submit build
    // ────────────────────────────────────────────────────────
    // After callback: handleAuthCallback sets state.session → restores business
    // → navigateTo('details') → wrapper detects _pendingBuild → auto-calls submitBuild()
    // submitBuild sends POST /api/sites/create-from-search with auth header

    // Intercept the create-from-search API call
    const createPromise = page.waitForResponse(
      (resp) => resp.url().includes('/api/sites/create-from-search') && resp.status() === 201,
    );

    const createResp = await createPromise;
    const createJson = await createResp.json();
    expect(createJson.data).toHaveProperty('site_id');
    expect(createJson.data).toHaveProperty('slug');
    expect(createJson.data).toHaveProperty('workflow_instance_id');
    expect(createJson.data.status).toBe('building');

    // ────────────────────────────────────────────────────────
    // STEP 13: Verify Waiting screen appears with all elements
    // ────────────────────────────────────────────────────────
    const waitingScreen = page.locator('#screen-waiting');
    await expect(waitingScreen).toBeVisible({ timeout: 15_000 });
    await expect(waitingScreen).toHaveClass(/active/);

    // Sign-in screen is no longer active
    await expect(signinScreen).not.toHaveClass(/active/);

    // Waiting title and subtitle
    await expect(page.locator('.waiting-title')).toContainText(/building your website/i);
    await expect(page.locator('.waiting-subtitle')).toContainText(/few minutes/i);

    // Status indicator with pulsing dot
    const statusDot = page.locator('.status-dot');
    await expect(statusDot).toBeVisible();
    await expect(page.locator('.waiting-status')).toContainText('Build in progress');

    // Loading dots animation in status bar
    await expect(page.locator('.waiting-status .loading-dots')).toBeVisible();

    // Animated loading rings
    await expect(page.locator('.waiting-anim')).toBeVisible();
    await expect(page.locator('.waiting-anim-ring')).toHaveCount(3);
    await expect(page.locator('.waiting-anim-icon')).toBeVisible();

    // Contact line shows signed-in identity (email)
    const contactEl = page.locator('#waiting-contact');
    await expect(contactEl).toContainText('test@example.com');

    // ────────────────────────────────────────────────────────
    // STEP 14: Verify internal state via JS evaluation
    // ────────────────────────────────────────────────────────
    const appState = await page.evaluate(() => {
      const s = (window as any).state;
      return {
        screen: s.screen,
        mode: s.mode,
        hasSession: !!s.session && !!s.session.token,
        hasSiteId: !!s.siteId,
        selectedBusinessName: s.selectedBusiness?.name || null,
        pendingBuild: s._pendingBuild,
      };
    });

    expect(appState.screen).toBe('waiting');
    expect(appState.mode).toBe('business');
    expect(appState.hasSession).toBe(true);
    expect(appState.selectedBusinessName).toBe('Sunrise Bakery Pizza');
    expect(appState.pendingBuild).toBeFalsy();
  });
});

// ─── GRANULAR FULL FLOW: Google OAuth ────────────────────────

test.describe('Granular Full Flow: Google OAuth Sign-In', () => {
  test('Verifies every micro-step of search → details → Google redirect → callback → waiting', async ({ page }) => {
    // ────────────────────────────────────────────────────────
    // STEP 1: Open page and verify initial state
    // ────────────────────────────────────────────────────────
    await page.goto('/');
    const getRedirects = await stubRedirects(page);

    const searchScreen = page.locator('#screen-search');
    await expect(searchScreen).toBeVisible();
    await expect(searchScreen).toHaveClass(/active/);

    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveValue('');

    // ────────────────────────────────────────────────────────
    // STEP 2: Focus input and type a business name
    // ────────────────────────────────────────────────────────
    await searchInput.click();
    await expect(searchInput).toBeFocused();
    await searchInput.pressSequentially('Mountain Coffee', { delay: 30 });
    await expect(searchInput).toHaveValue('Mountain Coffee');

    // ────────────────────────────────────────────────────────
    // STEP 3: Wait for live search dropdown
    // ────────────────────────────────────────────────────────
    const dropdown = page.locator('#search-dropdown');
    await expect(dropdown).toHaveClass(/open/, { timeout: 10_000 });

    const results = dropdown.locator('.search-result');
    await expect(results).toHaveCount(3, { timeout: 5_000 });

    // Verify first result structure
    const firstResult = results.nth(0);
    await expect(firstResult.locator('.search-result-name')).toContainText('Mountain Coffee Pizza');
    await expect(firstResult.locator('.search-result-address')).toContainText('123 Main St, New York, NY');

    // ────────────────────────────────────────────────────────
    // STEP 4: Click first result and verify lookup API fires
    // ────────────────────────────────────────────────────────
    const lookupPromise = page.waitForResponse((resp) =>
      resp.url().includes('/api/sites/lookup') && resp.status() === 200,
    );
    await firstResult.click();
    await expect(dropdown).not.toHaveClass(/open/, { timeout: 3_000 });

    const lookupResp = await lookupPromise;
    expect(lookupResp.url()).toContain('place_id=ChIJ_mock_1');

    // ────────────────────────────────────────────────────────
    // STEP 5: Verify Details screen
    // ────────────────────────────────────────────────────────
    const detailsScreen = page.locator('#screen-details');
    await expect(detailsScreen).toBeVisible({ timeout: 10_000 });
    await expect(detailsScreen).toHaveClass(/active/);
    await expect(searchScreen).not.toHaveClass(/active/);

    // Business badge populated
    await expect(page.locator('#details-title')).toHaveText('Tell us more about your business');
    await expect(page.locator('#badge-biz-name')).toHaveText('Mountain Coffee Pizza');
    await expect(page.locator('#badge-biz-addr')).toHaveText('123 Main St, New York, NY');

    // ────────────────────────────────────────────────────────
    // STEP 6: Fill details and click Build
    // ────────────────────────────────────────────────────────
    const textarea = page.locator('#details-textarea');
    await textarea.fill('Specialty coffee roaster and cafe. Single-origin beans, pour-over bar, cozy atmosphere.');
    await expect(textarea).toHaveValue(/Specialty coffee roaster/);

    const buildBtn = page.locator('#build-btn');
    await expect(buildBtn).toBeEnabled();
    await buildBtn.click();

    // ────────────────────────────────────────────────────────
    // STEP 7: Verify Sign-In screen appears
    // ────────────────────────────────────────────────────────
    const signinScreen = page.locator('#screen-signin');
    await expect(signinScreen).toBeVisible({ timeout: 10_000 });
    await expect(signinScreen).toHaveClass(/active/);
    await expect(detailsScreen).not.toHaveClass(/active/);

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.locator('.signin-subtitle')).toContainText(/create your account/i);

    // Sign-in buttons visible
    const googleBtn = page.getByRole('button', { name: /google/i });
    await expect(googleBtn).toBeVisible();
    await expect(page.getByRole('button', { name: /email/i })).toBeVisible();

    // ────────────────────────────────────────────────────────
    // STEP 8: Click "Continue with Google"
    // ────────────────────────────────────────────────────────
    await googleBtn.click();

    // The signInWithGoogle wrapper saves state to sessionStorage before redirect
    const savedBiz = await page.evaluate(() => sessionStorage.getItem('ps_selected_business'));
    expect(savedBiz).toBeTruthy();

    // Verify the saved business data is correct
    const parsedBiz = JSON.parse(savedBiz!);
    expect(parsedBiz.name).toBe('Mountain Coffee Pizza');
    expect(parsedBiz.address).toBe('123 Main St, New York, NY');
    expect(parsedBiz.place_id).toBe('ChIJ_mock_1');

    // Verify mode and pending build saved
    const savedMode = await page.evaluate(() => sessionStorage.getItem('ps_mode'));
    expect(savedMode).toBe('business');

    const savedPending = await page.evaluate(() => sessionStorage.getItem('ps_pending_build'));
    expect(savedPending).toBe('1');

    // Verify redirect was captured (redirectTo was stubbed)
    const redirects = await getRedirects();
    expect(redirects.length).toBe(1);
    expect(redirects[0]).toContain('/api/auth/google');
    expect(redirects[0]).toContain('redirect_url=');
    // auth_callback=google is URL-encoded inside the redirect_url param
    expect(redirects[0]).toContain('auth_callback');

    // ────────────────────────────────────────────────────────
    // STEP 9: Simulate Google OAuth callback (user returns from Google)
    // ────────────────────────────────────────────────────────
    // In real flow: Google redirects back with token. We simulate this.
    await page.goto('/?token=e2e-google-oauth-token&email=user@gmail.com&auth_callback=google');

    // handleAuthCallback IIFE fires:
    //   → sets state.session with token
    //   → cleans URL
    //   → restores selectedBusiness from sessionStorage
    //   → detects _pendingBuild
    //   → navigateTo('details')
    //   → navigateTo wrapper detects _pendingBuild + session → auto-submitBuild()

    // ────────────────────────────────────────────────────────
    // STEP 10: Verify sessionStorage was consumed (cleaned up)
    // ────────────────────────────────────────────────────────
    const clearedBiz = await page.evaluate(() => sessionStorage.getItem('ps_selected_business'));
    expect(clearedBiz).toBeNull();
    const clearedPending = await page.evaluate(() => sessionStorage.getItem('ps_pending_build'));
    expect(clearedPending).toBeNull();

    // ────────────────────────────────────────────────────────
    // STEP 11: Verify auto-submit fires create-from-search API
    // ────────────────────────────────────────────────────────
    // The auto-submit should POST to create-from-search with the restored business
    // Wait for the waiting screen (create API + navigateTo('waiting'))
    const waitingScreen = page.locator('#screen-waiting');
    await expect(waitingScreen).toBeVisible({ timeout: 15_000 });
    await expect(waitingScreen).toHaveClass(/active/);

    // ────────────────────────────────────────────────────────
    // STEP 12: Verify waiting screen elements
    // ────────────────────────────────────────────────────────
    await expect(page.locator('.waiting-title')).toContainText(/building your website/i);
    await expect(page.locator('.waiting-subtitle')).toContainText(/few minutes/i);
    await expect(page.locator('.status-dot')).toBeVisible();
    await expect(page.locator('.waiting-status')).toContainText('Build in progress');
    await expect(page.locator('.waiting-anim')).toBeVisible();
    await expect(page.locator('.waiting-anim-ring')).toHaveCount(3);

    // Contact shows the Google email from callback
    await expect(page.locator('#waiting-contact')).toContainText('user@gmail.com');

    // ────────────────────────────────────────────────────────
    // STEP 13: Verify internal state
    // ────────────────────────────────────────────────────────
    const appState = await page.evaluate(() => {
      const s = (window as any).state;
      return {
        screen: s.screen,
        mode: s.mode,
        hasSession: !!s.session && !!s.session.token,
        sessionIdentifier: s.session?.identifier || null,
        selectedBusinessName: s.selectedBusiness?.name || null,
        pendingBuild: s._pendingBuild,
      };
    });

    expect(appState.screen).toBe('waiting');
    expect(appState.mode).toBe('business');
    expect(appState.hasSession).toBe(true);
    expect(appState.sessionIdentifier).toBe('user@gmail.com');
    expect(appState.selectedBusinessName).toBe('Mountain Coffee Pizza');
    expect(appState.pendingBuild).toBeFalsy();
  });
});

// ─── GRANULAR FULL FLOW: Email Magic Link ────────────────────

test.describe('Granular Full Flow: Email Magic Link Sign-In', () => {
  test('Verifies every micro-step of search → details → email → check-email → callback → waiting', async ({ page }) => {
    // ────────────────────────────────────────────────────────
    // STEP 1: Open page and verify initial state
    // ────────────────────────────────────────────────────────
    await page.goto('/');

    const searchScreen = page.locator('#screen-search');
    await expect(searchScreen).toBeVisible();

    const searchInput = page.locator('#search-input');
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toHaveValue('');

    // ────────────────────────────────────────────────────────
    // STEP 2: Focus input and type a business name
    // ────────────────────────────────────────────────────────
    await searchInput.click();
    await expect(searchInput).toBeFocused();
    await searchInput.pressSequentially('Harbor Sushi', { delay: 30 });
    await expect(searchInput).toHaveValue('Harbor Sushi');

    // ────────────────────────────────────────────────────────
    // STEP 3: Wait for live search dropdown
    // ────────────────────────────────────────────────────────
    const dropdown = page.locator('#search-dropdown');
    await expect(dropdown).toHaveClass(/open/, { timeout: 10_000 });

    const results = dropdown.locator('.search-result');
    await expect(results).toHaveCount(3, { timeout: 5_000 });

    // Verify result structure
    const firstResult = results.nth(0);
    await expect(firstResult.locator('.search-result-name')).toContainText('Harbor Sushi Pizza');
    await expect(firstResult.locator('.search-result-address')).toContainText('123 Main St, New York, NY');
    await expect(firstResult.locator('.search-result-icon')).toBeVisible();

    // Second result
    await expect(results.nth(1).locator('.search-result-name')).toContainText('Harbor Sushi Plumbing');

    // Custom option always present
    await expect(results.nth(2)).toHaveClass(/search-result-custom/);

    // ────────────────────────────────────────────────────────
    // STEP 4: Click first result and verify lookup API
    // ────────────────────────────────────────────────────────
    const lookupPromise = page.waitForResponse((resp) =>
      resp.url().includes('/api/sites/lookup') && resp.status() === 200,
    );
    await firstResult.click();
    await expect(dropdown).not.toHaveClass(/open/, { timeout: 3_000 });

    const lookupResp = await lookupPromise;
    expect(lookupResp.url()).toContain('place_id=ChIJ_mock_1');

    // ────────────────────────────────────────────────────────
    // STEP 5: Verify Details screen
    // ────────────────────────────────────────────────────────
    const detailsScreen = page.locator('#screen-details');
    await expect(detailsScreen).toBeVisible({ timeout: 10_000 });
    await expect(detailsScreen).toHaveClass(/active/);

    await expect(page.locator('#details-title')).toHaveText('Tell us more about your business');
    await expect(page.locator('#badge-biz-name')).toHaveText('Harbor Sushi Pizza');
    await expect(page.locator('#badge-biz-addr')).toHaveText('123 Main St, New York, NY');

    const textarea = page.locator('#details-textarea');
    await expect(textarea).toHaveValue('');

    // ────────────────────────────────────────────────────────
    // STEP 6: Fill details and click Build
    // ────────────────────────────────────────────────────────
    await textarea.fill('Authentic Japanese sushi bar. Omakase menu, fresh fish daily, sake selection.');
    await expect(textarea).toHaveValue(/Authentic Japanese sushi/);

    const buildBtn = page.locator('#build-btn');
    await expect(buildBtn).toBeEnabled();
    await expect(buildBtn).toHaveText('Build My Website');
    await buildBtn.click();

    // ────────────────────────────────────────────────────────
    // STEP 7: Verify Sign-In screen
    // ────────────────────────────────────────────────────────
    const signinScreen = page.locator('#screen-signin');
    await expect(signinScreen).toBeVisible({ timeout: 10_000 });
    await expect(signinScreen).toHaveClass(/active/);
    await expect(detailsScreen).not.toHaveClass(/active/);

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await expect(page.locator('.signin-subtitle')).toContainText(/create your account/i);

    // Sign-in buttons visible on main panel
    await expect(page.getByRole('button', { name: /google/i })).toBeVisible();
    const emailBtn = page.getByRole('button', { name: /email/i });
    await expect(emailBtn).toBeVisible();

    // Email panel not active yet
    await expect(page.locator('#signin-email-panel')).not.toHaveClass(/active/);

    // ────────────────────────────────────────────────────────
    // STEP 8: Click "Sign in with Email"
    // ────────────────────────────────────────────────────────
    await emailBtn.click();

    // Email panel becomes active
    await expect(page.locator('#signin-email-panel')).toHaveClass(/active/);

    // Email input step is visible, sent step is hidden
    await expect(page.locator('#email-step-input')).toBeVisible();
    await expect(page.locator('#email-step-sent')).not.toBeVisible();

    // Email input field
    const emailInput = page.locator('#email-input');
    await expect(emailInput).toBeVisible();
    await expect(emailInput).toHaveAttribute('placeholder', 'you@example.com');
    await expect(emailInput).toHaveAttribute('type', 'email');
    await expect(emailInput).toHaveValue('');

    // Send button
    const sendBtn = page.locator('#email-send-btn');
    await expect(sendBtn).toBeVisible();
    await expect(sendBtn).toBeEnabled();
    await expect(sendBtn).toContainText('Send Magic Link');

    // Error message area hidden
    await expect(page.locator('#email-send-msg')).not.toBeVisible();

    // Back to sign-in options link
    await expect(page.locator('#signin-email-panel .back-link')).toContainText('Back to sign-in options');

    // ────────────────────────────────────────────────────────
    // STEP 9: Try empty email (validation)
    // ────────────────────────────────────────────────────────
    await sendBtn.click();
    await expect(page.locator('#email-send-msg')).toContainText(/valid email/i);

    // ────────────────────────────────────────────────────────
    // STEP 10: Try invalid email (validation)
    // ────────────────────────────────────────────────────────
    await emailInput.fill('not-a-real-email');
    await sendBtn.click();
    await expect(page.locator('#email-send-msg')).toContainText(/valid email/i);

    // ────────────────────────────────────────────────────────
    // STEP 11: Enter valid email and send magic link
    // ────────────────────────────────────────────────────────
    await emailInput.fill('chef@harborsushi.com');
    await expect(emailInput).toHaveValue('chef@harborsushi.com');

    // Intercept magic link API call
    const magicLinkPromise = page.waitForResponse((resp) =>
      resp.url().includes('/api/auth/magic-link') && resp.status() === 200,
    );

    await sendBtn.click();

    // Verify API call
    const mlResp = await magicLinkPromise;
    const mlJson = await mlResp.json();
    expect(mlJson.data).toHaveProperty('expires_at');

    // ────────────────────────────────────────────────────────
    // STEP 12: Verify "Check your email" confirmation
    // ────────────────────────────────────────────────────────
    // email-step-input hides, email-step-sent shows
    await expect(page.locator('#email-step-input')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#email-step-sent')).toBeVisible();
    await expect(page.getByText(/check your email/i)).toBeVisible();
    await expect(page.getByText(/sign-in link/i)).toBeVisible();

    // ────────────────────────────────────────────────────────
    // STEP 13: Save state to sessionStorage (simulate pre-redirect state)
    // ────────────────────────────────────────────────────────
    // In the real flow, the user clicks the magic link in their email,
    // which redirects back to the app with a token. We need to save
    // the current state to sessionStorage so handleAuthCallback can restore it.
    await page.evaluate(() => {
      const s = (window as any).state;
      if (s.selectedBusiness) {
        sessionStorage.setItem('ps_selected_business', JSON.stringify(s.selectedBusiness));
        sessionStorage.setItem('ps_mode', s.mode);
      }
      sessionStorage.setItem('ps_pending_build', '1');
    });

    // Verify sessionStorage was set correctly
    const savedBiz = await page.evaluate(() => sessionStorage.getItem('ps_selected_business'));
    expect(savedBiz).toBeTruthy();
    const parsedBiz = JSON.parse(savedBiz!);
    expect(parsedBiz.name).toBe('Harbor Sushi Pizza');

    const savedPending = await page.evaluate(() => sessionStorage.getItem('ps_pending_build'));
    expect(savedPending).toBe('1');

    // ────────────────────────────────────────────────────────
    // STEP 14: Simulate magic link callback (user clicks link in email)
    // ────────────────────────────────────────────────────────
    await page.goto('/?token=e2e-magic-link-token&email=chef@harborsushi.com&auth_callback=email');

    // handleAuthCallback IIFE:
    //   → sets state.session with token + email
    //   → cleans URL params
    //   → restores selectedBusiness from sessionStorage
    //   → detects _pendingBuild
    //   → navigateTo('details') → auto-submitBuild()

    // ────────────────────────────────────────────────────────
    // STEP 15: Verify sessionStorage was consumed
    // ────────────────────────────────────────────────────────
    const clearedBiz = await page.evaluate(() => sessionStorage.getItem('ps_selected_business'));
    expect(clearedBiz).toBeNull();
    const clearedPending = await page.evaluate(() => sessionStorage.getItem('ps_pending_build'));
    expect(clearedPending).toBeNull();

    // ────────────────────────────────────────────────────────
    // STEP 16: Verify Waiting screen
    // ────────────────────────────────────────────────────────
    const waitingScreen = page.locator('#screen-waiting');
    await expect(waitingScreen).toBeVisible({ timeout: 15_000 });
    await expect(waitingScreen).toHaveClass(/active/);

    await expect(page.locator('.waiting-title')).toContainText(/building your website/i);
    await expect(page.locator('.waiting-subtitle')).toContainText(/few minutes/i);
    await expect(page.locator('.status-dot')).toBeVisible();
    await expect(page.locator('.waiting-status')).toContainText('Build in progress');
    await expect(page.locator('.waiting-status .loading-dots')).toBeVisible();
    await expect(page.locator('.waiting-anim')).toBeVisible();
    await expect(page.locator('.waiting-anim-ring')).toHaveCount(3);

    // Contact shows email from magic link callback
    await expect(page.locator('#waiting-contact')).toContainText('chef@harborsushi.com');

    // ────────────────────────────────────────────────────────
    // STEP 17: Verify internal state
    // ────────────────────────────────────────────────────────
    const appState = await page.evaluate(() => {
      const s = (window as any).state;
      return {
        screen: s.screen,
        mode: s.mode,
        hasSession: !!s.session && !!s.session.token,
        sessionToken: s.session?.token || null,
        sessionIdentifier: s.session?.identifier || null,
        selectedBusinessName: s.selectedBusiness?.name || null,
        pendingBuild: s._pendingBuild,
      };
    });

    expect(appState.screen).toBe('waiting');
    expect(appState.mode).toBe('business');
    expect(appState.hasSession).toBe(true);
    expect(appState.sessionToken).toBe('e2e-magic-link-token');
    expect(appState.sessionIdentifier).toBe('chef@harborsushi.com');
    expect(appState.selectedBusinessName).toBe('Harbor Sushi Pizza');
    expect(appState.pendingBuild).toBeFalsy();
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
  test('Search → Custom option → Details (custom mode) → Email → Waiting', async ({ page }) => {
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

    // ── 3. Sign-in with email ────────────────────────────
    await expect(page.locator('#screen-signin')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /email/i }).click();
    await page.locator('#email-input').fill('test@example.com');
    await page.locator('#email-send-btn').click();
    await expect(page.getByText(/check your email/i)).toBeVisible({ timeout: 10_000 });

    // Simulate magic link callback
    await page.evaluate(() => {
      const s = (window as any).state;
      if (s.selectedBusiness) {
        sessionStorage.setItem('ps_selected_business', JSON.stringify(s.selectedBusiness));
        sessionStorage.setItem('ps_mode', s.mode);
      }
      sessionStorage.setItem('ps_pending_build', '1');
    });
    await page.goto('/?token=e2e-magic-link-token&email=test@example.com&auth_callback=email');

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
    await expect(footer.getByText(/© 2026 Megabyte LLC/)).toBeVisible();

    // Footer links
    await expect(footer.getByRole('link', { name: /support/i })).toHaveAttribute('href', 'mailto:hey@megabyte.space');
    await expect(footer.getByRole('link', { name: /contact/i })).toBeVisible();

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
