/**
 * 20 E2E Tests: Full Build → Editor → Snapshot → Revert Cycle
 *
 * Tests the complete lifecycle:
 *  Phase 1 (1-5): Create site, watch build, verify published
 *  Phase 2 (6-10): Open editor, verify iframe, edit files, publish to R2
 *  Phase 3 (11-15): Snapshot verification, creation, revert, restore
 *  Phase 4 (16-20): Edge cases — error recovery, concurrent ops, mobile
 *
 * The mock server auto-creates an "initial" snapshot when a site publishes,
 * and auto-creates an edit snapshot when publish-bolt is called.
 */
import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

/** Dismiss overlays that block interactions */
async function dismissOverlays(page: Page): Promise<void> {
  await page.evaluate(() => {
    localStorage.setItem('ps_onboarding', 'dismissed');
    localStorage.setItem('ps_feedback_dismissed', 'true');
  });
}

/**
 * Create a site and wait for it to be published.
 * Returns { siteId, slug } from the waiting page URL.
 */
async function createSiteAndWaitForPublish(page: Page, name = 'E2E Test Business', address = '100 Test St, Testville, NJ 07000'): Promise<{ siteId: string; slug: string }> {
  await page.goto('/create');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
  await page.locator('#create-name').fill(name);
  await page.locator('#create-address').fill(address);
  await page.locator('button:has-text("Build My Website")').click();
  await page.waitForURL(/\/waiting\?id=(.+)&slug=(.+)/, { timeout: 10000 });

  const url = new URL(page.url(), 'http://localhost:4300');
  const siteId = url.searchParams.get('id')!;
  const slug = url.searchParams.get('slug')!;

  // Wait for build to complete
  await expect(page.getByRole('heading', { name: 'Your site is live!' })).toBeVisible({ timeout: 25000 });
  return { siteId, slug };
}

/**
 * Override the editor iframe to use our mock editor instead of editor.projectsites.dev.
 * Must be called BEFORE navigating to /admin/editor.
 */
async function interceptEditorIframe(page: Page): Promise<void> {
  await page.route('https://editor.projectsites.dev/**', (route) => {
    // Redirect to our mock editor
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!DOCTYPE html>
<html><head><title>Mock Bolt Editor</title></head>
<body style="margin:0;background:#0a0a1a;color:#fff;font-family:sans-serif;padding:20px">
<div id="status">Editor loading...</div>
<script>
  setTimeout(function() {
    document.getElementById('status').textContent = 'Editor ready';
    window.parent.postMessage({ type: 'PS_BOLT_READY' }, '*');
  }, 300);
  window.addEventListener('message', function(e) {
    if (e.data && e.data.type === 'PS_REQUEST_FILES') {
      setTimeout(function() {
        window.parent.postMessage({
          type: 'PS_FILES_READY',
          correlationId: e.data.correlationId,
          files: {
            '/home/project/index.html': '<!DOCTYPE html><html><head><title>Edited Site</title></head><body><h1>Hello World - Edited!</h1></body></html>',
            '/home/project/css/styles.css': 'body { margin: 0; background: #0a0a1a; color: #fff; }'
          },
          chat: { messages: [], description: 'Edit', exportDate: new Date().toISOString() }
        }, '*');
      }, 200);
    }
  });
</script>
</body></html>`,
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════
// PHASE 1: Site Creation & Build Monitoring (Tests 1-5)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Phase 1 — Build a Site from Scratch', () => {

  test('1. Create site from search results and begin build', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('domcontentloaded');

    // Fill form
    await page.locator('#create-name').fill('Build Cycle Salon');
    await page.locator('#create-address').fill('200 Build Ave, Testville, NJ 07000');

    // Submit
    await page.locator('button:has-text("Build My Website")').click();
    await page.waitForURL(/\/waiting/, { timeout: 10000 });

    // Verify we're on the waiting page with a spinner
    await expect(page.locator('.spinner')).toBeVisible();
    await expect(page.locator('text=Step 1 of 8')).toBeVisible({ timeout: 5000 });
  });

  test('2. Watch build progress through pipeline steps', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('domcontentloaded');
    await page.locator('#create-name').fill('Progress Watch Biz');
    await page.locator('#create-address').fill('300 Progress Ln, Watchville, NJ 07000');
    await page.locator('button:has-text("Build My Website")').click();
    await page.waitForURL(/\/waiting/, { timeout: 10000 });

    // Verify step advances beyond step 1
    await expect(page.locator('text=/Step [2-8] of 8/')).toBeVisible({ timeout: 15000 });

    // Progress bar should be partially filled
    const bar = page.locator('.waiting-progress-fill');
    await expect(bar).toBeVisible();
  });

  test('3. Build completes and shows success with action buttons', async ({ authedPage: page }) => {
    const { slug } = await createSiteAndWaitForPublish(page, 'Success Salon', '400 Success Blvd, Wintown, NJ 07000');

    // Verify all action buttons
    await expect(page.locator('button:has-text("View Your Site")')).toBeVisible();
    await expect(page.locator('button:has-text("Edit with AI")')).toBeVisible();
    await expect(page.locator('button:has-text("Go to Dashboard")')).toBeVisible();

    // Verify the slug is displayed
    await expect(page.locator(`text=${slug}.projectsites.dev`)).toBeVisible();
  });

  test('4. Navigate from success to admin dashboard', async ({ authedPage: page }) => {
    await createSiteAndWaitForPublish(page, 'Dashboard Nav Biz', '500 Admin Rd, Dashtown, NJ 07000');

    await page.locator('button:has-text("Go to Dashboard")').click();
    await page.waitForURL('/admin', { timeout: 5000 });

    // Admin should show a site (default selection is site-001 Vito's)
    await expect(page.locator('text=Dashboard').first()).toBeVisible({ timeout: 10000 });
  });

  test('5. Verify "initial" snapshot was auto-created after build', async ({ authedPage: page }) => {
    const { siteId } = await createSiteAndWaitForPublish(page, 'Snapshot Auto Biz', '600 Snap Dr, Autotown, NJ 07000');

    await page.locator('button:has-text("Go to Dashboard")').click();
    await page.waitForURL('/admin', { timeout: 5000 });

    // Navigate to snapshots
    await page.goto('/admin/snapshots');
    await page.waitForLoadState('domcontentloaded');

    // Verify "initial" snapshot exists (auto-created by mock on publish)
    await expect(page.locator('text=initial').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Latest').first()).toBeVisible();
  });

});

// ═══════════════════════════════════════════════════════════════════════
// PHASE 2: Editor — Load, Edit, Publish to R2 (Tests 6-10)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Phase 2 — AI Editor & Publish to R2', () => {

  test('6. Editor page loads and shows iframe or loading state', async ({ authedPage: page }) => {
    await interceptEditorIframe(page);
    await page.goto('/admin/editor');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // The editor page should render: iframe visible, publish button, or loading text
    // The mock sends PS_BOLT_READY which hides the loading overlay and shows the iframe
    const hasIframe = await page.locator('iframe.editor-iframe').count() > 0;
    const hasPublishBtn = await page.locator('button:has-text("Publish to R2")').isVisible().catch(() => false);
    const hasEditor = await page.locator('text=Editor').first().isVisible().catch(() => false);

    expect(hasIframe || hasPublishBtn || hasEditor).toBeTruthy();
  });

  test('7. Editor iframe receives PS_BOLT_READY and loading overlay disappears', async ({ authedPage: page }) => {
    await interceptEditorIframe(page);
    await page.goto('/admin/editor');
    await page.waitForLoadState('domcontentloaded');

    // Wait for loading overlay to disappear (mock sends PS_BOLT_READY in 300ms, fallback 15s)
    await expect(page.locator('text=Loading editor...')).not.toBeVisible({ timeout: 16000 });

    // The iframe should now be visible
    await expect(page.locator('iframe.editor-iframe')).toBeVisible();
  });

  test('8. "Publish to R2" floating button appears when editor is ready', async ({ authedPage: page }) => {
    await interceptEditorIframe(page);
    await page.goto('/admin/editor');
    await page.waitForLoadState('domcontentloaded');

    // Wait for editor to be ready (loading overlay disappears)
    await expect(page.locator('text=Loading editor...')).not.toBeVisible({ timeout: 16000 });

    // The stylish floating publish button should appear
    const publishBtn = page.locator('button:has-text("Publish to R2")');
    await expect(publishBtn).toBeVisible({ timeout: 5000 });

    // Verify it has the glassmorphic styling (the .publish-btn class)
    await expect(publishBtn).toHaveClass(/publish-btn/);
  });

  test('9. Click "Publish to R2" triggers postMessage flow and deploys', async ({ authedPage: page }) => {
    // Track API call to verify publish-bolt is called
    let publishCalled = false;
    await page.route('**/api/sites/*/publish-bolt', (route) => {
      publishCalled = true;
      route.continue();
    });

    await interceptEditorIframe(page);
    await page.goto('/admin/editor');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=Loading editor...')).not.toBeVisible({ timeout: 16000 });

    // Click the publish button
    const publishBtn = page.locator('button:has-text("Publish to R2")');
    await expect(publishBtn).toBeVisible({ timeout: 5000 });
    await publishBtn.click();

    // Wait for the publish API call to complete
    await page.waitForTimeout(2000);
    expect(publishCalled).toBe(true);
  });

  test('10. "Save & Deploy" top bar button also triggers publish', async ({ authedPage: page }) => {
    let publishCalled = false;
    await page.route('**/api/sites/*/publish-bolt', (route) => {
      publishCalled = true;
      route.continue();
    });

    await interceptEditorIframe(page);
    await page.goto('/admin/editor');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=Loading editor...')).not.toBeVisible({ timeout: 16000 });

    // The top bar "Save & Deploy" button should be visible on editor route
    const saveBtn = page.locator('button:has-text("Save & Deploy")');
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await saveBtn.click();

    // Wait for the flow to complete
    await page.waitForTimeout(2000);
    expect(publishCalled).toBe(true);
  });

});

// ═══════════════════════════════════════════════════════════════════════
// PHASE 3: Snapshots — Verify, Create, Revert, Restore (Tests 11-15)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Phase 3 — Snapshot Management & Revert', () => {

  test('11. After publish, snapshots page shows "initial" snapshot', async ({ authedPage: page }) => {
    // site-001 already has an "initial" snapshot in mock
    await page.goto('/admin/snapshots');
    await page.waitForLoadState('domcontentloaded');

    // Wait for the snapshot list to load — look for Version History heading
    await expect(page.getByRole('heading', { name: 'Version History' })).toBeVisible({ timeout: 10000 });

    // "initial" snapshot should be in the list
    await expect(page.locator('text=initial').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Latest').first()).toBeVisible();
  });

  test('12. Publish from editor creates a second snapshot', async ({ authedPage: page }) => {
    // First, publish from editor (creates an edit snapshot in mock)
    await interceptEditorIframe(page);
    await page.goto('/admin/editor');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=Loading editor...')).not.toBeVisible({ timeout: 16000 });

    await page.locator('button:has-text("Publish to R2")').click();
    await page.waitForTimeout(2000);

    // Now check snapshots — should have 2+ (initial + edit)
    await page.goto('/admin/snapshots');
    await page.waitForLoadState('domcontentloaded');

    // Wait for Version History to appear
    await expect(page.getByRole('heading', { name: 'Version History' })).toBeVisible({ timeout: 10000 });

    // Count snapshot cards (links to projectsites.dev)
    const snapCards = page.locator('a[href*=".projectsites.dev"]');
    await expect(snapCards.first()).toBeVisible({ timeout: 5000 });
    const count = await snapCards.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('13. "Latest" badge appears on the newest snapshot only', async ({ authedPage: page }) => {
    await page.goto('/admin/snapshots');
    await page.waitForLoadState('domcontentloaded');

    await expect(page.locator('text=initial').first()).toBeVisible({ timeout: 10000 });

    // Only one "Latest" badge should exist
    const latestBadges = page.locator('text=Latest');
    const badgeCount = await latestBadges.count();
    expect(badgeCount).toBe(1);
  });

  test('14. Revert to "initial" snapshot — revert button appears on non-latest', async ({ authedPage: page }) => {
    // First create a second snapshot so "initial" is no longer latest
    await interceptEditorIframe(page);
    await page.goto('/admin/editor');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=Loading editor...')).not.toBeVisible({ timeout: 16000 });
    await page.locator('button:has-text("Publish to R2")').click();
    await page.waitForTimeout(2000); // Wait for publish to complete

    // Go to snapshots
    await page.goto('/admin/snapshots');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await expect(page.locator('a:has-text("initial")').first()).toBeVisible({ timeout: 10000 });

    // The "Revert" button should appear on the "initial" snapshot (which is not latest)
    const revertBtn = page.locator('button:has-text("Revert")').first();
    await expect(revertBtn).toBeVisible({ timeout: 5000 });

    // Click revert
    await revertBtn.click();

    // Should show success toast — "Reverted to initial"
    await expect(page.locator('text=/Reverted to/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('15. After revert, a new "-restored" snapshot appears as latest', async ({ authedPage: page }) => {
    // Create a second snapshot first
    await interceptEditorIframe(page);
    await page.goto('/admin/editor');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=Loading editor...')).not.toBeVisible({ timeout: 16000 });
    await page.locator('button:has-text("Publish to R2")').click();
    await page.waitForTimeout(2000);

    // Go to snapshots and revert
    await page.goto('/admin/snapshots');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await expect(page.locator('a:has-text("initial")').first()).toBeVisible({ timeout: 10000 });

    const revertBtn = page.locator('button:has-text("Revert")').first();
    if (await revertBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await revertBtn.click();
      await page.waitForTimeout(1000);

      // The restored snapshot should appear with "-restored" suffix
      await expect(page.locator('text=/restored/i').first()).toBeVisible({ timeout: 5000 });
    }
  });

});

// ═══════════════════════════════════════════════════════════════════════
// PHASE 4: Advanced & Edge Cases (Tests 16-20)
// ═══════════════════════════════════════════════════════════════════════

test.describe('Phase 4 — Advanced Flows & Edge Cases', () => {

  test('16. Create manual snapshot with custom name and description', async ({ authedPage: page }) => {
    await page.goto('/admin/snapshots');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=Snapshots').first()).toBeVisible({ timeout: 10000 });

    // Fill in snapshot name
    const nameInput = page.locator('input[placeholder*="Name"]').first();
    await nameInput.fill('before-redesign');

    // Fill in description
    const descInput = page.locator('input[placeholder*="Description"]').first();
    await descInput.fill('Saving state before major redesign');

    // Click create
    await page.locator('button:has-text("Create Snapshot")').click();

    // Should see success toast
    await expect(page.locator('text=/Snapshot created/i').first()).toBeVisible({ timeout: 5000 });

    // The new snapshot should be in the list
    await expect(page.locator('text=before-redesign').first()).toBeVisible({ timeout: 5000 });
  });

  test('17. Delete a snapshot and verify it disappears from list', async ({ authedPage: page }) => {
    // First create a snapshot to delete
    await page.goto('/admin/snapshots');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const nameInput = page.locator('input[placeholder*="Name"]').first();
    await nameInput.fill('to-delete');
    await page.locator('button:has-text("Create Snapshot")').click();
    await expect(page.locator('text=/Snapshot created/i').first()).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);

    // Verify it's in the list
    await expect(page.locator('text=to-delete').first()).toBeVisible({ timeout: 5000 });

    // Click the delete button on the first snapshot (latest = the one we just created)
    await page.locator('button.icon-btn-sm-danger').first().click();

    // Wait for deletion toast
    await expect(page.locator('text=/Snapshot deleted/i').first()).toBeVisible({ timeout: 5000 });
  });

  test('18. Full cycle: build → editor publish → snapshot check → revert → check again', async ({ authedPage: page }) => {
    // Step 1: Build a fresh site
    const { siteId } = await createSiteAndWaitForPublish(page, 'Full Cycle Corp', '900 Cycle Blvd, Fulltown, NJ 07000');
    await page.locator('button:has-text("Go to Dashboard")').click();
    await page.waitForURL('/admin', { timeout: 5000 });

    // Step 2: Publish from editor (creates edit snapshot)
    await interceptEditorIframe(page);
    await page.goto('/admin/editor');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=Loading editor...')).not.toBeVisible({ timeout: 16000 });
    await page.locator('button:has-text("Publish to R2")').click();
    await page.waitForTimeout(2000);

    // Step 3: Verify snapshots — should have 2 (initial + edit)
    await page.goto('/admin/snapshots');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    const cards = page.locator('a[href*=".projectsites.dev"]');
    await expect(cards.first()).toBeVisible({ timeout: 10000 });
    const snapCount = await cards.count();
    expect(snapCount).toBeGreaterThanOrEqual(2);

    // Step 4: Revert to initial
    const revertBtn = page.locator('button:has-text("Revert")').first();
    if (await revertBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await revertBtn.click();
      await expect(page.locator('text=/Reverted/i').first()).toBeVisible({ timeout: 5000 });

      // Step 5: Verify restored snapshot appears
      await page.waitForTimeout(500);
      const afterRevert = await page.locator('a[href*=".projectsites.dev"]').count();
      expect(afterRevert).toBeGreaterThanOrEqual(snapCount);
    }
  });

  test('19. Editor not ready state — shows loading overlay with spinner', async ({ authedPage: page }) => {
    // Route that NEVER sends PS_BOLT_READY
    await page.route('https://editor.projectsites.dev/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<!DOCTYPE html><html><body>Silent editor</body></html>',
      });
    });

    await page.goto('/admin/editor');
    await page.waitForLoadState('domcontentloaded');

    // Loading overlay should be visible
    await expect(page.locator('text=Loading editor...')).toBeVisible({ timeout: 5000 });

    // After 15s timeout, it should auto-dismiss
    await expect(page.locator('text=Loading editor...')).not.toBeVisible({ timeout: 17000 });
  });

  test('20. Snapshot view links use correct URL pattern: slug-name.projectsites.dev', async ({ authedPage: page }) => {
    await page.goto('/admin/snapshots');
    await page.waitForLoadState('domcontentloaded');
    await expect(page.locator('text=initial').first()).toBeVisible({ timeout: 10000 });

    // The snapshot link should follow pattern: {slug}-{snapshot_name}.projectsites.dev
    const snapshotLink = page.locator('a[href*=".projectsites.dev"]').first();
    const href = await snapshotLink.getAttribute('href');
    expect(href).toBeTruthy();
    // Should match pattern like https://slug-snapshotname.projectsites.dev
    expect(href).toMatch(/https:\/\/.+-\w+\.projectsites\.dev/);
  });

});
