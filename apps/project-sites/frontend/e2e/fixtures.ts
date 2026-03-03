/**
 * Shared Playwright fixtures for Angular frontend E2E tests.
 *
 * Blocks external CDN requests (Google Fonts, Stripe, etc.)
 * so page.goto() doesn't hang waiting for unreachable resources.
 *
 * Provides `authedPage` fixture with a pre-authenticated session.
 */
import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ authedPage: import('@playwright/test').Page }>({
  page: async ({ page }, use) => {
    // Block all requests to external domains
    await page.route(
      (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
      (route) => route.abort(),
    );
    await use(page);
  },

  /** Page with a mock auth session pre-set in localStorage */
  authedPage: async ({ page }, use) => {
    await page.route(
      (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
      (route) => route.abort(),
    );
    // Call the magic-link API to register a token in the mock server
    const resp = await page.request.post('http://localhost:4300/api/auth/magic-link', {
      data: { email: 'test@example.com', redirect_url: 'http://localhost:4300/' },
    });
    const json = await resp.json();
    const token = json.data?.token || 'e2e-fallback-token';

    // Navigate to the app so we can set localStorage on the correct origin
    await page.goto('/');

    // Set session in localStorage matching AuthService's ps_session format
    await page.evaluate((t) => {
      localStorage.setItem('ps_session', JSON.stringify({ token: t, identifier: 'test@example.com' }));
    }, token);

    // Reload so Angular bootstraps with the session in localStorage
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await use(page);
  },
});

export { expect };
