import { test as base, Page } from '@playwright/test';

/**
 * Custom fixture that provides an authenticated page.
 * Sets up localStorage with a mock session so the Angular app
 * thinks the user is logged in.
 */
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    // Navigate first to set the origin for localStorage
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Set session in localStorage + dismiss onboarding overlay
    await page.evaluate(() => {
      localStorage.setItem('ps_session', JSON.stringify({
        token: 'mock-token-123',
        identifier: 'test@example.com',
      }));
      localStorage.setItem('ps_onboarding', 'dismissed');
      localStorage.setItem('ps_feedback_dismissed', 'true');
    });

    // Reload so the app picks up the session
    await page.reload();
    await page.waitForLoadState('networkidle');

    await use(page);
  },
});

export { expect } from '@playwright/test';
