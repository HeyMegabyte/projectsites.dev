import { test, expect } from '@playwright/test';

/**
 * Production E2E tests for editor.projectsites.dev (bolt.diy).
 *
 * Verifies that the bolt.diy editor is correctly deployed and functional,
 * matching the behavior of bolt.megabyte.space.
 *
 * No auth required — these test the public-facing editor.
 *
 * Usage:
 *   cd apps/project-sites/frontend
 *   npx playwright test --config e2e/production-integration.config.ts production-editor.spec.ts
 */

const EDITOR_URL = 'https://editor.projectsites.dev';
const REFERENCE_URL = 'https://bolt.megabyte.space';

test.describe('editor.projectsites.dev — bolt.diy deployment', () => {
  test.slow(); // These hit production, allow extra time

  test('1. editor loads without NOT_FOUND error', async ({ page }) => {
    const response = await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded' });
    expect(response).not.toBeNull();
    expect(response!.status()).toBeLessThan(400);

    // Must NOT show the worker JSON error
    const body = await page.textContent('body');
    expect(body).not.toContain('NOT_FOUND');
    expect(body).not.toContain('Site not found');
  });

  test('2. editor serves HTML (not JSON)', async ({ page }) => {
    const response = await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded' });
    const contentType = response?.headers()['content-type'] ?? '';
    expect(contentType).toContain('text/html');
  });

  test('3. editor has correct cross-origin headers for WebContainers', async ({ page }) => {
    const response = await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded' });
    const headers = response!.headers();

    // Must have COOP: same-origin for SharedArrayBuffer
    expect(headers['cross-origin-opener-policy']).toBe('same-origin');

    // Must have COEP: credentialless (or require-corp) for crossOriginIsolated
    expect(['credentialless', 'require-corp']).toContain(headers['cross-origin-embedder-policy']);
  });

  test('4. editor does NOT have restrictive CSP blocking WebAssembly', async ({ page }) => {
    const response = await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded' });
    const csp = response!.headers()['content-security-policy'] ?? '';

    // CSP should either be absent or include unsafe-eval/wasm-unsafe-eval
    if (csp) {
      // If there's a CSP, it must allow wasm
      const hasWasmEval = csp.includes('wasm-unsafe-eval') || csp.includes('unsafe-eval');
      expect(hasWasmEval).toBe(true);
    }
    // If no CSP, that's fine — matches bolt.megabyte.space behavior
  });

  test('5. editor page has a title', async ({ page }) => {
    await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded' });
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('6. editor loads JavaScript bundles', async ({ page }) => {
    const jsLoaded: string[] = [];
    page.on('response', (resp) => {
      if (resp.url().includes('.js') && resp.status() === 200) {
        jsLoaded.push(resp.url());
      }
    });

    await page.goto(EDITOR_URL, { waitUntil: 'load' });
    expect(jsLoaded.length).toBeGreaterThan(0);
  });

  test('7. editor loads CSS stylesheets', async ({ page }) => {
    const cssLoaded: string[] = [];
    page.on('response', (resp) => {
      if (resp.url().includes('.css') && resp.status() === 200) {
        cssLoaded.push(resp.url());
      }
    });

    await page.goto(EDITOR_URL, { waitUntil: 'load' });
    expect(cssLoaded.length).toBeGreaterThan(0);
  });

  test('8. no critical console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore known non-critical errors
        if (
          text.includes('favicon.ico') ||
          text.includes('net::ERR_') ||
          text.includes('Failed to load resource') ||
          text.includes('third-party cookie')
        ) {
          return;
        }
        errors.push(text);
      }
    });

    await page.goto(EDITOR_URL, { waitUntil: 'load' });
    // Wait a bit for any delayed errors
    await page.waitForTimeout(2000);

    // Filter out WebAssembly CSP errors (should be fixed now)
    const wasmErrors = errors.filter(
      (e) => e.includes('WebAssembly') && e.includes('Content Security Policy'),
    );
    expect(wasmErrors).toHaveLength(0);
  });

  test('9. editor renders main UI elements', async ({ page }) => {
    await page.goto(EDITOR_URL, { waitUntil: 'load' });

    // bolt.diy should render a chat interface or settings — check for key UI
    // The page should have some interactive content (not just a blank page)
    const bodyText = await page.textContent('body');
    expect(bodyText!.length).toBeGreaterThan(50);
  });

  test('10. editor screenshot comparison — visual baseline', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(EDITOR_URL, { waitUntil: 'load' });
    await page.waitForTimeout(3000); // Allow animations to settle

    // Take screenshot for visual inspection
    await page.screenshot({
      path: 'e2e/screenshots/editor-projectsites-dev.png',
      fullPage: false,
    });

    // Verify the screenshot was taken (file exists implicitly if no error)
    // This serves as a visual baseline for manual comparison
  });

  test('11. reference site (bolt.megabyte.space) screenshot for comparison', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(REFERENCE_URL, { waitUntil: 'load' });
    await page.waitForTimeout(3000);

    await page.screenshot({
      path: 'e2e/screenshots/bolt-megabyte-space.png',
      fullPage: false,
    });
  });

  test('12. both sites have similar page structure', async ({ page }) => {
    // Check editor
    await page.goto(EDITOR_URL, { waitUntil: 'load' });
    const editorScriptCount = await page.locator('script').count();
    const editorHasRoot = (await page.locator('#root, #app, [data-reactroot]').count()) > 0;

    // Check reference
    await page.goto(REFERENCE_URL, { waitUntil: 'load' });
    const refScriptCount = await page.locator('script').count();
    const refHasRoot = (await page.locator('#root, #app, [data-reactroot]').count()) > 0;

    // Both should have script tags and a root element
    expect(editorScriptCount).toBeGreaterThan(0);
    expect(refScriptCount).toBeGreaterThan(0);
    expect(editorHasRoot).toBe(true);
    expect(refHasRoot).toBe(true);
  });

  test('13. editor CORS headers allow cross-origin requests', async ({ page }) => {
    const response = await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded' });
    const headers = response!.headers();

    // Should have CORS headers from the worker proxy
    expect(headers['access-control-allow-origin']).toBe(`https://${new URL(EDITOR_URL).hostname}`);
    expect(headers['access-control-allow-credentials']).toBe('true');
  });

  test('14. editor has HSTS header', async ({ page }) => {
    const response = await page.goto(EDITOR_URL, { waitUntil: 'domcontentloaded' });
    const hsts = response!.headers()['strict-transport-security'] ?? '';
    expect(hsts).toContain('max-age=');
    expect(hsts).toContain('includeSubDomains');
  });

  test('15. editor static assets load from same origin', async ({ page }) => {
    const assetOrigins: string[] = [];
    page.on('response', (resp) => {
      const url = new URL(resp.url());
      if (
        (url.pathname.endsWith('.js') || url.pathname.endsWith('.css')) &&
        resp.status() === 200
      ) {
        assetOrigins.push(url.origin);
      }
    });

    await page.goto(EDITOR_URL, { waitUntil: 'load' });

    // Most assets should come from the editor origin (proxied through worker)
    const editorOrigin = new URL(EDITOR_URL).origin;
    const fromEditor = assetOrigins.filter((o) => o === editorOrigin);
    expect(fromEditor.length).toBeGreaterThan(0);
  });
});
