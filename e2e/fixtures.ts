/**
 * Shared Playwright fixtures for bolt.diy main app E2E tests.
 *
 * Every test uses these fixtures to ensure:
 * - Deterministic behavior (no external CDN dependencies)
 * - Isolated browser context per test (parallel-safe)
 * - Consistent selectors and helpers
 */
import { test as base, expect } from '@playwright/test';

/**
 * Extended test fixture that blocks external CDN requests
 * so tests don't hang on unreachable resources in CI.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    // Block external CDN requests that may be unreachable in CI/sandbox
    const blockedDomains = [
      'fonts.googleapis.com',
      'fonts.gstatic.com',
      'cdn.jsdelivr.net',
      'unpkg.com',
      'cdnjs.cloudflare.com',
      'analytics.google.com',
      'www.googletagmanager.com',
    ];

    await page.route(
      (url) => blockedDomains.some((d) => url.hostname.includes(d)),
      (route) => route.abort(),
    );

    await use(page);
  },
});

export { expect };

/**
 * Wait for the app shell to be ready (header and main content visible).
 * Every E2E test should call this after `page.goto('/')`.
 */
export async function waitForAppReady(page: import('@playwright/test').Page) {
  // Wait for the main app container to be present
  await page.waitForSelector('[data-testid="app-root"], #root, .relative.flex.h-full', {
    state: 'attached',
    timeout: 30_000,
  });
}

/**
 * Navigate to homepage and wait for shell readiness.
 */
export async function gotoHomepage(page: import('@playwright/test').Page) {
  await page.goto('/');
  await waitForAppReady(page);
}

/**
 * Open the sidebar (chat history panel).
 */
export async function openSidebar(page: import('@playwright/test').Page) {
  // The sidebar toggle button
  const menuButton = page.locator('button[aria-label="Open sidebar"], [data-testid="sidebar-toggle"], button.i-ph\\:sidebar-simple-duotone');
  if (await menuButton.isVisible()) {
    await menuButton.click();
  }
}

/**
 * Open the settings panel.
 */
export async function openSettings(page: import('@playwright/test').Page) {
  // Settings is typically accessed via the sidebar or a settings icon
  await openSidebar(page);
  const settingsButton = page.locator('button:has-text("Settings"), [data-testid="settings-button"], a[href*="settings"]');
  if (await settingsButton.isVisible()) {
    await settingsButton.click();
  }
}

/**
 * Type a message in the chat input and send it.
 */
export async function sendChatMessage(page: import('@playwright/test').Page, message: string) {
  const chatInput = page.locator(
    'textarea[placeholder*="message"], textarea[placeholder*="bolt"], [data-testid="chat-input"], div[contenteditable="true"]'
  );
  await chatInput.fill(message);
  // Press Enter or click send button
  const sendButton = page.locator('button[aria-label="Send message"], [data-testid="send-button"], button:has(.i-ph\\:arrow-right)');
  if (await sendButton.isVisible()) {
    await sendButton.click();
  } else {
    await chatInput.press('Enter');
  }
}
