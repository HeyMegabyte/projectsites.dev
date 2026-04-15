import { test, expect } from './fixtures';

test.describe('Create Website Workflow', () => {
  test('homepage loads and shows search', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('Handled');
    await expect(page.locator('.search-input')).toBeVisible();
  });

  test('create page loads at /create', async ({ page }) => {
    await page.goto('/create');
    await expect(page.locator('h1')).toContainText('Create Your Website');
    await expect(page.locator('#create-name')).toBeVisible();
    await expect(page.locator('#create-address')).toBeVisible();
  });

  test('create page pre-fills from query params', async ({ page }) => {
    await page.goto('/create?name=Test%20Biz&address=123%20Main%20St');
    await expect(page.locator('#create-name')).toHaveValue('Test Biz');
    await expect(page.locator('#create-address')).toHaveValue('123 Main St');
  });

  test('create page pre-fills phone and website from query params', async ({ page }) => {
    await page.goto('/create?name=Test&address=123&phone=(555)%20123-4567&website=https://example.com');
    await expect(page.locator('#create-phone')).toHaveValue('(555) 123-4567');
    await expect(page.locator('#create-website')).toHaveValue('https://example.com');
  });

  test('create page shows validation errors when submitting empty', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');
    await page.locator('.create-submit').click();
    await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
  });

  test('create page redirects unauthenticated users to signin', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', "Vito's Mens Salon");
    await page.fill('#create-address', '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034');

    await page.locator('.create-submit').click();

    await page.waitForURL('**/signin', { timeout: 5000 });
    await expect(page).toHaveURL(/\/signin/);
  });

  test('create page shows real-time progress hint when logged in', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.create-hint')).toContainText('watch the progress in real time');
  });

  test('create page shows sign-in hint when not logged in', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.create-hint')).toContainText('sign in before we start');
  });
});

test.describe('Business Dropdown Auto-Populate', () => {
  test('business selection fills name and address', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', "Vito's");
    await expect(page.locator('.business-dropdown')).toBeVisible({ timeout: 5000 });
    await page.locator('.business-dropdown .address-option').first().click();

    await expect(page.locator('#create-name')).toHaveValue(/Vito/i);
    await expect(page.locator('#create-address')).not.toHaveValue('');
  });

  test('business selection auto-populates phone number', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Verify phone is empty initially
    await expect(page.locator('#create-phone')).toHaveValue('');

    // Type to trigger business search
    await page.fill('#create-name', "Vito's");
    await expect(page.locator('.business-dropdown')).toBeVisible({ timeout: 5000 });

    // Select the business with phone data
    await page.locator('.business-dropdown .address-option').first().click();

    // Phone should be auto-populated from mock data: (973) 123-4567
    await expect(page.locator('#create-phone')).toHaveValue('(973) 123-4567');
  });

  test('business selection auto-populates existing website', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Verify website is empty initially
    await expect(page.locator('#create-website')).toHaveValue('');

    // Type to trigger business search
    await page.fill('#create-name', "Vito's");
    await expect(page.locator('.business-dropdown')).toBeVisible({ timeout: 5000 });

    // Select the business with website data
    await page.locator('.business-dropdown .address-option').first().click();

    // Website should be auto-populated from mock data
    await expect(page.locator('#create-website')).toHaveValue('https://vitos-salon.com');
  });

  test('business dropdown shows business names and addresses', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', "Vito's");
    await expect(page.locator('.business-dropdown')).toBeVisible({ timeout: 5000 });

    // Should show business name and address in each suggestion
    await expect(page.locator('.biz-name').first()).toContainText(/Vito/i);
    await expect(page.locator('.biz-address').first()).toBeVisible();
  });

  test('auto-populate button is visible and functional', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.auto-populate-btn')).toBeVisible();
    await expect(page.getByText('Auto-Populate with AI')).toBeVisible();
  });
});

test.describe('Full Build Flow — Create to Published', () => {
  test('authenticated user creates site and navigates to waiting page', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', "Vito's Mens Salon");
    await page.fill('#create-address', '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034');
    await page.fill('#create-phone', '(973) 123-4567');
    await page.fill('#create-context', 'Premium mens salon offering cuts, shaves, and grooming.');

    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });
    await expect(page).toHaveURL(/\/waiting/);
    await expect(page.url()).toContain('slug=');
  });

  test('waiting page shows spinner and preparing message', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Test Build Salon');
    await page.fill('#create-address', '123 Test St, Test City, NJ 07000');
    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });

    await expect(page.locator('.waiting-card')).toBeVisible();
    await expect(page.locator('.spinner')).toBeVisible();
    await expect(page.locator('.waiting-title')).toContainText('Preparing');
  });

  test('waiting page shows status messages', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Status Msg Salon');
    await page.fill('#create-address', '456 Step St, Test City, NJ 07000');
    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });

    const subtitle = page.locator('.waiting-subtitle');
    await expect(subtitle).toBeVisible();
    const text = await subtitle.textContent();
    expect(text?.length).toBeGreaterThan(0);
  });

  test('waiting page has dashboard button', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Dashboard Salon');
    await page.fill('#create-address', '999 Dash St, Test City, NJ 07000');
    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });

    // Dashboard button should be visible
    const dashBtn = page.locator('.waiting-actions button', { hasText: 'Dashboard' });
    await expect(dashBtn).toBeVisible();
  });

  test('full workflow: search -> select -> /create -> redirect to signin', async ({ page }) => {
    // 1. Start at homepage
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Dismiss location modal if it appears
    const locationModal = page.locator('.location-modal-overlay');
    if (await locationModal.isVisible({ timeout: 1000 }).catch(() => false)) {
      await page.locator('.location-modal-overlay').click({ position: { x: 10, y: 10 } });
      await expect(locationModal).not.toBeVisible({ timeout: 2000 });
    }

    // 2. Search for a business
    await page.fill('.search-input', "Vito's Mens");
    await page.waitForSelector('.search-dropdown', { timeout: 5000 });

    // 3. Select the business from dropdown — should redirect to signin
    await page.locator('.search-result').first().click({ force: true });
    await page.waitForURL('**/signin', { timeout: 5000 });
    await expect(page).toHaveURL(/\/signin/);
  });
});

test.describe('Admin Dashboard', () => {
  test('admin dashboard loads with sites', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.site-card-name').first()).toContainText(/Vito/i);
  });

  test('admin new site button navigates to /create', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await page.locator('.admin-btn-accent').click();
    await page.waitForURL('**/create', { timeout: 5000 });
    await expect(page).toHaveURL(/\/create/);
  });

  test('admin file editor opens and shows content', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();

    await expect(page.locator('.modal-overlay')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.file-tree')).toBeVisible({ timeout: 5000 });

    await page.locator('.tree-file', { hasText: 'index.html' }).first().click();

    await expect(page.locator('.file-editor')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.file-editor-content')).toBeVisible();

    await page.waitForFunction(() => {
      const ta = document.querySelector('.file-editor-content') as HTMLTextAreaElement;
      return ta && ta.value && ta.value !== 'Loading...';
    }, { timeout: 5000 });

    const content = await page.locator('.file-editor-content').inputValue();
    expect(content).toContain('<!DOCTYPE html>');
  });

  test('more dropdown renders above other cards', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    // Open more dropdown
    const moreBtn = page.locator('.site-card').first().locator('.site-action-btn', { hasText: /^$/ }).last();
    await moreBtn.click({ force: true });

    // The dropdown should be visible
    await expect(page.locator('.more-dropdown')).toBeVisible({ timeout: 2000 });

    // The parent card should have dropdown-open class for z-index elevation
    await expect(page.locator('.site-card.dropdown-open')).toBeVisible();
  });

  test('modal overlay renders without FOUC', async ({ authedPage: page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    // Open files modal
    await page.locator('.site-action-btn', { hasText: 'Files' }).first().click();

    // Modal overlay should be immediately visible (no fade-in delay)
    const overlay = page.locator('.modal-overlay');
    await expect(overlay).toBeVisible({ timeout: 1000 });

    // Verify new-site-card is behind the modal (not visible through overlay)
    const modalZ = await overlay.evaluate(el => getComputedStyle(el).zIndex);
    expect(parseInt(modalZ)).toBeGreaterThanOrEqual(500);
  });
});

test.describe('Homepage Sections', () => {
  test('homepage included-in-plan section renders correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.locator('.included-strip').scrollIntoViewIfNeeded();
    await expect(page.locator('.included-strip-label')).toContainText('Included in every paid plan');
    await expect(page.locator('.included-item')).toHaveCount(8);
  });

  test('footer CTA section is removed', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.footer-cta')).toHaveCount(0);
    await expect(page.getByText('Your Website Is 5 Minutes Away')).toHaveCount(0);
  });
});

test.describe('Legal Pages — Gorgeous Styling', () => {
  test('privacy page renders with hero-style header', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toContainText('Privacy Policy');
    await expect(page.locator('.breadcrumb-current')).toContainText('Privacy');
    await expect(page.locator('.legal-content')).toBeVisible();
    await expect(page.locator('.legal-updated')).toContainText('March 1, 2026');
  });

  test('privacy page has glass card content wrapper', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('networkidle');

    // Verify the content is wrapped in a card with border and background
    const content = page.locator('.legal-content');
    const border = await content.evaluate(el => getComputedStyle(el).borderStyle);
    expect(border).not.toBe('none');
  });

  test('terms page renders with all sections', async ({ page }) => {
    await page.goto('/terms');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toContainText('Terms of Service');
    await expect(page.locator('.legal-content')).toBeVisible();
  });

  test('content policy page renders', async ({ page }) => {
    await page.goto('/content');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h1')).toContainText('Content Policy');
    await expect(page.locator('.legal-content')).toBeVisible();
  });

  test('legal pages have social links in footer', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.footer-social a')).toHaveCount(6);
  });

  test('legal page footer has navigation links', async ({ page }) => {
    await page.goto('/terms');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.footer-bottom')).toBeVisible();
    await expect(page.locator('.footer-bottom a', { hasText: 'Privacy' })).toBeVisible();
    await expect(page.locator('.footer-bottom a', { hasText: 'Terms' })).toBeVisible();
  });

  test('legal page breadcrumb home link works', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('networkidle');

    await page.locator('.breadcrumb-link', { hasText: 'Home' }).click();
    await page.waitForURL('**/', { timeout: 5000 });
  });
});

test.describe('Create Page — Category & Enhanced Details', () => {
  test('category dropdown renders with industry options', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const category = page.locator('#create-category');
    await expect(category).toBeVisible();

    // Should have the placeholder option
    const options = await category.locator('option').allTextContents();
    expect(options.length).toBeGreaterThan(10); // Many categories
    expect(options).toContain('Restaurant / Café');
    expect(options).toContain('Salon / Barbershop');
    expect(options).toContain('Technology / SaaS');
    expect(options).toContain('Other');
  });

  test('category is selectable', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.selectOption('#create-category', 'Salon / Barbershop');
    await expect(page.locator('#create-category')).toHaveValue('Salon / Barbershop');
  });

  test('textarea label says Additional details', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const label = page.locator('label[for="create-context"]');
    await expect(label).toContainText('Additional details');
    await expect(label).toContainText('optional but recommended');
  });

  test('textarea placeholder shows rich example with specific guidance', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const textarea = page.locator('#create-context');
    const placeholder = await textarea.getAttribute('placeholder');
    expect(placeholder).toContain('Brand colors');
    expect(placeholder).toContain('#1a1a2e');
    expect(placeholder).toContain('Google Analytics');
    expect(placeholder).toContain('Target audience');
    expect(placeholder).toContain('Design style');
  });

  test('auto-populate generates elaborate context with colors and fonts', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    // Fill in business details
    await page.fill('#create-name', "Vito's Mens Salon");
    await page.fill('#create-address', '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034');

    // Click Auto-Populate
    await page.locator('.auto-populate-btn').click({ force: true });

    // Wait for the context to be populated
    await expect(page.locator('#create-context')).not.toHaveValue('', { timeout: 10000 });

    const context = await page.locator('#create-context').inputValue();
    // Should contain design recommendations
    expect(context).toContain('Design style:');
    expect(context).toContain('Brand colors:');
    expect(context).toContain('Typography:');
    expect(context).toContain('Target audience:');
    expect(context).toContain('Recommended sections:');
    expect(context).toContain('scroll animations');
  });

  test('auto-populate hint text describes design recommendations', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const hint = page.locator('.auto-populate-hint');
    await expect(hint).toContainText('design recommendations');
  });

  test('auto-populate sets the category dropdown', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', "Vito's Mens Salon");
    await page.fill('#create-address', '74 N Beverwyck Rd, Lake Hiawatha, NJ 07034');

    // Category should be empty initially
    await expect(page.locator('#create-category')).toHaveValue('');

    // Click Auto-Populate
    await page.locator('.auto-populate-btn').click({ force: true });
    await expect(page.locator('#create-context')).not.toHaveValue('', { timeout: 10000 });

    // Category should now be set (inferred from business name or types)
    const categoryValue = await page.locator('#create-category').inputValue();
    expect(categoryValue).not.toBe('');
    expect(categoryValue.length).toBeGreaterThan(0);
  });

  test('category is included in form submission', async ({ authedPage: page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', 'Test Business');
    await page.fill('#create-address', '123 Main St, Test City, NJ 07000');
    await page.selectOption('#create-category', 'Technology / SaaS');

    // Intercept the API call to verify category is sent
    const [request] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/api/sites/create-from-search') && req.method() === 'POST'),
      page.locator('.create-submit').click(),
    ]);

    const body = request.postDataJSON();
    expect(body.business.category).toBe('Technology / SaaS');
  });
});

test.describe('Create Page — File Uploads', () => {
  test('logo upload section renders', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const logoInput = page.locator('#create-logo');
    await expect(logoInput).toBeAttached();

    const logoLabel = page.locator('label[for="create-logo"]');
    await expect(logoLabel).toContainText('Logo');
    await expect(logoLabel).toContainText('max 5 MB');
  });

  test('favicon upload section renders', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const faviconInput = page.locator('#create-favicon');
    await expect(faviconInput).toBeAttached();

    const faviconLabel = page.locator('label[for="create-favicon"]');
    await expect(faviconLabel).toContainText('Favicon');
    await expect(faviconLabel).toContainText('512');
  });

  test('additional images upload section renders', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const imagesInput = page.locator('#create-images');
    await expect(imagesInput).toBeAttached();

    const imagesLabel = page.locator('label[for="create-images"]');
    await expect(imagesLabel).toContainText('Additional images');
    await expect(imagesLabel).toContainText('up to 20 files');
  });

  test('AI generation note is shown below uploads', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const note = page.locator('.upload-note');
    await expect(note).toBeVisible();
    await expect(note).toContainText('AI will generate');
  });

  test('brand assets section label is visible', async ({ page }) => {
    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    const sectionLabel = page.locator('.form-section-label', { hasText: 'Brand Assets' });
    await expect(sectionLabel).toBeVisible();
  });

  test('build-assets API returns asset list', async ({ authedPage: page }) => {
    const response = await page.evaluate(async () => {
      const token = JSON.parse(localStorage.getItem('ps_session') || '{}').token;
      const res = await fetch('/api/sites/site-001/build-assets', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      return res.json();
    });

    expect(response.data).toBeDefined();
    expect(Array.isArray(response.data)).toBe(true);
    expect(response.data.length).toBeGreaterThan(0);
    expect(response.data[0].name).toBeDefined();
    expect(response.data[0].url).toBeDefined();
  });

  test('asset upload API returns upload_id', async ({ authedPage: page }) => {
    const response = await page.evaluate(async () => {
      const token = JSON.parse(localStorage.getItem('ps_session') || '{}').token;
      const res = await fetch('/api/assets/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: new FormData(), // empty FormData is fine for mock
      });
      return res.json();
    });

    expect(response.data).toBeDefined();
    expect(response.data.upload_id).toBeDefined();
    expect(typeof response.data.upload_id).toBe('string');
  });
});
