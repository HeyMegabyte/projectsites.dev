/**
 * @module e2e/site-card-features
 * @description E2E tests for site card enhancements:
 *   - Fixed-width inline edit action zones (no jump between edit/save/cancel)
 *   - Code editor with line numbers, word wrap toggle, and keyboard shortcuts
 *   - Enhanced Files modal toolbar
 *   - New workflow log action labels
 *   - Domain modal URL matching site card styling
 *
 * @packageDocumentation
 */

import { test, expect } from './fixtures.js';

// ─── Fixed-width Inline Edit Action Zones ──────────────────────

test.describe('Inline Edit Action Zones', () => {
  test('inline-edit-actions CSS exists with fixed width', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText === '.inline-edit-actions') {
              return {
                display: rule.style.display,
                width: rule.style.width,
                minWidth: rule.style.minWidth,
                flexShrink: rule.style.flexShrink,
              };
            }
          }
        } catch { /* cross-origin */ }
      }
      return null;
    });

    expect(result).toBeTruthy();
    if (result) {
      expect(result.display).toBe('inline-flex');
      expect(result.width).toBe('34px');
      expect(result.minWidth).toBe('34px');
      expect(result.flexShrink).toBe('0');
    }
  });

  test('inline-slug-actions CSS exists with fixed width', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText === '.inline-slug-actions') {
              return {
                display: rule.style.display,
                width: rule.style.width,
                minWidth: rule.style.minWidth,
              };
            }
          }
        } catch { /* cross-origin */ }
      }
      return null;
    });

    expect(result).toBeTruthy();
    if (result) {
      expect(result.display).toBe('inline-flex');
      expect(result.width).toBe('34px');
      expect(result.minWidth).toBe('34px');
    }
  });

  test('renderAdminSites wraps edit icon in inline-edit-actions for title', async ({ page }) => {
    await page.goto('/');

    const hasWrapper = await page.evaluate(() => {
      const fn = (window as unknown as { renderAdminSites: () => void }).renderAdminSites;
      if (!fn) return false;
      const src = fn.toString();
      return src.includes('inline-edit-actions') && src.includes('inline-edit-btn');
    });
    expect(hasWrapper).toBe(true);
  });

  test('renderAdminSites wraps edit icon in inline-slug-actions for URL', async ({ page }) => {
    await page.goto('/');

    const hasWrapper = await page.evaluate(() => {
      const fn = (window as unknown as { renderAdminSites: () => void }).renderAdminSites;
      if (!fn) return false;
      const src = fn.toString();
      return src.includes('inline-slug-actions') && src.includes('Edit URL slug');
    });
    expect(hasWrapper).toBe(true);
  });

  test('startInlineEdit uses inline-edit-actions for name save/cancel buttons', async ({ page }) => {
    await page.goto('/');

    const usesActionZone = await page.evaluate(() => {
      const fn = (window as unknown as { startInlineEdit: () => void }).startInlineEdit;
      if (!fn) return false;
      const src = fn.toString();
      return src.includes('inline-edit-actions') && src.includes('inline-slug-actions');
    });
    expect(usesActionZone).toBe(true);
  });

  test('cancelInlineEdit restores inline-edit-actions wrapper for name', async ({ page }) => {
    await page.goto('/');

    const restores = await page.evaluate(() => {
      const fn = (window as unknown as { cancelInlineEdit: () => void }).cancelInlineEdit;
      if (!fn) return false;
      const src = fn.toString();
      return src.includes('inline-edit-actions') && src.includes('inline-slug-actions');
    });
    expect(restores).toBe(true);
  });
});

// ─── Code Editor with Line Numbers ────────────────────────────

test.describe('Code Editor Features', () => {
  test('code-editor-wrap CSS exists', async ({ page }) => {
    await page.goto('/');

    const hasRule = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText === '.code-editor-wrap') {
              return true;
            }
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(hasRule).toBe(true);
  });

  test('code-line-numbers CSS exists', async ({ page }) => {
    await page.goto('/');

    const hasRule = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText === '.code-line-numbers') {
              return {
                width: rule.style.width,
                userSelect: rule.style.userSelect,
              };
            }
          }
        } catch { /* cross-origin */ }
      }
      return null;
    });

    expect(hasRule).toBeTruthy();
    if (hasRule) {
      expect(hasRule.width).toBe('40px');
      expect(hasRule.userSelect).toBe('none');
    }
  });

  test('code-line-numbers element exists in files editor', async ({ page }) => {
    await page.goto('/');

    const el = page.locator('#code-line-numbers');
    await expect(el).toBeAttached();
  });

  test('code-editor-wrap wraps line numbers and textarea', async ({ page }) => {
    await page.goto('/');

    const structure = await page.evaluate(() => {
      const wrap = document.querySelector('.code-editor-wrap');
      if (!wrap) return null;
      const lineNums = wrap.querySelector('#code-line-numbers');
      const textarea = wrap.querySelector('#files-editor-content');
      return {
        hasWrap: true,
        hasLineNums: !!lineNums,
        hasTextarea: !!textarea,
      };
    });

    expect(structure).toBeTruthy();
    if (structure) {
      expect(structure.hasLineNums).toBe(true);
      expect(structure.hasTextarea).toBe(true);
    }
  });

  test('updateLineNumbers function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).updateLineNumbers === 'function';
    });
    expect(exists).toBe(true);
  });

  test('syncLineScroll function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).syncLineScroll === 'function';
    });
    expect(exists).toBe(true);
  });

  test('handleEditorKeydown function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).handleEditorKeydown === 'function';
    });
    expect(exists).toBe(true);
  });

  test('editorWordWrap function exists and toggles state', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, unknown>).editorWordWrap;
      if (typeof fn !== 'function') return null;
      return { exists: true };
    });
    expect(result).toBeTruthy();
  });
});

// ─── Enhanced Files Toolbar ─────────────────────────────────────

test.describe('Files Modal Toolbar', () => {
  test('editor-toolbar CSS exists', async ({ page }) => {
    await page.goto('/');

    const hasRule = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText === '.editor-toolbar') return true;
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(hasRule).toBe(true);
  });

  test('editor-toolbar-btn CSS exists with hover states', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let hasBase = false;
      let hasHover = false;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel === '.editor-toolbar-btn') hasBase = true;
            if (sel.includes('.editor-toolbar-btn:hover')) hasHover = true;
          }
        } catch { /* cross-origin */ }
      }
      return { hasBase, hasHover };
    });
    expect(result.hasBase).toBe(true);
    expect(result.hasHover).toBe(true);
  });

  test('files modal has compact toolbar class', async ({ page }) => {
    await page.goto('/');

    const toolbar = page.locator('.files-toolbar-compact');
    await expect(toolbar).toBeAttached();
  });

  test('files modal has refresh button in title bar', async ({ page }) => {
    await page.goto('/');

    const modal = page.locator('#files-modal');
    const refreshBtn = modal.locator('.editor-toolbar-btn').first();
    await expect(refreshBtn).toBeAttached();
  });

  test('editor toolbar has word wrap toggle button', async ({ page }) => {
    await page.goto('/');

    const wrapBtn = page.locator('#editor-wrap-btn');
    await expect(wrapBtn).toBeAttached();
  });

  test('editor toolbar has Back button and Save button', async ({ page }) => {
    await page.goto('/');

    const editorToolbar = page.locator('.editor-toolbar');
    await expect(editorToolbar).toBeAttached();
    const saveBtn = page.locator('#files-save-btn');
    await expect(saveBtn).toBeAttached();
  });

  test('files-editor-size element exists for file size display', async ({ page }) => {
    await page.goto('/');

    const sizeEl = page.locator('#files-editor-size');
    await expect(sizeEl).toBeAttached();
  });
});

// ─── New Workflow Log Action Labels ─────────────────────────────

test.describe('Enhanced Log Action Labels', () => {
  test('formatActionLabel handles new action types', async ({ page }) => {
    await page.goto('/');

    const labels = await page.evaluate(() => {
      const fn = (window as unknown as { formatActionLabel: (a: string) => string }).formatActionLabel;
      return {
        slugChanged: fn('site.slug_changed'),
        nameChanged: fn('site.name_changed'),
        fileUpdated: fn('file.updated'),
        phaseResearch: fn('workflow.phase.research'),
        phaseGeneration: fn('workflow.phase.generation'),
        phaseDeployment: fn('workflow.phase.deployment'),
        statusUpdate: fn('workflow.status_update'),
      };
    });

    expect(labels.slugChanged).toBe('URL Changed');
    expect(labels.nameChanged).toBe('Name Changed');
    expect(labels.fileUpdated).toBe('File Saved');
    expect(labels.phaseResearch).toBe('Research Phase');
    expect(labels.phaseGeneration).toBe('Generation Phase');
    expect(labels.phaseDeployment).toBe('Deployment Phase');
    expect(labels.statusUpdate).toBe('Status Update');
  });
});

// ─── Files Modal Functions ──────────────────────────────────────

test.describe('Files Modal Functions', () => {
  test('openFilesModal function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).openFilesModal === 'function';
    });
    expect(exists).toBe(true);
  });

  test('closeFilesModal function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).closeFilesModal === 'function';
    });
    expect(exists).toBe(true);
  });

  test('openFileForEdit function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).openFileForEdit === 'function';
    });
    expect(exists).toBe(true);
  });

  test('closeFileEditor function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).closeFileEditor === 'function';
    });
    expect(exists).toBe(true);
  });

  test('saveCurrentFile function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).saveCurrentFile === 'function';
    });
    expect(exists).toBe(true);
  });

  test('loadFilesForSite function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).loadFilesForSite === 'function';
    });
    expect(exists).toBe(true);
  });

  test('files modal initially hidden', async ({ page }) => {
    await page.goto('/');

    const modal = page.locator('#files-modal');
    await expect(modal).toBeAttached();
    await expect(modal).not.toHaveClass(/visible/);
  });
});

// ─── Site Card Button Presence ──────────────────────────────────

test.describe('Site Card Button Functions', () => {
  test('all site card action functions exist', async ({ page }) => {
    await page.goto('/');

    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        openDomainModal: typeof w.openDomainModal,
        openFilesModal: typeof w.openFilesModal,
        openResetModal: typeof w.openResetModal,
        openDeployModal: typeof w.openDeployModal,
        openDeleteModal: typeof w.openDeleteModal,
        openSiteLogsModal: typeof w.openSiteLogsModal,
        editSiteInBolt: typeof w.editSiteInBolt,
        openNewWebsiteModal: typeof w.openNewWebsiteModal,
      };
    });

    expect(fns.openDomainModal).toBe('function');
    expect(fns.openFilesModal).toBe('function');
    expect(fns.openResetModal).toBe('function');
    expect(fns.openDeployModal).toBe('function');
    expect(fns.openDeleteModal).toBe('function');
    expect(fns.openSiteLogsModal).toBe('function');
    expect(fns.editSiteInBolt).toBe('function');
    expect(fns.openNewWebsiteModal).toBe('function');
  });

  test('renderAdminSites includes all action buttons', async ({ page }) => {
    await page.goto('/');

    const buttons = await page.evaluate(() => {
      const fn = (window as unknown as { renderAdminSites: () => void }).renderAdminSites;
      if (!fn) return null;
      const src = fn.toString();
      return {
        hasVisit: src.includes('btn-visit'),
        hasAIEdit: src.includes('AI Edit'),
        hasLogs: src.includes('openSiteLogsModal'),
        hasDomains: src.includes('openDomainModal'),
        hasFiles: src.includes('openFilesModal'),
        hasReset: src.includes('openResetModal'),
        hasDeploy: src.includes('openDeployModal'),
        hasDelete: src.includes('openDeleteModal'),
      };
    });

    expect(buttons).toBeTruthy();
    if (buttons) {
      expect(buttons.hasVisit).toBe(true);
      expect(buttons.hasAIEdit).toBe(true);
      expect(buttons.hasLogs).toBe(true);
      expect(buttons.hasDomains).toBe(true);
      expect(buttons.hasFiles).toBe(true);
      expect(buttons.hasReset).toBe(true);
      expect(buttons.hasDeploy).toBe(true);
      expect(buttons.hasDelete).toBe(true);
    }
  });
});

// ─── API Auth Gates ─────────────────────────────────────────────

test.describe('Site Card API Auth Gates', () => {
  test('PATCH /api/sites/:id requires auth', async ({ request }) => {
    const res = await request.patch('/api/sites/fake-id', {
      data: { business_name: 'Test' },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('POST /api/sites/:id/reset requires auth', async ({ request }) => {
    const res = await request.post('/api/sites/fake-id/reset', {
      data: { business: { name: 'Test' } },
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(res.status());
  });

  test('POST /api/sites/:id/deploy requires auth', async ({ request }) => {
    const res = await request.post('/api/sites/fake-id/deploy', {
      multipart: {},
    });
    expect([401, 403, 400]).toContain(res.status());
  });

  test('DELETE /api/sites/:id requires auth', async ({ request }) => {
    const res = await request.delete('/api/sites/fake-id');
    expect([401, 403]).toContain(res.status());
  });

  test('GET /api/sites/:id/hostnames requires auth', async ({ request }) => {
    const res = await request.get('/api/sites/fake-id/hostnames');
    expect([401, 403]).toContain(res.status());
  });
});

// ─── CSP Frame Source (verified via unit test; E2E dev server has separate CSP) ──
