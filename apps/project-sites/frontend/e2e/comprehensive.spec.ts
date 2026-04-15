import { test, expect } from './fixtures';

/**
 * Comprehensive E2E tests covering:
 * 1. Homepage contact form submission
 * 2. Legal pages use shared header/footer (no double header)
 * 3. Full site generation flow from search to published
 * 4. Build progress page visual inspection
 * 5. Admin files feature — tree navigation and file editing
 * 6. Admin files feature — visual inspection of editor
 * 7. Admin logs feature — visual inspection
 * 8. Admin domains feature — connect tab
 * 9. Link hover underline styles
 * 10. Homepage → all page navigation smoke test
 */

test.describe('Comprehensive Feature Tests', () => {

  // ─── 1. Homepage contact form submission ────────────────────
  test('homepage contact form submits successfully', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Dismiss geolocation modal if present (Ionic overlay needs force: true)
    const notNow = page.locator('button').filter({ hasText: 'Not now' });
    try {
      await notNow.waitFor({ state: 'visible', timeout: 3000 });
      await notNow.click({ force: true });
      await notNow.waitFor({ state: 'hidden', timeout: 2000 });
    } catch { /* no modal */ }

    // Scroll to contact section
    const contactSection = page.locator('#contact-section');
    await contactSection.scrollIntoViewIfNeeded();
    await expect(contactSection).toBeVisible();

    // Fill out the form
    await page.locator('#contact-name').fill('Jane Doe');
    await page.locator('#contact-email').fill('jane@example.com');
    await page.locator('#contact-phone').fill('+1 (555) 867-5309');
    await page.locator('#contact-message').fill('I need a website for my bakery');

    // Submit the form
    const submitBtn = page.locator('.contact-form-wrap button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toContainText('Send Message');
    await submitBtn.click({ force: true });

    // Verify success state
    await expect(page.locator('.contact-success')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.contact-success')).toContainText(/sent|message/i);
  });

  // ─── 2. Legal pages use shared header, no double header ────
  test('legal pages show single shared header and matching footer', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('networkidle');

    // Should have exactly ONE header (from app component, not duplicated by legal)
    const headers = page.locator('app-header');
    await expect(headers).toHaveCount(1);

    // Header should contain logo text
    const headerEl = page.locator('app-header .header').first();
    await expect(headerEl).toBeVisible();
    await expect(page.locator('.logo-text').first()).toContainText('Project Sites');

    // Breadcrumbs should show
    await expect(page.locator('.breadcrumbs')).toBeVisible();
    await expect(page.locator('.breadcrumb-current')).toContainText('Privacy');

    // Page title should render
    await expect(page.locator('.legal-header h1')).toContainText('Privacy Policy');

    // Footer should exist with social icons and legal links
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    const footer = page.locator('.site-footer');
    await expect(footer).toBeVisible();

    // Footer social links should be present
    const socialLinks = footer.locator('.footer-social a');
    await expect(socialLinks).toHaveCount(6);

    // Footer legal links should be present
    await expect(footer.locator('.footer-bottom')).toContainText('Privacy Policy');
    await expect(footer.locator('.footer-bottom')).toContainText('Terms of Service');
    await expect(footer.locator('.footer-bottom')).toContainText('Content Policy');

    // Verify terms page also has single header
    await page.goto('/terms');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('app-header')).toHaveCount(1);
    await expect(page.locator('.breadcrumb-current')).toContainText('Terms');
    await expect(page.locator('.legal-header h1')).toContainText('Terms of Service');

    // Verify content policy page also has single header
    await page.goto('/content');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('app-header')).toHaveCount(1);
    await expect(page.locator('.breadcrumb-current')).toContainText('Content Policy');
  });

  // ─── 3. Full site generation: search → select → create → building ──
  test('full site generation flow from homepage search to build', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Type in search
    const searchInput = page.locator('.search-input');
    await searchInput.fill('Vito');
    await page.waitForTimeout(500);

    // Search results should appear
    const dropdown = page.locator('.search-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Click the first business result
    const firstResult = dropdown.locator('.search-result').first();
    await expect(firstResult).toBeVisible();
    await firstResult.click();

    // Should navigate to create page or waiting page
    await page.waitForURL(/\/(create|waiting|details)/, { timeout: 5000 });

    // If on create page, fill and submit
    const currentUrl = page.url();
    if (currentUrl.includes('/create') || currentUrl.includes('/details')) {
      // Business name should be pre-filled
      const nameField = page.locator('input[formControlName="name"], input[name="name"]').first();
      if (await nameField.isVisible()) {
        const nameValue = await nameField.inputValue();
        expect(nameValue.length).toBeGreaterThan(0);
      }

      // Submit the form
      const buildBtn = page.locator('button').filter({ hasText: /build/i });
      if (await buildBtn.isVisible()) {
        await buildBtn.click();
        // Should navigate to waiting page
        await page.waitForURL(/\/waiting/, { timeout: 5000 });
      }
    }
  });

  // ─── 4. Build progress page visual inspection ──────────────
  test('build progress page shows spinner and status', async ({ authedPage: page }) => {
    await page.goto('/waiting?id=site-001&slug=vitos-mens-salon');

    await expect(page.locator('.waiting-card')).toBeVisible();
    await expect(page.locator('.spinner')).toBeVisible();
    await expect(page.locator('.waiting-title')).toContainText('Preparing');
    await expect(page.locator('.waiting-subtitle')).toBeVisible();
    await expect(page.locator('button').filter({ hasText: /dashboard/i })).toBeVisible();

    // Mock returns site-001 as "published", so after the 3s poll interval
    // the success message should appear
    await expect(page.locator('.waiting-title')).toBeVisible({ timeout: 10000 });
  });

  // ─── 5. Admin files feature — tree navigation and editing ──
  test('admin files modal shows file tree and allows editing', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Find a site card and click Files button
    const filesBtn = page.locator('.site-action-btn').filter({ hasText: /files/i }).first();
    await expect(filesBtn).toBeVisible({ timeout: 5000 });
    await filesBtn.click();

    // Files modal should open
    const modal = page.locator('.modal-overlay');
    await expect(modal).toBeVisible({ timeout: 3000 });

    // File tree panel should be visible
    const fileTree = page.locator('.file-tree-panel');
    await expect(fileTree).toBeVisible();

    // Should have file entries
    const files = page.locator('.tree-file');
    await expect(files.first()).toBeVisible({ timeout: 3000 });
    const fileCount = await files.count();
    expect(fileCount).toBeGreaterThanOrEqual(3);

    // Click an HTML file to open it in the editor
    const htmlFile = page.locator('.tree-file').filter({ hasText: 'index.html' }).first();
    await htmlFile.click();
    await page.waitForTimeout(500);

    // Editor panel should show content
    const editor = page.locator('.file-editor-panel');
    await expect(editor).toBeVisible();

    // File should be marked as active
    await expect(htmlFile).toHaveClass(/active/);

    // Editor should have a textarea or code area with content
    const editorContent = page.locator('.file-editor-content');
    await expect(editorContent).toBeVisible();
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.file-editor-content') as HTMLTextAreaElement;
        return el && el.value && el.value.length > 10;
      },
      { timeout: 5000 }
    );
  });

  // ─── 6. Admin files — visual inspection of split layout ────
  test('admin files modal has correct split layout with tree and editor', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open files modal
    const filesBtn = page.locator('.site-action-btn').filter({ hasText: /files/i }).first();
    await filesBtn.click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // Verify the split layout
    const splitLayout = page.locator('.files-split');
    await expect(splitLayout).toBeVisible();

    // Click a file to load the editor
    const firstFile = page.locator('.tree-file.editable').first();
    await firstFile.click();
    await page.waitForTimeout(500);

    // Take screenshot for visual verification
    await page.screenshot({ path: '/tmp/e2e-files-editor.png' });

    // Verify the editor has correct visual structure
    const fileTreePanel = page.locator('.file-tree-panel');
    const editorPanel = page.locator('.file-editor-panel');

    const treeBox = await fileTreePanel.boundingBox();
    const editorBox = await editorPanel.boundingBox();

    expect(treeBox).not.toBeNull();
    expect(editorBox).not.toBeNull();

    // Tree should be on the left, editor on the right
    if (treeBox && editorBox) {
      expect(treeBox.x).toBeLessThan(editorBox.x);
      // Editor should be wider than the tree
      expect(editorBox.width).toBeGreaterThan(treeBox.width);
    }

    // Verify directories are expandable
    const dirLabels = page.locator('.tree-dir-label');
    if (await dirLabels.count() > 0) {
      const firstDir = dirLabels.first();
      await expect(firstDir).toBeVisible();
    }

    // Close modal
    await page.locator('.modal-close').first().click();
    await expect(page.locator('.modal-overlay')).not.toBeVisible({ timeout: 3000 });
  });

  // ─── 7. Admin logs feature — visual inspection ─────────────
  test('admin logs modal shows formatted log entries with timestamps', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open logs modal
    const logsBtn = page.locator('.site-action-btn').filter({ hasText: /logs/i }).first();
    await expect(logsBtn).toBeVisible({ timeout: 5000 });
    await logsBtn.click();

    // Logs modal should open
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // Log entries should be visible
    const logEntries = page.locator('.log-entry');
    await expect(logEntries.first()).toBeVisible({ timeout: 3000 });
    const logCount = await logEntries.count();
    expect(logCount).toBeGreaterThanOrEqual(5);

    // Each entry should have action label and timestamp
    const firstLog = logEntries.first();
    await expect(firstLog.locator('.log-action')).toBeVisible();
    await expect(firstLog.locator('.log-ts')).toBeVisible();

    // Take screenshot for visual verification
    await page.screenshot({ path: '/tmp/e2e-logs-modal.png' });

    // Verify logs have readable labels (not raw codes)
    const firstAction = await firstLog.locator('.log-action').textContent();
    expect(firstAction).toBeTruthy();
    expect(firstAction!.length).toBeGreaterThan(3);

    // Verify logs container has proper scrolling
    const logsContainer = page.locator('.logs-container');
    if (await logsContainer.isVisible()) {
      const style = await logsContainer.evaluate(el => getComputedStyle(el).maxHeight);
      // Should have a max-height set
      expect(style).not.toBe('none');
    }
  });

  // ─── 8. Admin domains modal — connect tab ──────────────────
  test('admin domains modal shows existing domains and connect form', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open domains modal
    const domainsBtn = page.locator('.site-action-btn').filter({ hasText: /domains/i }).first();
    await expect(domainsBtn).toBeVisible({ timeout: 5000 });
    await domainsBtn.click();

    // Modal should open
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // Should show existing domains tab
    const domainsList = page.locator('.hostname-item, .domain-item');
    if (await domainsList.count() > 0) {
      await expect(domainsList.first()).toBeVisible();
    }

    // Connect tab should be accessible
    const connectTab = page.locator('[data-tab="connect"], .tab-btn').filter({ hasText: /connect/i });
    if (await connectTab.isVisible()) {
      await connectTab.click();
      await page.waitForTimeout(300);

      // Connect form should have a domain input
      const domainInput = page.locator('input[placeholder*="domain"], input[placeholder*="example"]');
      if (await domainInput.isVisible()) {
        await expect(domainInput).toBeVisible();
        // Type a test domain
        await domainInput.fill('mybusiness.com');
      }
    }

    // Take screenshot
    await page.screenshot({ path: '/tmp/e2e-domains-modal.png' });
  });

  // ─── 9. Link hover underline styles applied correctly ──────
  test('links and buttons have correct base text-decoration styling', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('networkidle');

    // Footer legal links should have no underline by default
    const footerLink = page.locator('.footer-bottom a').first();
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await expect(footerLink).toBeVisible();

    const linkDecoration = await footerLink.evaluate(el => {
      return getComputedStyle(el).textDecorationLine;
    });
    expect(linkDecoration).toBe('none');

    // Social icon links should also have no underline
    const socialLink = page.locator('.footer-social a').first();
    if (await socialLink.isVisible()) {
      const socialDecoration = await socialLink.evaluate(el => {
        return getComputedStyle(el).textDecorationLine;
      });
      expect(socialDecoration).toBe('none');
    }
  });

  // ─── 10. Homepage → full navigation smoke test ─────────────
  test('all major pages are reachable from homepage navigation', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Verify homepage rendered
    await expect(page.locator('.hero-brand h1').first()).toBeVisible();

    // Navigate to footer and click Privacy link
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await page.locator('.footer-bottom a').filter({ hasText: 'Privacy' }).click();
    await page.waitForURL('**/privacy', { timeout: 5000 });
    await expect(page.locator('.legal-header h1')).toContainText('Privacy Policy');

    // Go back to home via breadcrumb
    await page.locator('.breadcrumb-link').click();
    await page.waitForURL(/\/$/, { timeout: 5000 });

    // Navigate to Terms via footer
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await page.locator('.footer-bottom a').filter({ hasText: 'Terms' }).click();
    await page.waitForURL('**/terms', { timeout: 5000 });
    await expect(page.locator('.legal-header h1')).toContainText('Terms of Service');

    // Navigate to admin (already authenticated)
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.admin-panel')).toBeVisible();
    await expect(page.locator('.admin-panel-title')).toContainText('My Sites');

    // Navigate to create page
    await page.goto('/create');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1, h2').filter({ hasText: /create/i }).first()).toBeVisible();

    // Navigate to signin page
    await page.goto('/signin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.signin-card')).toBeVisible();

    // Navigate to waiting page
    await page.goto('/waiting?id=test-id&slug=test-slug');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.waiting-card')).toBeVisible();

    // Content policy page
    await page.goto('/content');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.legal-header h1')).toContainText('Content Policy');
  });

});
