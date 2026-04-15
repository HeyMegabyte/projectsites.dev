import { test, expect, Page } from '@playwright/test';

/**
 * Production integration tests for the admin dashboard.
 *
 * These tests run against the REAL projectsites.dev — no mock server.
 * They verify that brian@megabyte.space can see vitos-mens-salon-3,
 * manage files, and that the admin UI works without console errors.
 *
 * Prerequisites:
 *   - PROD_SESSION_TOKEN env var must be set (a valid session token for brian@megabyte.space)
 *   - Run with: PROD_SESSION_TOKEN=<token> npx playwright test --config e2e/production-integration.config.ts
 *
 * If PROD_SESSION_TOKEN is not set, tests will be skipped.
 */

const SCREENSHOT_DIR = 'test-results/production-screenshots';
const SESSION_TOKEN = process.env['PROD_SESSION_TOKEN'] ?? '';
const EXPECTED_SITE_SLUG = 'vitos-mens-salon-3';
const EXPECTED_SITE_URL = `https://${EXPECTED_SITE_SLUG}.projectsites.dev`;

/** Helper: authenticate the page using localStorage session injection */
async function authenticate(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((token: string) => {
    localStorage.setItem('ps_session', JSON.stringify({
      token,
      identifier: 'brian@megabyte.space',
    }));
  }, SESSION_TOKEN);
  await page.reload();
  await page.waitForLoadState('networkidle');
}

/** Helper: dismiss geolocation modal if present */
async function dismissGeoModal(page: Page): Promise<void> {
  try {
    const notNow = page.locator('button').filter({ hasText: 'Not now' });
    await notNow.waitFor({ state: 'visible', timeout: 3000 });
    await notNow.click({ force: true });
    await notNow.waitFor({ state: 'hidden', timeout: 2000 });
  } catch { /* no modal */ }
}

/** Helper: navigate to admin and wait for sites to load */
async function goToAdmin(page: Page): Promise<void> {
  await authenticate(page);
  await dismissGeoModal(page);

  // Navigate to admin
  const adminLink = page.locator('a[href="/admin"], .nav-link').filter({ hasText: /admin|dashboard|my sites/i }).first();
  if (await adminLink.isVisible({ timeout: 3000 }).catch(() => false)) {
    await adminLink.click({ force: true });
  } else {
    await page.goto('/admin');
  }
  await page.waitForLoadState('networkidle');

  // Wait for sites grid or empty state
  await expect(
    page.locator('.site-grid, .admin-empty, .admin-loading')
  ).toBeVisible({ timeout: 15000 });

  // If loading, wait for it to finish
  const loading = page.locator('.admin-loading');
  if (await loading.isVisible({ timeout: 1000 }).catch(() => false)) {
    await loading.waitFor({ state: 'hidden', timeout: 15000 });
  }
}

// Skip all tests if no session token is provided
test.describe('Production Admin — vitos-mens-salon-3', () => {
  test.skip(!SESSION_TOKEN, 'PROD_SESSION_TOKEN not set — skipping production tests');

  // ─── 1. Admin dashboard loads and shows sites ───────────────
  test('1: admin dashboard loads with site cards', async ({ page }) => {
    await goToAdmin(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/01-admin-loaded.png`, fullPage: true });

    // Should have at least one site card
    const siteCards = page.locator('.site-card');
    const count = await siteCards.count();
    expect(count).toBeGreaterThan(0);

    // Header shows "My Sites"
    await expect(page.locator('.admin-panel-title')).toContainText('My Sites');
  });

  // ─── 2. vitos-mens-salon-3 is visible in the dashboard ─────
  test('2: vitos-mens-salon-3 site card is present', async ({ page }) => {
    await goToAdmin(page);

    // Look for the site by slug or business name
    const siteCard = page.locator('.site-card').filter({
      has: page.locator(`.site-card-domain[href*="${EXPECTED_SITE_SLUG}"], .site-card-name:has-text("Vito")`)
    }).first();

    await expect(siteCard).toBeVisible({ timeout: 10000 });
    await siteCard.screenshot({ path: `${SCREENSHOT_DIR}/02-vitos-card.png` });

    // Verify the domain link points to the correct URL
    const domainLink = siteCard.locator('.site-card-domain');
    if (await domainLink.isVisible()) {
      const href = await domainLink.getAttribute('href');
      expect(href).toContain(EXPECTED_SITE_SLUG);
    }
  });

  // ─── 3. Site card preview iframe renders without errors ─────
  test('3: site preview iframe loads without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore known harmless errors (Cloudflare RUM, CORS from sandboxed iframes)
        if (
          text.includes('cdn-cgi') ||
          text.includes('rum?') ||
          text.includes('CORS') ||
          text.includes('sandboxed') ||
          text.includes('allow-scripts') ||
          text.includes('favicon') ||
          text.includes('net::ERR')
        ) return;
        errors.push(text);
      }
    });

    await goToAdmin(page);

    const siteCard = page.locator('.site-card').filter({
      has: page.locator(`[href*="${EXPECTED_SITE_SLUG}"]`)
    }).first();

    if (await siteCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Check iframe is present
      const iframe = siteCard.locator('iframe');
      await expect(iframe).toBeAttached();
      await expect(iframe).toHaveAttribute('sandbox', 'allow-same-origin');

      await page.screenshot({ path: `${SCREENSHOT_DIR}/03-preview-iframe.png` });
    }

    // Wait a moment for any delayed errors
    await page.waitForTimeout(2000);

    // Filter out any remaining noise
    const realErrors = errors.filter(e =>
      !e.includes('cdn-cgi') && !e.includes('CORS') && !e.includes('sandbox')
    );
    expect(realErrors).toEqual([]);
  });

  // ─── 4. Iframe does not flash on card click ────────────────
  test('4: clicking card area does not cause iframe flash', async ({ page }) => {
    await goToAdmin(page);

    const siteCard = page.locator('.site-card').filter({
      has: page.locator(`[href*="${EXPECTED_SITE_SLUG}"]`)
    }).first();

    if (await siteCard.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Take screenshot before interaction
      await siteCard.screenshot({ path: `${SCREENSHOT_DIR}/04a-before-click.png` });

      // Click empty area of the card (not on buttons/links)
      const cardBody = siteCard.locator('.site-card-body');
      await cardBody.click({ force: true, position: { x: 5, y: 5 } });
      await page.waitForTimeout(300);

      // Take screenshot after — should look identical (no flash)
      await siteCard.screenshot({ path: `${SCREENSHOT_DIR}/04b-after-click.png` });

      // Verify no CSS transition on box-shadow (which causes flash)
      const transition = await siteCard.evaluate(el => getComputedStyle(el).transition);
      // Should not contain box-shadow or transform transitions
      expect(transition).not.toContain('box-shadow');
      expect(transition).not.toContain('transform');
    }
  });

  // ─── 5. Files modal opens for vitos-mens-salon-3 ───────────
  test('5: files button opens the files modal', async ({ page }) => {
    await goToAdmin(page);

    // Find the site card
    const siteCard = page.locator('.site-card').filter({
      has: page.locator(`[href*="${EXPECTED_SITE_SLUG}"]`)
    }).first();

    if (!(await siteCard.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'vitos-mens-salon-3 site card not found');
      return;
    }

    // Click Files button
    const filesBtn = siteCard.locator('.site-action-btn').filter({ hasText: 'Files' });
    await expect(filesBtn).toBeVisible();
    await filesBtn.click({ force: true });

    // Files modal should open
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: `${SCREENSHOT_DIR}/05-files-modal-open.png`, fullPage: true });

    // Should show the site name
    await expect(page.locator('.modal-header')).toContainText(/Vito|Files/i);
  });

  // ─── 6. Files modal shows file tree ─────────────────────────
  test('6: file tree displays directories and files', async ({ page }) => {
    await goToAdmin(page);

    const siteCard = page.locator('.site-card').filter({
      has: page.locator(`[href*="${EXPECTED_SITE_SLUG}"]`)
    }).first();

    if (!(await siteCard.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'Site card not found');
      return;
    }

    await siteCard.locator('.site-action-btn').filter({ hasText: 'Files' }).click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 10000 });

    // Wait for file tree to load
    const fileTree = page.locator('.file-tree');
    await expect(fileTree).toBeVisible({ timeout: 10000 });

    // Should have at least one file entry
    const fileEntries = page.locator('.tree-file, .tree-dir');
    const entryCount = await fileEntries.count();
    expect(entryCount).toBeGreaterThan(0);

    await page.screenshot({ path: `${SCREENSHOT_DIR}/06-file-tree.png` });

    // Check for common files (index.html should exist)
    const indexFile = page.locator('.tree-file-name').filter({ hasText: 'index.html' });
    await expect(indexFile).toBeVisible({ timeout: 5000 });
  });

  // ─── 7. Clicking a file opens the editor ───────────────────
  test('7: selecting a file loads content in the editor', async ({ page }) => {
    await goToAdmin(page);

    const siteCard = page.locator('.site-card').filter({
      has: page.locator(`[href*="${EXPECTED_SITE_SLUG}"]`)
    }).first();

    if (!(await siteCard.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'Site card not found');
      return;
    }

    await siteCard.locator('.site-action-btn').filter({ hasText: 'Files' }).click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 10000 });

    // Wait for tree to load
    await expect(page.locator('.tree-file-name').first()).toBeVisible({ timeout: 10000 });

    // Click index.html
    const indexFile = page.locator('.tree-file').filter({ hasText: 'index.html' }).first();
    await indexFile.click();

    // Editor should appear
    await expect(page.locator('.file-editor')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000); // wait for content to load

    // Editor should have content (textarea or content area)
    const textarea = page.locator('.file-editor-content');
    if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
      const content = await textarea.inputValue();
      expect(content.length).toBeGreaterThan(0);
      // HTML file should contain DOCTYPE or html tag
      expect(content.toLowerCase()).toContain('html');
    }

    await page.screenshot({ path: `${SCREENSHOT_DIR}/07-editor-open.png` });
  });

  // ─── 8. Editor shows file name and save button ─────────────
  test('8: editor header shows filename and save button', async ({ page }) => {
    await goToAdmin(page);

    const siteCard = page.locator('.site-card').filter({
      has: page.locator(`[href*="${EXPECTED_SITE_SLUG}"]`)
    }).first();

    if (!(await siteCard.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'Site card not found');
      return;
    }

    await siteCard.locator('.site-action-btn').filter({ hasText: 'Files' }).click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.tree-file-name').first()).toBeVisible({ timeout: 10000 });

    // Open index.html
    await page.locator('.tree-file').filter({ hasText: 'index.html' }).first().click();
    await expect(page.locator('.file-editor')).toBeVisible({ timeout: 10000 });

    // File name should be displayed
    const fileName = page.locator('.file-editor-name');
    if (await fileName.isVisible({ timeout: 3000 }).catch(() => false)) {
      await expect(fileName).toContainText('index.html');
    }

    // Save button should be present
    const saveBtn = page.locator('.file-editor .btn').filter({ hasText: /save/i });
    await expect(saveBtn).toBeVisible();

    await page.screenshot({ path: `${SCREENSHOT_DIR}/08-editor-header.png` });
  });

  // ─── 9. Can edit file content ──────────────────────────────
  test('9: can type in the editor textarea', async ({ page }) => {
    await goToAdmin(page);

    const siteCard = page.locator('.site-card').filter({
      has: page.locator(`[href*="${EXPECTED_SITE_SLUG}"]`)
    }).first();

    if (!(await siteCard.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'Site card not found');
      return;
    }

    await siteCard.locator('.site-action-btn').filter({ hasText: 'Files' }).click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.tree-file-name').first()).toBeVisible({ timeout: 10000 });

    // Open an editable file
    await page.locator('.tree-file').filter({ hasText: 'index.html' }).first().click();
    await expect(page.locator('.file-editor')).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    const textarea = page.locator('.file-editor-content');
    if (await textarea.isVisible({ timeout: 3000 }).catch(() => false)) {
      // Record original content
      const originalContent = await textarea.inputValue();

      // Type at the end
      await textarea.evaluate((el: HTMLTextAreaElement) => {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
      await page.keyboard.type('<!-- E2E test marker -->');

      const newContent = await textarea.inputValue();
      expect(newContent).toContain('<!-- E2E test marker -->');

      // Restore original content (don't save test edits to production)
      await textarea.evaluate((el: HTMLTextAreaElement, original: string) => {
        el.value = original;
        el.dispatchEvent(new Event('input'));
      }, originalContent);

      await page.screenshot({ path: `${SCREENSHOT_DIR}/09-editor-typing.png` });
    }
  });

  // ─── 10. Files modal closes cleanly ────────────────────────
  test('10: files modal closes via X button', async ({ page }) => {
    await goToAdmin(page);

    const siteCard = page.locator('.site-card').filter({
      has: page.locator(`[href*="${EXPECTED_SITE_SLUG}"]`)
    }).first();

    if (!(await siteCard.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'Site card not found');
      return;
    }

    await siteCard.locator('.site-action-btn').filter({ hasText: 'Files' }).click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 10000 });

    // Close via X button
    await page.locator('.files-modal .modal-close').click();
    await expect(page.locator('.files-modal')).not.toBeVisible({ timeout: 5000 });

    await page.screenshot({ path: `${SCREENSHOT_DIR}/10-modal-closed.png` });
  });

  // ─── 11. Directory expand/collapse works ───────────────────
  test('11: directory nodes expand and collapse', async ({ page }) => {
    await goToAdmin(page);

    const siteCard = page.locator('.site-card').filter({
      has: page.locator(`[href*="${EXPECTED_SITE_SLUG}"]`)
    }).first();

    if (!(await siteCard.isVisible({ timeout: 5000 }).catch(() => false))) {
      test.skip(true, 'Site card not found');
      return;
    }

    await siteCard.locator('.site-action-btn').filter({ hasText: 'Files' }).click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.tree-file-name').first()).toBeVisible({ timeout: 10000 });

    // Find a directory node
    const dirNode = page.locator('.tree-dir-label').first();
    if (await dirNode.isVisible({ timeout: 3000 }).catch(() => false)) {
      const dirName = await dirNode.textContent();

      // Click to collapse
      await dirNode.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/11a-dir-collapsed.png` });

      // Click to expand
      await dirNode.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/11b-dir-expanded.png` });
    }
  });

  // ─── 12. Admin page has no real console errors ─────────────
  test('12: admin page loads without application errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore infrastructure noise
        if (
          text.includes('cdn-cgi') || text.includes('rum?') ||
          text.includes('CORS') || text.includes('sandboxed') ||
          text.includes('allow-scripts') || text.includes('favicon') ||
          text.includes('net::ERR') || text.includes('404') ||
          text.includes('Failed to load resource') ||
          text.includes('Access-Control')
        ) return;
        errors.push(text);
      }
    });

    await goToAdmin(page);
    await page.waitForTimeout(3000); // let everything settle

    await page.screenshot({ path: `${SCREENSHOT_DIR}/12-admin-clean.png`, fullPage: true });

    expect(errors).toEqual([]);
  });
});
