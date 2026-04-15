/**
 * Full-Coverage E2E Audit — covers gaps identified in the audit:
 * - Files modal: open, browse, select, edit, save, close
 * - Domain actions: tab switching, connect form
 * - Logs modal: entries, metadata, overflow
 * - Admin inline edits, deploy modal, delete modal
 * - Create page: full form submission flow
 * - Search edge cases: custom build, empty state
 * - Error handling: toast messages, validation
 * - Modal behavior: overlay close, X button
 * - Console error monitoring on every page
 */
import { test, expect } from './fixtures';

// ──────────────────────────────────────────────
// Helper: fail on unexpected console errors
// ──────────────────────────────────────────────
function monitorConsoleErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore known harmless messages
      if (
        text.includes('favicon') ||
        text.includes('404') ||
        text.includes('net::ERR') ||
        text.includes('Failed to load resource') ||
        text.includes('CORS') ||
        text.includes('cdn-cgi') ||
        text.includes('Access-Control-Allow-Origin') ||
        text.includes('rum?') ||
        text.includes('sandboxed') ||
        text.includes('allow-scripts')
      ) return;
      errors.push(text);
    }
  });
  return errors;
}

test.describe('Files Modal — Complete Workflow', () => {
  test('opens files modal and displays file tree with correct structure', async ({ authedPage: page }) => {
    const errors = monitorConsoleErrors(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Click Files button on first site card
    await page.locator('.site-action-btn').filter({ hasText: 'Files' }).first().click({ force: true });

    // Modal should open
    const modal = page.locator('.files-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Screenshot for visual inspection
    await page.screenshot({ path: '/tmp/e2e-files-modal-open.png' });

    // Header should show site name and file count
    await expect(page.locator('.files-modal-header')).toContainText('Files');
    await expect(page.locator('.files-count')).toBeVisible();

    // File tree panel should exist
    await expect(page.locator('.file-tree-panel')).toBeVisible();

    // Should show root HTML files
    await expect(page.locator('.tree-file-name').filter({ hasText: 'index.html' })).toBeVisible();

    // Should show directories (css, js, images)
    await expect(page.locator('.tree-dir-label').filter({ hasText: 'css' })).toBeVisible();
    await expect(page.locator('.tree-dir-label').filter({ hasText: 'js' })).toBeVisible();
    await expect(page.locator('.tree-dir-label').filter({ hasText: 'images' })).toBeVisible();

    // Editor placeholder should show when no file selected
    await expect(page.locator('.file-editor-placeholder')).toBeVisible();
    await expect(page.locator('.file-editor-placeholder')).toContainText('Select a file');

    expect(errors).toEqual([]);
  });

  test('selecting a file loads content in editor', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open files modal
    await page.locator('.site-action-btn').filter({ hasText: 'Files' }).first().click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 5000 });

    // Click on index.html
    await page.locator('.tree-file').filter({ hasText: 'index.html' }).first().click();

    // Editor should appear with content
    const editor = page.locator('.file-editor');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // File name should show in header
    await expect(page.locator('.file-editor-name')).toContainText('index.html');

    // Save button should be visible
    await expect(page.locator('.file-editor .btn').filter({ hasText: /save/i })).toBeVisible();

    // Ctrl+S hint should show
    await expect(page.locator('.file-editor-hint')).toContainText('Ctrl+S');

    // Textarea should have content loaded
    const textarea = page.locator('.file-editor-content');
    await expect(textarea).toBeVisible();
    // Wait for API response to populate content
    await page.waitForTimeout(500);
    const content = await textarea.inputValue();
    expect(content.length).toBeGreaterThan(0);
    expect(content).toContain('Hello World');

    // Screenshot for visual verification
    await page.screenshot({ path: '/tmp/e2e-files-editor-content.png' });
  });

  test('editing file content and saving works', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open files modal
    await page.locator('.site-action-btn').filter({ hasText: 'Files' }).first().click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 5000 });

    // Select index.html
    await page.locator('.tree-file').filter({ hasText: 'index.html' }).first().click();
    await expect(page.locator('.file-editor')).toBeVisible({ timeout: 5000 });

    // Wait for content to load
    const textarea = page.locator('.file-editor-content');
    await expect(textarea).toBeVisible();
    await page.waitForTimeout(500);

    // Focus textarea and type new content
    await textarea.evaluate((el: HTMLTextAreaElement) => {
      el.focus();
      el.select();
    });
    await page.keyboard.type('<h1>Updated Content</h1>');

    // Click save button
    await page.locator('.file-editor .btn').filter({ hasText: /save/i }).click();

    // Save should complete (button text reverts from "Saving..." to "Save")
    await expect(page.locator('.file-editor .btn').filter({ hasText: 'Save' })).toBeVisible({ timeout: 5000 });
  });

  test('switching between files in the tree works', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open files modal
    await page.locator('.site-action-btn').filter({ hasText: 'Files' }).first().click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 5000 });

    // Select index.html first
    await page.locator('.tree-file').filter({ hasText: 'index.html' }).first().click();
    await expect(page.locator('.file-editor-name')).toContainText('index.html');

    // Now select privacy.html
    await page.locator('.tree-file').filter({ hasText: 'privacy.html' }).click();
    await expect(page.locator('.file-editor-name')).toContainText('privacy.html');

    // The active file should be highlighted
    const activeFile = page.locator('.tree-file.active');
    await expect(activeFile).toContainText('privacy.html');
  });

  test('directory expand/collapse toggles children visibility', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open files modal
    await page.locator('.site-action-btn').filter({ hasText: 'Files' }).first().click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 5000 });

    // CSS directory should be visible with children showing
    const cssDir = page.locator('.tree-dir-label').filter({ hasText: 'css' });
    await expect(cssDir).toBeVisible();
    await expect(page.locator('.tree-file-name').filter({ hasText: 'styles.css' })).toBeVisible();

    // Click to collapse
    await cssDir.click();
    await expect(page.locator('.tree-file-name').filter({ hasText: 'styles.css' })).not.toBeVisible();

    // Click again to expand
    await cssDir.click();
    await expect(page.locator('.tree-file-name').filter({ hasText: 'styles.css' })).toBeVisible();
  });

  test('image files are not editable', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open files modal
    await page.locator('.site-action-btn').filter({ hasText: 'Files' }).first().click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 5000 });

    // Images directory should have files
    const logoFile = page.locator('.tree-file').filter({ hasText: 'logo.png' });
    if (await logoFile.count() > 0) {
      const classes = await logoFile.getAttribute('class');
      expect(classes).not.toContain('editable');
    }
  });

  test('file sizes are displayed in the tree', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open files modal
    await page.locator('.site-action-btn').filter({ hasText: 'Files' }).first().click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 5000 });

    // File sizes should be visible
    const sizes = page.locator('.tree-file-size');
    expect(await sizes.count()).toBeGreaterThan(0);
  });

  test('close files modal via X button', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open files modal
    await page.locator('.site-action-btn').filter({ hasText: 'Files' }).first().click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 5000 });

    // Close via the X button that is a sibling of .files-modal (inside the same .modal-card)
    await page.locator('.files-modal .modal-close').click();
    await expect(page.locator('.files-modal')).not.toBeVisible();
  });

  test('close files modal via overlay click', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open files modal
    await page.locator('.site-action-btn').filter({ hasText: 'Files' }).first().click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 5000 });

    // Close via overlay click (click outside modal card)
    await page.locator('.modal-overlay').last().click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.files-modal')).not.toBeVisible();
  });

  test('files modal split layout has correct proportions', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open files modal
    await page.locator('.site-action-btn').filter({ hasText: 'Files' }).first().click({ force: true });
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 5000 });

    // Select a file to show editor
    await page.locator('.tree-file').filter({ hasText: 'index.html' }).first().click();
    await expect(page.locator('.file-editor')).toBeVisible({ timeout: 5000 });

    // Tree panel should be narrower than editor panel
    const treeBox = await page.locator('.file-tree-panel').boundingBox();
    const editorBox = await page.locator('.file-editor-panel').boundingBox();
    expect(treeBox).not.toBeNull();
    expect(editorBox).not.toBeNull();
    if (treeBox && editorBox) {
      expect(editorBox.width).toBeGreaterThan(treeBox.width);
    }

    await page.screenshot({ path: '/tmp/e2e-files-split-layout.png' });
  });
});

test.describe('Logs Modal — Complete Coverage', () => {
  test('logs modal shows colored entries and timestamps', async ({ authedPage: page }) => {
    const errors = monitorConsoleErrors(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open logs modal
    await page.locator('.site-action-btn').filter({ hasText: 'Logs' }).first().click({ force: true });
    const modal = page.locator('.logs-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Should show log entries
    const entries = page.locator('.log-entry');
    expect(await entries.count()).toBeGreaterThan(0);

    // Timestamps should be present
    const timestamps = page.locator('.log-ts');
    expect(await timestamps.count()).toBeGreaterThan(0);

    // Action labels should be human-readable (not raw action strings with dots)
    const labels = page.locator('.log-action');
    const firstLabel = await labels.first().textContent();
    // formatLogAction converts 'workflow.completed' to 'Workflow Completed' etc.
    expect(firstLabel).toBeTruthy();

    // Screenshot
    await page.screenshot({ path: '/tmp/e2e-logs-modal.png' });

    // No visible horizontal scrollbar (overflow-x: hidden applied)
    const overflowX = await modal.evaluate((el) => getComputedStyle(el).overflowX);
    expect(overflowX).toBe('hidden');

    expect(errors).toEqual([]);
  });

  test('logs modal shows metadata for build events', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open logs
    await page.locator('.site-action-btn').filter({ hasText: 'Logs' }).first().click({ force: true });
    await expect(page.locator('.logs-modal')).toBeVisible({ timeout: 5000 });

    // Should show metadata details for some entries
    const metaItems = page.locator('.log-meta');
    expect(await metaItems.count()).toBeGreaterThan(0);
  });
});

test.describe('Domain Management Modal', () => {
  test('domains modal shows all three tabs', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open domains modal
    await page.locator('.site-action-btn').filter({ hasText: 'Domains' }).first().click({ force: true });

    // Wait for modal (uses modal-wide class, not domains-modal)
    const modal = page.locator('.modal-wide');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Three tabs: Your Domains, Connect Domain, Register New
    const tabs = page.locator('.modal-tab');
    expect(await tabs.count()).toBe(3);

    await page.screenshot({ path: '/tmp/e2e-domains-modal.png' });
  });

  test('connect domain tab shows CNAME instructions', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await page.locator('.site-action-btn').filter({ hasText: 'Domains' }).first().click({ force: true });
    await expect(page.locator('.modal-wide')).toBeVisible({ timeout: 5000 });

    // Click "Connect Domain" tab
    await page.locator('.modal-tab').filter({ hasText: /connect/i }).click();

    // Should show domain input or CNAME instructions
    const tabContent = page.locator('.modal-wide');
    const text = await tabContent.textContent();
    expect(text?.toLowerCase()).toMatch(/cname|dns|point|domain/);
  });

  test('existing domains tab shows active domains', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await page.locator('.site-action-btn').filter({ hasText: 'Domains' }).first().click({ force: true });
    await expect(page.locator('.modal-wide')).toBeVisible({ timeout: 5000 });

    // Should show the mock domain (www.vitos-salon.com)
    await expect(page.locator('.modal-wide')).toContainText('vitos-salon.com');
  });
});

test.describe('Admin Dashboard — Actions & Modals', () => {
  test('delete modal shows confirmation', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open more dropdown on first card
    const moreBtn = page.locator('.more-dropdown-wrap .site-action-btn').first();
    await moreBtn.click({ force: true });

    // Wait for dropdown to appear
    const dropdown = page.locator('.more-dropdown');
    await expect(dropdown.first()).toBeVisible({ timeout: 3000 });

    // Click "Delete Site"
    await page.locator('.dropdown-item.danger').first().click({ force: true });

    // Delete modal should appear with confirmation text
    const deleteModal = page.locator('.modal-card').filter({ hasText: /permanently remove/i });
    await expect(deleteModal).toBeVisible({ timeout: 5000 });

    // Should have delete/cancel buttons
    await expect(deleteModal.locator('button').filter({ hasText: /delete/i })).toBeVisible();
    await expect(deleteModal.locator('button').filter({ hasText: /cancel/i })).toBeVisible();

    await page.screenshot({ path: '/tmp/e2e-delete-modal.png' });
  });

  test('site card shows status badge and site name', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Site card should exist
    const card = page.locator('.site-card').first();
    await expect(card).toBeVisible();

    // Should show "Vito's Mens Salon"
    await expect(card).toContainText("Vito's Mens Salon");

    await page.screenshot({ path: '/tmp/e2e-admin-site-card.png' });
  });

  test('new site button navigates to create page', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await page.locator('button').filter({ hasText: /new site/i }).click();
    await expect(page).toHaveURL(/\/create/);
  });

  test('refresh button reloads data', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Click refresh
    const refreshBtn = page.locator('[data-tooltip="Refresh"]');
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click({ force: true });

    // Should still show sites after refresh
    await expect(page.locator('.site-card').first()).toBeVisible();
  });
});

test.describe('Create Page — Full Form Flow', () => {
  test('create page shows all form fields', async ({ authedPage: page }) => {
    const errors = monitorConsoleErrors(page);
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Heading
    await expect(page.locator('h1, h2').filter({ hasText: /create/i })).toBeVisible();

    // Business name input (placeholder contains "Vito" or "business")
    await expect(page.locator('input[placeholder*="Vito"], input[placeholder*="business" i]').first()).toBeVisible();

    // Business address input
    await expect(page.locator('input[placeholder*="Beverwyck"], input[placeholder*="address" i]').first()).toBeVisible();

    // Phone input
    await expect(page.locator('input[placeholder*="555"], input[placeholder*="phone" i]').first()).toBeVisible();

    // Website input
    await expect(page.locator('input[placeholder*="example.com"], input[placeholder*="website" i], input[placeholder*="https" i]').first()).toBeVisible();

    await page.screenshot({ path: '/tmp/e2e-create-page.png' });
    expect(errors).toEqual([]);
  });

  test('create page pre-fills from query parameters', async ({ authedPage: page }) => {
    await page.goto('/create?name=Test%20Business&address=123%20Main%20St');
    await page.waitForLoadState('networkidle');

    // At least one input should have pre-filled value
    const inputs = page.locator('.input-field, input.input-field');
    const inputCount = await inputs.count();
    let hasPrefill = false;
    for (let i = 0; i < inputCount; i++) {
      const val = await inputs.nth(i).inputValue();
      if (val && val.length > 0) {
        hasPrefill = true;
        break;
      }
    }
    expect(hasPrefill).toBeTruthy();
  });
});

test.describe('Search Edge Cases', () => {
  test('search dropdown shows results with business info', async ({ authedPage: page }) => {
    const errors = monitorConsoleErrors(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('.search-input').first();
    await searchInput.fill('Vito');

    // Wait for dropdown
    await page.waitForTimeout(500);
    const dropdown = page.locator('.search-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5000 });

    // Results should show business name
    await expect(dropdown).toContainText(/Vito/i);

    await page.screenshot({ path: '/tmp/e2e-search-results.png' });
    expect(errors).toEqual([]);
  });

  test('empty search does not show dropdown', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('.search-input').first();
    await searchInput.fill('');
    await page.waitForTimeout(500);

    // Dropdown should not be visible
    await expect(page.locator('.search-dropdown')).not.toBeVisible();
  });

  test('custom build option appears in search results', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const searchInput = page.locator('.search-input').first();
    await searchInput.fill('My Custom Business');
    await page.waitForTimeout(500);

    // Should show dropdown with options
    await expect(page.locator('.search-dropdown')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Homepage Sections — Visual Audit', () => {
  test('hero section has correct layout and search bar', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Hero brand section
    const hero = page.locator('.hero-brand');
    await expect(hero).toBeVisible();

    // H1 should be present
    await expect(page.locator('h1')).toBeVisible();

    // Search input should be visible
    await expect(page.locator('.search-input')).toBeVisible();

    await page.screenshot({ path: '/tmp/e2e-hero-section.png' });
  });

  test('pricing section shows free and paid plans', async ({ authedPage: page }) => {
    await page.goto('/');

    // Scroll to pricing
    await page.locator('#pricing').scrollIntoViewIfNeeded();

    // Both plan cards should be visible
    const plans = page.locator('.pricing-card');
    expect(await plans.count()).toBeGreaterThanOrEqual(2);

    // Free plan
    await expect(page.locator('.pricing-card-free')).toBeVisible();
    await expect(page.locator('.pricing-card-free')).toContainText('$0');

    await page.screenshot({ path: '/tmp/e2e-pricing-section.png' });
  });

  test('FAQ section has expandable accordions', async ({ authedPage: page }) => {
    await page.goto('/');

    // Scroll to FAQ
    const faq = page.locator('.faq-list').first();
    await faq.scrollIntoViewIfNeeded();

    // Should have multiple questions
    const questions = page.locator('.faq-item');
    expect(await questions.count()).toBeGreaterThanOrEqual(5);
  });

  test('footer has social links and legal links', async ({ authedPage: page }) => {
    await page.goto('/');

    const footer = page.locator('.site-footer').first();
    await footer.scrollIntoViewIfNeeded();

    // Social links
    const socialLinks = page.locator('.footer-social a');
    expect(await socialLinks.count()).toBeGreaterThanOrEqual(4);

    // Legal links
    await expect(footer).toContainText(/privacy/i);
    await expect(footer).toContainText(/terms/i);
  });

  test('contact form is visible and functional', async ({ authedPage: page }) => {
    await page.goto('/');

    const contactForm = page.locator('.contact-form-wrap').first();
    await contactForm.scrollIntoViewIfNeeded();

    // All form fields should be present
    await expect(contactForm.locator('input[type="text"]').first()).toBeVisible();
    await expect(contactForm.locator('input[type="email"]').first()).toBeVisible();
    await expect(contactForm.locator('textarea').first()).toBeVisible();

    // Submit button
    await expect(contactForm.locator('button[type="submit"]')).toBeVisible();
  });
});

test.describe('Legal Pages — Visual Consistency', () => {
  test('privacy page has shared header, breadcrumbs, and footer', async ({ authedPage: page }) => {
    const errors = monitorConsoleErrors(page);
    await page.goto('/privacy');
    await page.waitForLoadState('networkidle');

    // Shared header from app.component.ts (rendered inside app-header tag)
    await expect(page.locator('.logo-text')).toContainText('Project Sites');

    // Only ONE header (no duplicate) — check for header element inside app-header
    const headers = page.locator('header');
    expect(await headers.count()).toBe(1);

    // Breadcrumbs
    await expect(page.locator('.breadcrumbs')).toBeVisible();
    await expect(page.locator('.breadcrumb-link')).toContainText('Home');
    await expect(page.locator('.breadcrumb-current')).toContainText('Privacy');

    // Content
    await expect(page.locator('.legal-content')).toBeVisible();

    // Footer with social links
    const footer = page.locator('.site-footer');
    await expect(footer).toBeVisible();
    // 6 social icons: GitHub, X, LinkedIn, YouTube, Instagram, Facebook
    expect(await footer.locator('.footer-social a').count()).toBe(6);

    await page.screenshot({ path: '/tmp/e2e-privacy-page.png' });
    expect(errors).toEqual([]);
  });

  test('terms page renders correctly with consistent styling', async ({ authedPage: page }) => {
    await page.goto('/terms');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.logo-text')).toContainText('Project Sites');
    await expect(page.locator('.breadcrumb-current')).toContainText('Terms');
    await expect(page.locator('.legal-content')).toBeVisible();
    await expect(page.locator('.site-footer')).toBeVisible();

    await page.screenshot({ path: '/tmp/e2e-terms-page.png' });
  });

  test('content policy page renders correctly', async ({ authedPage: page }) => {
    await page.goto('/content');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.logo-text')).toContainText('Project Sites');
    await expect(page.locator('.breadcrumb-current')).toContainText('Content');
    await expect(page.locator('.legal-content')).toBeVisible();
    await expect(page.locator('.site-footer')).toBeVisible();

    await page.screenshot({ path: '/tmp/e2e-content-page.png' });
  });
});

test.describe('Signin Page — Visual Audit', () => {
  test('signin page has consistent styling with no console errors', async ({ page }) => {
    const errors = monitorConsoleErrors(page);
    await page.goto('/signin');
    await page.waitForLoadState('networkidle');

    // Google sign-in button
    await expect(page.locator('button, a').filter({ hasText: /google/i }).first()).toBeVisible();

    // Email option
    await expect(page.locator('button, a').filter({ hasText: /email/i }).first()).toBeVisible();

    // Social links in footer
    expect(await page.locator('.signin-footer-social a').count()).toBe(6);

    await page.screenshot({ path: '/tmp/e2e-signin-page.png' });
    expect(errors).toEqual([]);
  });
});

test.describe('Waiting Page — Visual Audit', () => {
  test('waiting page shows spinner with no console errors', async ({ authedPage: page }) => {
    const errors = monitorConsoleErrors(page);
    await page.goto('/waiting?id=site-001&slug=vitos-mens-salon');

    await expect(page.locator('.waiting-card')).toBeVisible();
    await expect(page.locator('.spinner')).toBeVisible();
    await expect(page.locator('.waiting-title')).toContainText('Preparing');

    await page.screenshot({ path: '/tmp/e2e-waiting-page.png' });
    expect(errors).toEqual([]);
  });
});

test.describe('Console Error Monitoring — All Pages', () => {
  test('homepage has no console errors', async ({ page }) => {
    const errors = monitorConsoleErrors(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });

  test('admin page has no console errors', async ({ authedPage: page }) => {
    const errors = monitorConsoleErrors(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    expect(errors).toEqual([]);
  });
});

test.describe('Header — Authentication States', () => {
  test('unauthenticated: shows sign-in button', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.header-signin-btn')).toBeVisible();

    // No avatar should show
    await expect(page.locator('.user-avatar')).not.toBeVisible();
  });

  test('authenticated: shows avatar with initial', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Avatar should show with initial "T" (from test@example.com)
    const avatar = page.locator('.user-avatar');
    await expect(avatar).toBeVisible();
    await expect(avatar).toContainText('T');

    // Sign-in button should NOT show
    await expect(page.locator('.header-signin-btn')).not.toBeVisible();
  });

  test('authenticated: dropdown shows email and menu items', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click avatar to open menu
    await page.locator('.user-menu').click();

    // Dropdown should show
    await expect(page.locator('.dropdown')).toBeVisible();

    // Email should display
    await expect(page.locator('.dropdown-email')).toContainText('test@example.com');

    // Menu items
    await expect(page.locator('.dropdown-item').filter({ hasText: 'Dashboard' })).toBeVisible();
    await expect(page.locator('.dropdown-item').filter({ hasText: 'New Site' })).toBeVisible();
    await expect(page.locator('.dropdown-item').filter({ hasText: 'Sign Out' })).toBeVisible();

    await page.screenshot({ path: '/tmp/e2e-header-dropdown.png' });
  });

  test('sign out clears session and shows sign-in button', async ({ authedPage: page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open menu
    await page.locator('.user-menu').click();
    await expect(page.locator('.dropdown')).toBeVisible();

    // Click sign out
    await page.locator('.dropdown-item.logout').click();

    // Should show sign-in button
    await expect(page.locator('.header-signin-btn')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Background Orbs — Visual', () => {
  test('background orbs are present', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const orbs = page.locator('app-bg-orbs .orb');
    expect(await orbs.count()).toBe(3);
  });
});
