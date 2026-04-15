import { test, expect } from './fixtures';

test.describe('Bolt Editor — Route-based Editor Page', () => {
  test('AI Edit button navigates to /editor/:slug', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Find the AI Edit button on the site card (only visible when status=published)
    const aiEditBtn = page.locator('button:has-text("AI Edit")').first();
    await expect(aiEditBtn).toBeVisible();
    await aiEditBtn.click({ force: true });

    // Should navigate to /editor/vitos-mens-salon
    await page.waitForURL('**/editor/vitos-mens-salon');
    expect(page.url()).toContain('/editor/vitos-mens-salon');
  });

  test('editor page shows header with site name', async ({ authedPage: page }) => {
    await page.goto('/editor/vitos-mens-salon');
    await page.waitForLoadState('networkidle');

    const title = page.locator('.editor-title');
    await expect(title).toContainText("Vito's Mens Salon");
  });

  test('editor page has bolt.diy iframe with embedded=true', async ({ authedPage: page }) => {
    await page.goto('/editor/vitos-mens-salon');
    await page.waitForLoadState('networkidle');

    const iframe = page.locator('.editor-iframe');
    await expect(iframe).toBeVisible();

    const src = await iframe.getAttribute('src');
    expect(src).toContain('embedded=true');
    expect(src).toContain('editor.projectsites.dev');
    expect(src).toContain('slug=vitos-mens-salon');
  });

  test('editor page iframe passes importChatFrom URL for session restore', async ({ authedPage: page }) => {
    await page.goto('/editor/vitos-mens-salon');
    await page.waitForLoadState('networkidle');

    const iframe = page.locator('.editor-iframe');
    const src = await iframe.getAttribute('src');
    expect(src).toContain('importChatFrom=');
    // URL is encoded in the query param
    expect(src).toContain(encodeURIComponent('/api/sites/by-slug/vitos-mens-salon/chat'));
  });

  test('editor page has Save & Deploy button', async ({ authedPage: page }) => {
    await page.goto('/editor/vitos-mens-salon');
    await page.waitForLoadState('networkidle');

    const saveBtn = page.locator('button:has-text("Save")');
    await expect(saveBtn).toBeVisible();
    // Should be disabled initially (bolt not ready yet)
    await expect(saveBtn).toBeDisabled();
  });

  test('editor page has Open Full Editor button', async ({ authedPage: page }) => {
    await page.goto('/editor/vitos-mens-salon');
    await page.waitForLoadState('networkidle');

    const fullEditorBtn = page.locator('text=Open Full Editor');
    await expect(fullEditorBtn).toBeVisible();
  });

  test('editor page has back button that navigates to admin', async ({ authedPage: page }) => {
    await page.goto('/editor/vitos-mens-salon');
    await page.waitForLoadState('networkidle');

    const backBtn = page.locator('.editor-back-btn');
    await expect(backBtn).toBeVisible();
    await backBtn.click({ force: true });

    await page.waitForURL('**/admin');
    expect(page.url()).toContain('/admin');
  });

  test('editor page shows loading spinner initially', async ({ authedPage: page }) => {
    await page.goto('/editor/vitos-mens-salon');
    await page.waitForLoadState('networkidle');

    const loading = page.locator('.editor-loading');
    await expect(loading).toBeAttached();
    await expect(loading).toContainText('Loading AI Editor');
  });

  test('editor page covers full viewport', async ({ authedPage: page }) => {
    await page.goto('/editor/vitos-mens-salon');
    await page.waitForLoadState('networkidle');

    const editorPage = page.locator('.editor-page');
    const box = await editorPage.boundingBox();
    expect(box).toBeTruthy();
    if (box) {
      const viewport = page.viewportSize();
      expect(box.width).toBeGreaterThanOrEqual((viewport?.width || 1280) * 0.95);
      expect(box.height).toBeGreaterThanOrEqual((viewport?.height || 720) * 0.95);
    }
  });

  test('editor redirects to admin if slug not found', async ({ authedPage: page }) => {
    await page.goto('/editor/nonexistent-slug');
    await page.waitForLoadState('networkidle');

    // Should navigate back to admin since site is not found
    await page.waitForURL('**/admin', { timeout: 5000 });
    expect(page.url()).toContain('/admin');
  });

  test('editor redirects to signin if not logged in', async ({ page }) => {
    await page.goto('/editor/vitos-mens-salon');
    await page.waitForLoadState('networkidle');

    // Should redirect to signin
    await page.waitForURL('**/signin', { timeout: 5000 });
    expect(page.url()).toContain('/signin');
  });
});

test.describe('Bolt Editor — API Endpoints', () => {
  test('generate-prompt API returns prompt and research data', async ({ authedPage: page }) => {
    const response = await page.evaluate(async () => {
      const token = JSON.parse(localStorage.getItem('ps_session') || '{}').token;
      const res = await fetch('/api/sites/generate-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          business_name: "Vito's Mens Salon",
          business_address: '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034',
        }),
      });
      return res.json();
    });

    expect(response.data).toBeDefined();
    expect(response.data.prompt).toBeDefined();
    expect(typeof response.data.prompt).toBe('string');
    expect(response.data.prompt.length).toBeGreaterThan(0);
    expect(response.data.research).toBeDefined();
  });

  test('files-export API returns files map', async ({ authedPage: page }) => {
    const response = await page.evaluate(async () => {
      const token = JSON.parse(localStorage.getItem('ps_session') || '{}').token;
      const res = await fetch('/api/sites/site-001/files-export', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return res.json();
    });

    expect(response.data).toBeDefined();
    expect(response.data.files).toBeDefined();
    expect(typeof response.data.files).toBe('object');
    expect(Object.keys(response.data.files).length).toBeGreaterThan(0);
  });

  test('publish-bolt API accepts files and chat', async ({ authedPage: page }) => {
    const response = await page.evaluate(async () => {
      const token = JSON.parse(localStorage.getItem('ps_session') || '{}').token;
      const res = await fetch('/api/sites/site-001/publish-bolt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          slug: 'vitos-mens-salon',
          files: [
            { path: 'index.html', content: '<html><body>Hello</body></html>' },
            { path: 'styles.css', content: 'body { margin: 0; }' },
          ],
          chat: {
            messages: [{ id: '1', role: 'user', content: 'Build a site' }],
            description: 'Test chat',
            exportDate: new Date().toISOString(),
          },
        }),
      });
      return res.json();
    });

    expect(response.data).toBeDefined();
    expect(response.data.slug).toBe('vitos-mens-salon');
    expect(response.data.version).toBeDefined();
    expect(response.data.url).toContain('projectsites.dev');
  });

  test('chat export by slug returns chat data', async ({ authedPage: page }) => {
    const response = await page.evaluate(async () => {
      const res = await fetch('/api/sites/by-slug/vitos-mens-salon/chat');
      return res.json();
    });

    expect(response.messages).toBeDefined();
    expect(Array.isArray(response.messages)).toBe(true);
    expect(response.messages.length).toBeGreaterThan(0);
    expect(response.description).toBeDefined();
  });
});

test.describe('Files Modal Height', () => {
  test('files modal uses 90vh height', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Open files modal
    const filesBtn = page.locator('button:has-text("Files")').first();
    await expect(filesBtn).toBeVisible();
    await filesBtn.click({ force: true });

    const filesModal = page.locator('.files-modal');
    await expect(filesModal).toBeVisible({ timeout: 5000 });

    // Check height is approximately 90vh
    const height = await filesModal.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return parseInt(computed.height);
    });
    const viewportHeight = page.viewportSize()?.height || 720;
    const expectedMinHeight = viewportHeight * 0.85; // Allow some margin
    expect(height).toBeGreaterThanOrEqual(expectedMinHeight);
  });
});
