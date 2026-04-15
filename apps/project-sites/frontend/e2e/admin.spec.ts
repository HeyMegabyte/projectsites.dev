import { test, expect } from './fixtures';

test.describe('Admin Dashboard', () => {
  test('redirects unauthenticated users to signin', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL('**/signin', { timeout: 5000 });
    await expect(page).toHaveURL(/\/signin/);
  });

  test('shows site grid with mock site', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.site-card-name').first()).toContainText(/Vito/i);
  });

  test('shows site count badge', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-count-badge')).toBeVisible({ timeout: 5000 });
  });

  test('shows domain summary', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.domain-summary')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.ds-active')).toContainText('1 active');
  });

  test('new site button navigates to /create', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await page.locator('.admin-btn-accent').click();
    await page.waitForURL('**/create', { timeout: 5000 });
    await expect(page).toHaveURL(/\/create/);
  });

  test('new site card navigates to /create', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.new-site-card')).toBeVisible({ timeout: 5000 });
    await page.locator('.new-site-card').click();
    await page.waitForURL('**/create', { timeout: 5000 });
  });

  test('site card shows status badge', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card-status').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.site-card-status').first()).toContainText('Live');
  });

  test('site card shows domain URL', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card-domain').first()).toBeVisible({ timeout: 5000 });
  });

  test('site card shows creation date', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card-dates').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('File Editor — Tree Navigation', () => {
  test('files modal opens with split panel layout', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // Verify split panel layout
    await expect(page.locator('.files-split')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.file-tree-panel')).toBeVisible();
    await expect(page.locator('.file-editor-panel')).toBeVisible();
  });

  test('file tree shows directory structure', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 3000 });

    // Should have directories (css, js, images)
    await expect(page.locator('.tree-dir')).toHaveCount(3, { timeout: 3000 });
    await expect(page.locator('.tree-dir-label', { hasText: 'css' })).toBeVisible();
    await expect(page.locator('.tree-dir-label', { hasText: 'js' })).toBeVisible();
    await expect(page.locator('.tree-dir-label', { hasText: 'images' })).toBeVisible();
  });

  test('file tree shows root files', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 3000 });

    // Root HTML files
    await expect(page.locator('.tree-file-name', { hasText: 'index.html' })).toBeVisible();
    await expect(page.locator('.tree-file-name', { hasText: 'privacy.html' })).toBeVisible();
    await expect(page.locator('.tree-file-name', { hasText: 'terms.html' })).toBeVisible();
  });

  test('file tree directories are expanded by default', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 3000 });

    // Children should be visible (expanded by default)
    await expect(page.locator('.tree-file-name', { hasText: 'styles.css' })).toBeVisible();
    await expect(page.locator('.tree-file-name', { hasText: 'main.js' })).toBeVisible();
  });

  test('clicking directory toggles collapse/expand', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 3000 });

    // CSS dir children should be visible
    await expect(page.locator('.tree-file-name', { hasText: 'styles.css' })).toBeVisible();

    // Click to collapse css dir
    await page.locator('.tree-dir-label', { hasText: 'css' }).click();

    // Children should be hidden
    await expect(page.locator('.tree-file-name', { hasText: 'styles.css' })).not.toBeVisible();

    // Click again to expand
    await page.locator('.tree-dir-label', { hasText: 'css' }).click();
    await expect(page.locator('.tree-file-name', { hasText: 'styles.css' })).toBeVisible();
  });

  test('shows placeholder when no file selected', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.file-editor-placeholder')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.file-editor-placeholder')).toContainText('Select a file to edit');
  });

  test('clicking editable file opens editor', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 3000 });

    // Click index.html
    await page.locator('.tree-file', { hasText: 'index.html' }).first().click();
    await expect(page.locator('.file-editor')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.file-editor-name')).toContainText('index.html');
  });

  test('editor shows file content', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 3000 });

    await page.locator('.tree-file', { hasText: 'index.html' }).first().click();
    await expect(page.locator('.file-editor')).toBeVisible({ timeout: 3000 });

    // Wait for content to load
    await page.waitForFunction(() => {
      const ta = document.querySelector('.file-editor-content') as HTMLTextAreaElement;
      return ta && ta.value && ta.value !== 'Loading...';
    }, { timeout: 5000 });

    const content = await page.locator('.file-editor-content').inputValue();
    expect(content).toContain('<!DOCTYPE html>');
  });

  test('editor has save button and keyboard hint', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 3000 });

    await page.locator('.tree-file', { hasText: 'index.html' }).first().click();
    await expect(page.locator('.file-editor')).toBeVisible({ timeout: 3000 });

    await expect(page.locator('.file-editor-name')).toBeVisible();
    await expect(page.locator('.file-editor-hint')).toContainText('Ctrl+S');
    await expect(page.locator('.file-editor-content')).toBeVisible();
    await expect(page.locator('.btn-accent', { hasText: 'Save' })).toBeVisible();
  });

  test('selected file is highlighted in tree', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 3000 });

    await page.locator('.tree-file', { hasText: 'index.html' }).first().click();
    await expect(page.locator('.file-editor')).toBeVisible({ timeout: 3000 });

    // The selected file should have the active class
    await expect(page.locator('.tree-file.active')).toBeVisible();
    await expect(page.locator('.tree-file.active')).toContainText('index.html');
  });

  test('can switch between files', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 3000 });

    // Open index.html
    await page.locator('.tree-file', { hasText: 'index.html' }).first().click();
    await expect(page.locator('.file-editor-name')).toContainText('index.html');

    // Switch to styles.css
    await page.locator('.tree-file', { hasText: 'styles.css' }).click();
    await expect(page.locator('.file-editor-name')).toContainText('styles.css');

    // Active highlight should move
    await expect(page.locator('.tree-file.active')).toContainText('styles.css');
  });

  test('file tree shows file sizes', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 3000 });

    // File sizes should be visible
    await expect(page.locator('.tree-file-size').first()).toBeVisible();
  });

  test('non-editable files are not clickable', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 3000 });

    // logo.png is not editable — clicking shouldn't open editor
    await page.locator('.tree-file', { hasText: 'logo.png' }).click();
    await expect(page.locator('.file-editor-placeholder')).toBeVisible();
  });

  test('files count badge shows correct number', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.files-count')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.files-count')).toContainText('9');
  });
});

test.describe('Logs Modal', () => {
  test('logs modal opens and shows entries', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Logs' }).first().click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.log-entry').first()).toBeVisible({ timeout: 5000 });
  });

  test('logs modal shows colored entries', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Logs' }).first().click();
    await expect(page.locator('.log-entry').first()).toBeVisible({ timeout: 5000 });

    // Should have green entries for completed actions
    await expect(page.locator('.log-c-green').first()).toBeVisible();
  });

  test('logs show human-readable action labels', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Logs' }).first().click();
    await expect(page.locator('.log-entry').first()).toBeVisible({ timeout: 5000 });

    // Check that action labels are human-readable (not raw action strings)
    await expect(page.locator('.log-action', { hasText: 'Site Created' })).toBeVisible();
    await expect(page.locator('.log-action', { hasText: 'Build Started' })).toBeVisible();
    await expect(page.locator('.log-action', { hasText: 'Build Completed' })).toBeVisible();
  });

  test('logs show metadata for build actions', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Logs' }).first().click();
    await expect(page.locator('.logs-container')).toBeVisible({ timeout: 5000 });

    // Log metadata should be shown
    await expect(page.locator('.log-meta').first()).toBeVisible({ timeout: 3000 });
  });

  test('validation errors do not show Zod references', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Logs' }).first().click();
    await expect(page.locator('.logs-container')).toBeVisible({ timeout: 5000 });

    // The validation_failed log entry should exist
    const validationEntry = page.locator('.log-action', { hasText: 'Validation Failed' });
    await expect(validationEntry).toBeVisible({ timeout: 3000 });

    // It should NOT contain the word "Zod" anywhere in the log entry
    const validationLogEntry = validationEntry.locator('..').locator('..');
    const entryText = await validationLogEntry.textContent();
    expect(entryText).not.toContain('Zod');
    expect(entryText).not.toContain('zod');

    // It should show the field names concisely
    const metaText = await validationLogEntry.locator('.log-meta').textContent();
    expect(metaText).toContain('research-social');
  });

  test('validation errors label is user-friendly', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Logs' }).first().click();
    await expect(page.locator('.logs-container')).toBeVisible({ timeout: 5000 });

    // Should say "Validation Failed" not "Schema Validation Failed"
    await expect(page.locator('.log-action', { hasText: 'Validation Failed' })).toBeVisible();
    const actions = await page.locator('.log-action').allTextContents();
    expect(actions.some(a => a.includes('Schema'))).toBe(false);
  });

  test('build started log shows business name and slug', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Logs' }).first().click();
    await expect(page.locator('.logs-container')).toBeVisible({ timeout: 5000 });

    // Find "Build Started" entry and check its metadata
    const buildStarted = page.locator('.log-entry').filter({ hasText: 'Build Started' });
    await expect(buildStarted).toBeVisible({ timeout: 3000 });
    const meta = await buildStarted.locator('.log-meta').textContent();
    expect(meta).toContain('Vito');
    expect(meta).toContain('vitos-mens-salon');
  });

  test('build completed log shows URL and score', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Logs' }).first().click();
    await expect(page.locator('.logs-container')).toBeVisible({ timeout: 5000 });

    const buildDone = page.locator('.log-entry').filter({ hasText: 'Build Completed' });
    await expect(buildDone).toBeVisible({ timeout: 3000 });
    const meta = await buildDone.locator('.log-meta').textContent();
    expect(meta).toContain('87');
    expect(meta).toContain('projectsites.dev');
  });

  test('places enriched log shows rating and reviews', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Logs' }).first().click();
    await expect(page.locator('.logs-container')).toBeVisible({ timeout: 5000 });

    const placesEntry = page.locator('.log-entry').filter({ hasText: 'Places Data Found' });
    await expect(placesEntry).toBeVisible({ timeout: 3000 });
    const meta = await placesEntry.locator('.log-meta').textContent();
    expect(meta).toContain('4.8');
    expect(meta).toContain('127 reviews');
  });

  test('logs entry count is shown', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Logs' }).first().click();
    await expect(page.locator('.logs-count')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.logs-count')).toContainText('15 log entries');
  });

  test('logs have timestamps', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Logs' }).first().click();
    await expect(page.locator('.log-entry').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.log-ts').first()).toBeVisible();
  });
});

test.describe('Domain Modal', () => {
  test('domains modal opens with tabs', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Domains' }).first().click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.modal-tab')).toHaveCount(3);
    await expect(page.locator('.hostname-item').first()).toBeVisible({ timeout: 5000 });
  });

  test('domains modal connect tab shows instructions', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-card').first().locator('.site-action-btn', { hasText: 'Domains' }).click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 5000 });

    // Switch to connect tab
    await page.locator('.modal-tab', { hasText: 'Connect Domain' }).click();
    await expect(page.locator('.cname-instructions')).toBeVisible();
    await expect(page.locator('.add-domain input')).toBeVisible();
  });

  test('domains modal register tab shows availability check', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Domains' }).first().click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    await page.locator('.modal-tab', { hasText: 'Register New' }).click();
    await expect(page.getByText('Register a new domain')).toBeVisible();
    await expect(page.getByPlaceholder('yourbusiness.com')).toBeVisible();
  });
});

test.describe('More Dropdown & Actions', () => {
  test('more dropdown shows reset, deploy, delete options', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-card').first().locator('.more-dropdown-wrap .site-action-btn').click();
    await expect(page.locator('.more-dropdown')).toBeVisible({ timeout: 2000 });
    await expect(page.locator('.dropdown-item', { hasText: 'Reset & Rebuild' })).toBeVisible();
    await expect(page.locator('.dropdown-item', { hasText: 'Deploy ZIP' })).toBeVisible();
    await expect(page.locator('.dropdown-item', { hasText: 'Delete Site' })).toBeVisible();
  });

  test('delete confirmation modal appears', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-card').first().locator('.more-dropdown-wrap .site-action-btn').click();
    await page.locator('.dropdown-item.danger').click();

    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await expect(page.getByText('Delete Site', { exact: true })).toBeVisible();
    await expect(page.locator('.btn-outline', { hasText: 'Cancel' })).toBeVisible();
  });

  test('delete cancel closes modal', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-card').first().locator('.more-dropdown-wrap .site-action-btn').click();
    await page.locator('.dropdown-item.danger').click();
    await expect(page.locator('.modal-card')).toBeVisible({ timeout: 3000 });

    await page.locator('.btn-outline', { hasText: 'Cancel' }).click();
    await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 3000 });
  });

  test('deploy modal opens with upload zone', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-card').first().locator('.more-dropdown-wrap .site-action-btn').click();
    await page.locator('.dropdown-item', { hasText: 'Deploy ZIP' }).click();

    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.deploy-zone')).toBeVisible();
    await expect(page.getByText('Click to select a ZIP file')).toBeVisible();
  });

  test('reset navigates to create page with pre-filled name', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-card').first().locator('.more-dropdown-wrap .site-action-btn').click();
    await page.locator('.dropdown-item', { hasText: 'Reset & Rebuild' }).click();

    await page.waitForURL('**/create**', { timeout: 5000 });
    await expect(page).toHaveURL(/\/create/);

    // Should show Reset & Rebuild heading and have business name pre-filled
    await expect(page.locator('h1', { hasText: 'Reset & Rebuild' })).toBeVisible({ timeout: 3000 });
    const nameInput = page.locator('#create-name');
    await expect(nameInput).toHaveValue(/Vito/i);
  });

  test('reset navigates to create page with business search', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-card').first().locator('.more-dropdown-wrap .site-action-btn').click();
    await page.locator('.dropdown-item', { hasText: 'Reset & Rebuild' }).click();

    await page.waitForURL('**/create**', { timeout: 5000 });
    await expect(page.locator('.business-group').first()).toBeVisible({ timeout: 3000 });
  });
});

test.describe('Modal Behavior', () => {
  test('modal closes on overlay click', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Logs' }).first().click();
    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });

    // Click overlay (not the modal card)
    await page.locator('.modal-overlay').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.modal-overlay')).toHaveCount(0, { timeout: 3000 });
  });

  test('modals use max-height 90vh and auto-size to content', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Domains' }).first().click();
    await expect(page.locator('.modal-card')).toBeVisible({ timeout: 3000 });

    const viewportHeight = await page.evaluate(() => window.innerHeight);

    const maxHeight = await page.locator('.modal-card').evaluate((el) => {
      return parseFloat(getComputedStyle(el).maxHeight);
    });
    // max-height should be approximately 90vh (computed to pixels)
    expect(maxHeight).toBeGreaterThan(viewportHeight * 0.85);
    expect(maxHeight).toBeLessThanOrEqual(viewportHeight * 0.95);

    const height = await page.locator('.modal-card').evaluate((el) => {
      return parseFloat(getComputedStyle(el).height);
    });
    // Modal should auto-size to content, not exceed max-height
    expect(height).toBeLessThanOrEqual(maxHeight);
    expect(height).toBeGreaterThan(100); // At least reasonably sized
  });

  test('files modal has full width', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();
    await expect(page.locator('.files-modal')).toBeVisible({ timeout: 3000 });

    const width = await page.locator('.files-modal').evaluate((el) => el.getBoundingClientRect().width);
    // Should be wide (at least 800px or 95% of viewport)
    expect(width).toBeGreaterThan(700);
  });

  test('refresh button reloads data', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.admin-btn-icon').first().click();
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Cross-Feature Integration', () => {
  test('can navigate from admin to create and back', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    // Go to create
    await page.locator('.admin-btn-accent').click();
    await page.waitForURL('**/create', { timeout: 5000 });
    await expect(page.locator('h1')).toContainText('Create Your Website');

    // Go back
    await page.goBack();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });
  });

  test('site card preview shows iframe for published site', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    // Published site should have an iframe preview
    await expect(page.locator('.site-card-preview iframe').first()).toBeVisible({ timeout: 3000 });
  });

  test('site card has visit and AI edit buttons', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await expect(page.locator('.site-action-btn', { hasText: 'Visit' }).first()).toBeVisible();
    await expect(page.locator('.site-action-btn', { hasText: 'AI Edit' }).first()).toBeVisible();
  });

  test('billing button is visible for paid users', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.admin-btn', { hasText: 'Billing' })).toBeVisible({ timeout: 5000 });
  });

  test('plan badge shows paid status', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.plan-badge').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.plan-badge').first()).toContainText('paid');
  });
});
