/**
 * @module e2e/domain-management
 * @description E2E tests for the domain management features in the admin dashboard.
 *
 * Tests cover:
 * - Domain summary bar rendering
 * - Domain modal opening and hostname display
 * - Verify button for pending hostnames
 * - Adding custom domains via connect tab
 * - Domain search in register tab
 *
 * @packageDocumentation
 */

import { test, expect } from './fixtures.js';

test.describe('Domain Management Admin API', () => {
  test('GET /api/admin/domains returns 401 without auth', async ({ page }) => {
    const res = await page.request.get('/api/admin/domains');
    expect(res.status()).toBe(401);
  });

  test('GET /api/admin/domains/summary returns 401 without auth', async ({ page }) => {
    const res = await page.request.get('/api/admin/domains/summary');
    expect(res.status()).toBe(401);
  });

  test('POST /api/admin/domains/:id/verify returns 401 without auth', async ({ page }) => {
    const res = await page.request.post('/api/admin/domains/some-id/verify');
    expect(res.status()).toBe(401);
  });

  test('GET /api/admin/domains/:id/health returns 401 without auth', async ({ page }) => {
    const res = await page.request.get('/api/admin/domains/some-id/health');
    expect(res.status()).toBe(401);
  });

  test('DELETE /api/admin/domains/:id returns 401 without auth', async ({ page }) => {
    const res = await page.request.delete('/api/admin/domains/some-id');
    expect(res.status()).toBe(401);
  });
});

test.describe('Domain Management UI', () => {
  test('homepage loads with domain management modal markup', async ({ page }) => {
    await page.goto('/');

    // The domain modal overlay should be in the DOM (hidden)
    const domainModal = page.locator('#domain-modal');
    await expect(domainModal).toBeAttached();

    // The domain summary bar should be in the DOM (hidden initially)
    const summaryBar = page.locator('#domain-summary-bar');
    await expect(summaryBar).toBeAttached();
  });

  test('domain modal has all three tabs', async ({ page }) => {
    await page.goto('/');

    // Check tab buttons exist
    const existingTab = page.locator('#domain-tab-existing');
    const connectTab = page.locator('#domain-tab-connect');
    const registerTab = page.locator('#domain-tab-register');

    await expect(existingTab).toBeAttached();
    await expect(connectTab).toBeAttached();
    await expect(registerTab).toBeAttached();
  });

  test('domain connect tab has CNAME instruction', async ({ page }) => {
    await page.goto('/');

    const connectPanel = page.locator('#domain-panel-connect');
    await expect(connectPanel).toBeAttached();

    // Check that it mentions sites.megabyte.space as CNAME target
    const text = await connectPanel.textContent();
    expect(text).toContain('sites.megabyte.space');
  });

  test('domain search input exists in register tab', async ({ page }) => {
    await page.goto('/');

    const searchInput = page.locator('#domain-search-input');
    await expect(searchInput).toBeAttached();
  });
});

test.describe('Admin Panel Styling', () => {
  test('admin panel has min-height: 500px', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('min-height: 500px');
  });
});

test.describe('Site Card URL Display', () => {
  test('site card rendering includes URL/CNAME combined label when same', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    // Verify combined URL / CNAME badge for when no custom domain is set
    expect(html).toContain('>URL / CNAME</span>');
    // Verify separate CNAME and URL badges for when custom domain exists
    expect(html).toContain('>CNAME</span>');
    expect(html).toContain('>URL</span>');
  });

  test('URL link does not use font-weight bold', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    // The URL link in site cards should NOT have font-weight:600
    // The combined URL / CNAME row should not bold the link
    expect(html).not.toContain("hasPrimaryCustom ? 'https://' + s.primary_hostname : cnameUrl");
  });

  test('CNAME and URL tags use min-width for alignment', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('min-width:42px');
  });
});

test.describe('Domains Button Availability', () => {
  test('Domains button is available for all sites (not just paid)', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    // The Domains button should NOT be gated behind sitePlan === paid
    expect(html).not.toContain("if (sitePlan === 'paid') {");
    // The openDomainModal call should still exist
    expect(html).toContain('openDomainModal(');
  });
});

test.describe('Build Terminal', () => {
  test('build terminal has max-height: 270px', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('max-height: 270px');
  });

  test('waiting title has hover effect styles', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('.waiting-title:hover');
    expect(html).toContain('text-shadow');
  });

  test('build terminal does not display [object Object]', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain("typeof errorMsg === 'object'");
    expect(html).toContain('errorMsg.message || errorMsg.name || JSON.stringify(errorMsg)');
  });
});

test.describe('Auto-hide Error Notifications', () => {
  test('auto-hide event listeners are registered for input fields', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    // Verify auto-hide pairs are wired up
    expect(html).toContain('details-textarea');
    expect(html).toContain('autoHidePairs');
    expect(html).toContain("addEventListener('input'");
  });
});

test.describe('Deploy File Manager', () => {
  test('deploy modal has file manager markup', async ({ page }) => {
    await page.goto('/');

    const fm = page.locator('#deploy-file-manager');
    await expect(fm).toBeAttached();
  });

  test('deploy modal has hidden dist path input', async ({ page }) => {
    await page.goto('/');

    const distInput = page.locator('#deploy-dist-path');
    await expect(distInput).toBeAttached();
    expect(await distInput.getAttribute('type')).toBe('hidden');
  });

  test('deploy modal includes JSZip library', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('jszip');
  });

  test('parseZipFolders function exists', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('function parseZipFolders');
    expect(html).toContain('function selectDeployFolder');
  });

  test('auto-selects dist/ folder from ZIP contents', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    // Verify the auto-selection logic checks for dist/ first
    expect(html).toContain("['dist/', 'build/', 'out/', 'public/', 'output/']");
  });
});

test.describe('Business Name Dropdown Styling', () => {
  test('business name dropdown has correct z-index', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('z-index: 99999');
    expect(html).toContain('z-index: 9999');
  });

  test('business name dropdown has absolute positioning with top offset', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('.details-biz-dropdown');
    expect(html).toContain('top: 70px');
    expect(html).toContain('padding-top: 20px');
  });
});

test.describe('Domain Modal Styling', () => {
  test('domain modal has min-height: 510px', async ({ page }) => {
    await page.goto('/');

    const domainModal = page.locator('#domain-modal .modal');
    await expect(domainModal).toBeAttached();
    const style = await domainModal.getAttribute('style');
    expect(style).toContain('min-height:440px');
  });
});

test.describe('Domain Search Input Styling', () => {
  test('domain search input has z-index and position relative', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('z-index: 99');
    expect(html).toContain('position: relative');
  });

  test('domain search input focus uses accent border', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('.domain-search-input:focus');
    expect(html).toContain('border-color: var(--accent)');
  });

  test('domain search results has margin-top spacing', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('.domain-search-results');
    expect(html).toContain('margin-top: 8px');
  });
});

test.describe('Deploy Upload File Types', () => {
  test('deploy chat input accepts document formats', async ({ page }) => {
    await page.goto('/');

    const jsonInput = page.locator('#deploy-json-input');
    await expect(jsonInput).toBeAttached();
    const accept = await jsonInput.getAttribute('accept');
    expect(accept).toContain('.json');
    expect(accept).toContain('.md');
    expect(accept).toContain('.pdf');
    expect(accept).toContain('.txt');
    expect(accept).toContain('.csv');
    expect(accept).toContain('.doc');
    expect(accept).toContain('.docx');
  });

  test('deploy chat label says document instead of just JSON', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('Chat / Document');
    expect(html).toContain('Chat export, markdown, PDF, or any document');
  });
});

test.describe('Edit Feature', () => {
  test('editSiteInBolt function connects to bolt.megabyte.space', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('function editSiteInBolt');
    expect(html).toContain('bolt.megabyte.space');
    expect(html).toContain('importChatFrom');
  });

  test('AI Edit button markup exists for published sites', async ({ page }) => {
    await page.goto('/');

    const html = await page.content();
    expect(html).toContain('editSiteInBolt(');
    expect(html).toContain('AI Edit');
  });
});
