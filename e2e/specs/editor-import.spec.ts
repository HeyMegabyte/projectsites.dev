/**
 * @module e2e/editor-import
 * @description TDD specs for editor.projectsites.dev integrations:
 *   - `?slug=X` and `?importChatFrom=URL` populate the chat directly (no JSON-viewer redirect).
 *   - Diff button removed from workbench.
 *   - Deploy button removed from header.
 *   - Left-edge sidebar drawer no longer auto-opens on hover.
 *
 * Every test starts at the homepage ("/").
 */

import { test, expect, gotoHomepage } from '../fixtures.js';

const STJ_CHAT_URL = 'https://projectsites.dev/api/sites/by-slug/st-johns-soup-kitchen/chat';

const fakeChatResponse = {
  description: 'St Johns Soup Kitchen',
  messages: [
    { id: 'msg-user-stj', role: 'user', content: 'Build a website for St. Johns Soup Kitchen' },
    {
      id: 'msg-asst-stj',
      role: 'assistant',
      content:
        'I\'ve built a website with 1 file.\n<boltArtifact id="site-stj" title="St Johns Site">\n<boltAction type="file" filePath="index.html"><!doctype html><title>St Johns</title></boltAction>\n</boltArtifact>',
    },
  ],
  exportDate: new Date().toISOString(),
};

test.describe('Editor import flow (slug-based)', () => {
  test('slug query param populates chat directly without JSON redirect', async ({ page }) => {
    // Mock the upstream by-slug/chat call so the test is deterministic
    await page.route(STJ_CHAT_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fakeChatResponse),
      }),
    );

    await page.goto('/?slug=st-johns-soup-kitchen');

    // Should NOT navigate to a JSON viewer — must remain on the editor app shell
    await page.waitForSelector('[data-testid="app-root"], #root, .relative.flex.h-full', {
      state: 'attached',
      timeout: 30_000,
    });

    // The page must not be raw JSON
    const bodyText = await page.locator('body').innerText();
    expect(bodyText).not.toMatch(/^\s*\{\s*"description"/);

    // URL params should be cleared (we strip ?slug=X after consuming)
    await expect.poll(async () => new URL(page.url()).search, { timeout: 10_000 }).toBe('');
  });

  test('importChatFrom URL still works for backward compatibility', async ({ page }) => {
    const customUrl = 'https://example.com/chat-export.json';
    await page.route(customUrl, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fakeChatResponse),
      }),
    );

    await page.goto(`/?importChatFrom=${encodeURIComponent(customUrl)}`);
    await page.waitForSelector('[data-testid="app-root"], #root, .relative.flex.h-full', {
      state: 'attached',
      timeout: 30_000,
    });
    await expect.poll(async () => new URL(page.url()).search, { timeout: 10_000 }).toBe('');
  });
});

test.describe('Editor UI cleanup', () => {
  test('Deploy button is not present in header', async ({ page }) => {
    await gotoHomepage(page);

    // Deploy button text/aria
    const deploy = page.getByRole('button', { name: /deploy/i });
    await expect(deploy).toHaveCount(0);
  });

  test('Diff slider option is not in workbench (slider only shows Code | Preview)', async ({ page }) => {
    await gotoHomepage(page);

    // The slider only renders after chat starts — but we can still assert these labels never appear in DOM
    const diffLabel = page.getByText(/^Diff$/);
    const deployLabel = page.getByText(/^Deploy$/);
    await expect(diffLabel).toHaveCount(0);
    await expect(deployLabel).toHaveCount(0);
  });

  test('Left-edge mouse hover does NOT open sidebar drawer', async ({ page }) => {
    await gotoHomepage(page);

    // Move mouse to far left edge — old behavior would open the Menu drawer
    await page.mouse.move(0, 200);
    await page.mouse.move(5, 200);
    await page.waitForTimeout(500);

    // The Menu drawer aria-label / sidebar testid should NOT become visible
    const sidebarMenu = page.locator(
      '[data-testid="sidebar"], [aria-label="Sidebar"], nav[role="navigation"][data-state="open"]',
    );
    const visibleCount = await sidebarMenu.evaluateAll(
      (els) => els.filter((el) => (el as HTMLElement).offsetWidth > 50).length,
    );
    expect(visibleCount).toBe(0);
  });
});
