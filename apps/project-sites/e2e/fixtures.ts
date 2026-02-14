/**
 * Shared Playwright fixtures for E2E tests.
 *
 * Blocks external CDN requests (Google Fonts, Uppy, Lottie, etc.)
 * so `page.goto()` doesn't hang waiting for unreachable resources.
 */
import { test as base } from '@playwright/test';

export const test = base.extend({
  page: async ({ page }, use) => {
    // Block all requests to external domains so the page load event fires quickly.
    // The HTML loads resources from CDNs that may be unreachable in CI/sandbox.
    await page.route(
      (url) => url.hostname !== 'localhost' && url.hostname !== '127.0.0.1',
      (route) => route.abort(),
    );
    await use(page);
  },
});

export { expect } from '@playwright/test';
