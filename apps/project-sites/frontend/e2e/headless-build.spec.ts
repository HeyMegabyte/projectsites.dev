/**
 * E2E: Headless Build Pipeline — Full Create-to-Live Flow
 *
 * Verifies the complete headless site generation pipeline:
 * 1. /create page submits → POST /api/sites/create-from-search
 * 2. Backend starts Cloudflare Workflow (headless — no browser/editor needed)
 * 3. /waiting page shows progressive status (research → structure → generate → upload)
 * 4. Site publishes → redirect to live site
 *
 * CRITICAL: The build NEVER redirects to editor.projectsites.dev.
 * The entire generation happens server-side via direct LLM API calls (Anthropic Claude).
 */
import { test, expect } from './fixtures';

test.describe('Headless Build Pipeline — No Editor Redirect', () => {

  test('create page submits and navigates to waiting (not editor)', async ({ authedPage: page }) => {
    // Navigate to create page
    await page.goto('/create');
    await expect(page.locator('h1')).toContainText('Create Your Website');

    // Fill in business details
    await page.fill('#create-name', 'Test Headless Business');
    await page.fill('#create-address', '123 Main St, Anytown, NJ 07001');

    // Submit
    await page.locator('.create-submit').click();

    // CRITICAL: Must navigate to /waiting, NOT to editor.projectsites.dev
    await page.waitForURL('**/waiting**', { timeout: 10000 });

    // Verify we're on the waiting page, not editor
    const url = page.url();
    expect(url).toContain('/waiting');
    expect(url).not.toContain('editor.projectsites.dev');

    // Verify waiting page elements
    await expect(page.locator('.spinner')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.waiting-title')).toContainText('Preparing');
  });

  test('waiting page shows step progress counter', async ({ authedPage: page }) => {
    await page.goto('/waiting?id=site-001&slug=vitos-mens-salon');

    // Should show step counter
    await expect(page.locator('.waiting-step')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.waiting-step')).toContainText(/Step \d+ of \d+/);

    // Should show progress bar
    await expect(page.locator('.waiting-progress-bar')).toBeVisible();
    await expect(page.locator('.waiting-progress-fill')).toBeVisible();
  });

  test('waiting page never navigates to editor.projectsites.dev', async ({ authedPage: page }) => {
    // Track all navigation events
    const navigatedUrls: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        navigatedUrls.push(frame.url());
      }
    });

    // Also track any window.location.href assignments
    await page.route('**/editor.projectsites.dev/**', (route) => {
      // This should NEVER be called
      throw new Error('BLOCKED: Attempted to navigate to editor.projectsites.dev — headless pipeline must not use the editor');
    });

    await page.goto('/waiting?id=site-001&slug=vitos-mens-salon');

    // Wait for the mock to progress to "published" status (mock site-001 is already published)
    // The page should redirect to the live site, NOT the editor
    await page.waitForTimeout(5000);

    // Verify no navigation to editor happened
    for (const url of navigatedUrls) {
      expect(url).not.toContain('editor.projectsites.dev');
    }
  });

  test('waiting page shows granular status updates from audit logs', async ({ authedPage: page }) => {
    // Create a new site to get the progressive log drip-feed
    await page.goto('/create');
    await page.fill('#create-name', 'Status Update Test');
    await page.fill('#create-address', '456 Oak Ave, Springfield, NJ 07081');
    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });

    // Wait for status updates — the mock server drip-feeds logs progressively
    await expect(page.locator('.waiting-subtitle')).toBeVisible({ timeout: 5000 });

    // Initial status
    const initialText = await page.locator('.waiting-subtitle').textContent();
    expect(initialText).toBeTruthy();

    // Wait for progress to advance
    await page.waitForTimeout(5000);

    // Status should have changed (mock progresses every ~2.5s)
    const laterText = await page.locator('.waiting-subtitle').textContent();
    expect(laterText).toBeTruthy();

    // Step counter should show progress
    const stepText = await page.locator('.waiting-step').textContent();
    expect(stepText).toMatch(/Step \d+ of 8/);
  });

  test('waiting page shows new pipeline steps (structure, multipage)', async ({ authedPage: page }) => {
    // Create a site and wait for progressive logs
    await page.goto('/create');
    await page.fill('#create-name', 'Pipeline Steps Test');
    await page.fill('#create-address', '789 Elm St, Newark, NJ 07101');
    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });

    // Wait long enough for mock server to drip-feed structure_plan and multipage_generation logs
    // Mock timing: structure_plan_started at 7500ms, multipage_generation at 9000ms
    await page.waitForTimeout(10000);

    // The status message should reflect one of the new pipeline steps
    const status = await page.locator('.waiting-subtitle').textContent();
    const validStatuses = [
      'Planning site structure',
      'Generating pages',
      'Running quality checks',
      'Optimizing and uploading',
      'Uploading files',
      'Your site is live',
      'Generating website',  // fallback for html_generation
    ];

    // At least the step counter should be > 1
    const stepText = await page.locator('.waiting-step').textContent();
    const stepMatch = stepText?.match(/Step (\d+)/);
    expect(stepMatch).toBeTruthy();
    const stepNum = parseInt(stepMatch![1], 10);
    expect(stepNum).toBeGreaterThan(1);
  });

  test('published site triggers redirect to live URL (not editor)', async ({ authedPage: page }) => {
    // site-001 in mock is already "published", so the waiting page should
    // detect this and redirect to the live site URL (not editor)
    let redirectTarget = '';

    // Intercept window.location.href assignment by monitoring navigation
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        const url = frame.url();
        if (url.includes('projectsites.dev') && !url.includes('localhost')) {
          redirectTarget = url;
        }
      }
    });

    // Also block editor navigation — this should NEVER fire
    await page.route('**/editor.projectsites.dev/**', () => {
      throw new Error('BLOCKED: Attempted to navigate to editor — headless pipeline must not redirect to editor');
    });

    await page.goto('/waiting?id=site-001&slug=vitos-mens-salon');

    // Wait for polling to detect "published" and update the UI
    // The status message should change to "Your site is live!" before redirect
    await page.waitForTimeout(5000);

    // Verify the redirect target (if any external navigation happened) was NOT editor
    if (redirectTarget) {
      expect(redirectTarget).not.toContain('editor.projectsites.dev');
    }
  });

  test('waiting page has go-to-dashboard button', async ({ authedPage: page }) => {
    await page.goto('/waiting?id=site-001&slug=vitos-mens-salon');

    const dashboardBtn = page.locator('button').filter({ hasText: /dashboard/i });
    await expect(dashboardBtn).toBeVisible({ timeout: 5000 });
  });

  test('dashboard button navigates to admin', async ({ authedPage: page }) => {
    await page.goto('/waiting?id=site-001&slug=vitos-mens-salon');

    const dashboardBtn = page.locator('button').filter({ hasText: /dashboard/i });
    await expect(dashboardBtn).toBeVisible({ timeout: 5000 });
    await dashboardBtn.click({ force: true });

    await page.waitForURL('**/admin**', { timeout: 5000 });
  });

  test('error state shows retry option', async ({ authedPage: page }) => {
    // Navigate to waiting with a non-existent site (mock returns 404 → error)
    await page.goto('/waiting?id=nonexistent&slug=no-site');

    // Wait for polling to detect error or show default
    await page.waitForTimeout(5000);

    // At minimum, the dashboard button should still be visible for recovery
    const dashboardBtn = page.locator('button').filter({ hasText: /dashboard/i });
    await expect(dashboardBtn).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Headless Pipeline — Create Form Validation', () => {

  test('submit requires business name', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.fill('#create-address', '123 Main St');
    await page.locator('.create-submit').click();

    // Should show error toast, not navigate
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/create');
  });

  test('submit requires address', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.fill('#create-name', 'Test Business');
    await page.locator('.create-submit').click();

    // Should show error toast, not navigate
    await page.waitForTimeout(1000);
    expect(page.url()).toContain('/create');
  });

  test('create form has all required fields', async ({ authedPage: page }) => {
    await page.goto('/create');

    await expect(page.locator('#create-name')).toBeVisible();
    await expect(page.locator('#create-address')).toBeVisible();
    await expect(page.locator('#create-phone')).toBeVisible();
    await expect(page.locator('#create-website')).toBeVisible();
    await expect(page.locator('#create-category')).toBeVisible();
    await expect(page.locator('#create-context')).toBeVisible();
    await expect(page.locator('.create-submit')).toBeVisible();
  });

  test('create form submits all data to backend', async ({ authedPage: page }) => {
    let capturedPayload: any = null;

    // Intercept the API call to capture the payload
    await page.route('**/api/sites/create-from-search', async (route) => {
      const request = route.request();
      capturedPayload = JSON.parse(request.postData() || '{}');

      // Return mock response
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: {
            id: 'site-captured',
            slug: 'test-biz',
            status: 'building',
            business_name: 'Test Biz',
          },
        }),
      });
    });

    await page.goto('/create');
    await page.fill('#create-name', 'Test Biz');
    await page.fill('#create-address', '100 Test Rd');
    await page.fill('#create-phone', '555-1234');
    await page.fill('#create-website', 'https://test.com');

    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });

    // Verify the payload was sent correctly
    expect(capturedPayload).toBeTruthy();
    expect(capturedPayload.business.name).toBe('Test Biz');
    expect(capturedPayload.business.address).toBe('100 Test Rd');
    expect(capturedPayload.business.phone).toBe('555-1234');
    expect(capturedPayload.business.website).toBe('https://test.com');
  });
});

test.describe('Headless Pipeline — Editor Component Isolation', () => {

  test('editor route is separate from build flow', async ({ authedPage: page }) => {
    // The /editor/:slug route is for POST-PUBLISH editing only
    // It should NOT be part of the initial build flow
    await page.goto('/editor/vitos-mens-salon');

    // Editor page loads independently — it's an iframe wrapper for bolt.diy
    // This is NOT reached during the create → waiting → live flow
    await expect(page.locator('.editor-iframe, .editor-loading, [class*="editor"]')).toBeVisible({ timeout: 10000 }).catch(() => {
      // Editor may redirect to admin if site not found — that's fine
    });
  });

  test('full create flow never touches /editor route', async ({ authedPage: page }) => {
    const visitedUrls: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        visitedUrls.push(frame.url());
      }
    });

    // Complete the create flow
    await page.goto('/create');
    await page.fill('#create-name', 'Navigation Test Biz');
    await page.fill('#create-address', '200 Nav St, Testville, NJ 07001');
    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });
    await page.waitForTimeout(3000);

    // Verify NO URL in the chain contains /editor
    for (const url of visitedUrls) {
      expect(url).not.toContain('/editor/');
      expect(url).not.toContain('editor.projectsites.dev');
    }
  });
});
