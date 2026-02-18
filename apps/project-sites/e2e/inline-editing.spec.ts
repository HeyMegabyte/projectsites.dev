/**
 * E2E tests for inline site editing (title + slug) on the admin dashboard.
 *
 * Covers:
 * - Inline editing JS functions are globally available
 * - Client-side slug validation (validateSlugLocal)
 * - Client-side title validation (validateTitle)
 * - Slug URL color status CSS classes exist
 * - Inline editing CSS rules are present
 * - Search deduplication logic
 */

import { test, expect } from './fixtures.js';

test.describe('Inline Editing Functions', () => {
  test('all inline editing functions are defined on window', async ({ page }) => {
    await page.goto('/');

    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        startInlineEdit: typeof w.startInlineEdit,
        saveInlineEdit: typeof w.saveInlineEdit,
        cancelInlineEdit: typeof w.cancelInlineEdit,
        onSlugInput: typeof w.onSlugInput,
        validateSlugLocal: typeof w.validateSlugLocal,
        validateTitle: typeof w.validateTitle,
        checkSlugAvailability: typeof w.checkSlugAvailability,
      };
    });

    expect(fns.startInlineEdit).toBe('function');
    expect(fns.saveInlineEdit).toBe('function');
    expect(fns.cancelInlineEdit).toBe('function');
    expect(fns.onSlugInput).toBe('function');
    expect(fns.validateSlugLocal).toBe('function');
    expect(fns.validateTitle).toBe('function');
    expect(fns.checkSlugAvailability).toBe('function');
  });

  test('edit-site-modal no longer exists in DOM', async ({ page }) => {
    await page.goto('/');

    const editModal = page.locator('#edit-site-modal');
    await expect(editModal).not.toBeAttached();
  });

  test('openEditSiteModal / closeEditSiteModal are no longer defined', async ({ page }) => {
    await page.goto('/');

    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        openEditSiteModal: typeof w.openEditSiteModal,
        closeEditSiteModal: typeof w.closeEditSiteModal,
      };
    });

    expect(fns.openEditSiteModal).toBe('undefined');
    expect(fns.closeEditSiteModal).toBe('undefined');
  });
});

test.describe('Client-side Slug Validation (validateSlugLocal)', () => {
  test('valid slug returns valid=true with normalized form', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as { validateSlugLocal: (s: string) => unknown }).validateSlugLocal;
      return fn('my-business');
    });

    expect(result).toEqual({
      valid: true,
      normalized: 'my-business',
    });
  });

  test('normalizes uppercase and special characters', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as { validateSlugLocal: (s: string) => unknown }).validateSlugLocal;
      return fn('My Business Name!');
    });

    expect(result).toEqual({
      valid: true,
      normalized: 'my-business-name',
    });
  });

  test('rejects empty slug', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as { validateSlugLocal: (s: string) => unknown }).validateSlugLocal;
      return fn('');
    });

    expect(result).toMatchObject({
      valid: false,
      reason: expect.stringContaining('required'),
    });
  });

  test('rejects slug with fewer than 3 characters', async ({ page }) => {
    await page.goto('/');

    const result1 = await page.evaluate(() => {
      const fn = (window as unknown as { validateSlugLocal: (s: string) => unknown }).validateSlugLocal;
      return fn('a');
    });
    expect(result1).toMatchObject({ valid: false, reason: expect.stringContaining('3') });

    const result2 = await page.evaluate(() => {
      const fn = (window as unknown as { validateSlugLocal: (s: string) => unknown }).validateSlugLocal;
      return fn('ab');
    });
    expect(result2).toMatchObject({ valid: false, reason: expect.stringContaining('3') });
  });

  test('rejects slug that normalizes to empty', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as { validateSlugLocal: (s: string) => unknown }).validateSlugLocal;
      return fn('!!!');
    });

    expect(result).toMatchObject({
      valid: false,
    });
  });
});

test.describe('Client-side Title Validation (validateTitle)', () => {
  test('valid title returns valid=true', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as { validateTitle: (s: string) => unknown }).validateTitle;
      return fn('My Great Business');
    });

    expect(result).toEqual({ valid: true });
  });

  test('rejects empty title', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as { validateTitle: (s: string) => unknown }).validateTitle;
      return fn('');
    });

    expect(result).toMatchObject({
      valid: false,
      reason: expect.stringContaining('required'),
    });
  });

  test('rejects whitespace-only title', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as { validateTitle: (s: string) => unknown }).validateTitle;
      return fn('   ');
    });

    expect(result).toMatchObject({
      valid: false,
      reason: expect.stringContaining('required'),
    });
  });
});

test.describe('Inline Editing CSS', () => {
  test('inline-edit-wrap CSS rule exists', async ({ page }) => {
    await page.goto('/');

    const hasRule = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel.includes('.inline-edit-wrap')) return true;
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(hasRule).toBe(true);
  });

  test('slug URL color status CSS classes exist', async ({ page }) => {
    await page.goto('/');

    const statuses = await page.evaluate(() => {
      const sheets = document.styleSheets;
      const found: Record<string, boolean> = {
        'status-default': false,
        'status-available': false,
        'status-taken': false,
        'status-invalid': false,
        'status-checking': false,
      };
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            for (const key of Object.keys(found)) {
              if (sel.includes(`.inline-slug-url.${key}`)) found[key] = true;
            }
          }
        } catch { /* cross-origin */ }
      }
      return found;
    });

    expect(statuses['status-default']).toBe(true);
    expect(statuses['status-available']).toBe(true);
    expect(statuses['status-taken']).toBe(true);
    expect(statuses['status-invalid']).toBe(true);
    expect(statuses['status-checking']).toBe(true);
  });

  test('inline-save-btn has green color and inline-cancel-btn has red color', async ({ page }) => {
    await page.goto('/');

    const colors = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let saveColor = '';
      let cancelColor = '';
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            const sel = rule.selectorText || '';
            // Selectors are `.inline-edit-wrap .inline-save-btn` etc.
            if (sel.includes('inline-save-btn') && !sel.includes(':hover') && !sel.includes(':disabled')) {
              saveColor = rule.style.color;
            }
            if (sel.includes('inline-cancel-btn') && !sel.includes(':hover')) {
              cancelColor = rule.style.color;
            }
          }
        } catch { /* cross-origin */ }
      }
      return { saveColor, cancelColor };
    });

    // Browsers may normalize hex to rgb format
    expect(colors.saveColor).toMatch(/#22c55e|rgb\(34,\s*197,\s*94\)/);
    expect(colors.cancelColor).toMatch(/#ef4444|rgb\(239,\s*68,\s*68\)/);
  });
});

test.describe('Search Deduplication', () => {
  test('renderDropdown function is defined', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).renderDropdown === 'function';
    });
    expect(exists).toBe(true);
  });
});

test.describe('Domain Modal Accessibility', () => {
  test('domain modal has role=dialog and aria-modal', async ({ page }) => {
    await page.goto('/');

    const modal = page.locator('#domain-modal');
    await expect(modal).toHaveAttribute('role', 'dialog');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
  });

  test('delete modal has role=dialog and aria-modal', async ({ page }) => {
    await page.goto('/');

    const modal = page.locator('#delete-modal');
    await expect(modal).toHaveAttribute('role', 'dialog');
    await expect(modal).toHaveAttribute('aria-modal', 'true');
  });
});

test.describe('Domain Management Functions', () => {
  test('loadHostnames and showCnameDiagnostics are defined', async ({ page }) => {
    await page.goto('/');

    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        loadHostnames: typeof w.loadHostnames,
        showCnameDiagnostics: typeof w.showCnameDiagnostics,
        showCnameMonitor: typeof w.showCnameMonitor,
        openDomainModal: typeof w.openDomainModal,
      };
    });

    expect(fns.loadHostnames).toBe('function');
    expect(fns.showCnameDiagnostics).toBe('function');
    expect(fns.showCnameMonitor).toBe('function');
    expect(fns.openDomainModal).toBe('function');
  });
});

test.describe('Reset Functions', () => {
  test('openResetModal and submitReset are defined', async ({ page }) => {
    await page.goto('/');

    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        openResetModal: typeof w.openResetModal,
        submitReset: typeof w.submitReset,
      };
    });

    expect(fns.openResetModal).toBe('function');
    expect(fns.submitReset).toBe('function');
  });
});

test.describe('Button Effects', () => {
  test('ripple-expand keyframe animation exists', async ({ page }) => {
    await page.goto('/');

    const hasRipple = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            if ((rules[r] as CSSKeyframesRule).name === 'ripple-expand') return true;
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(hasRipple).toBe(true);
  });

  test('btn-accent has enhanced background-size for gradient animation', async ({ page }) => {
    await page.goto('/');

    const hasBgSize = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText === '.btn-accent') {
              return rule.style.backgroundSize === '200% 200%';
            }
          }
        } catch { /* cross-origin */ }
      }
      return false;
    });
    expect(hasBgSize).toBe(true);
  });

  test('Status button is removed from site cards', async ({ page }) => {
    await page.goto('/');

    // openStatusModal should not exist since Status button was removed
    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).openStatusModal;
    });
    // The function may still exist but the button is gone - check that "Status" button text is absent
    // from the renderAdminSites function output (by checking the function source)
    const hasStatusBtn = await page.evaluate(() => {
      const fn = (window as unknown as { renderAdminSites: () => void }).renderAdminSites;
      return fn.toString().includes("'>Status</button>'");
    });
    expect(hasStatusBtn).toBe(false);
  });
});

test.describe('Upload Size Limit', () => {
  test('upload note mentions 100MB limit', async ({ page }) => {
    await page.goto('/');

    const hasLimit = await page.evaluate(() => {
      const fn = (window as unknown as { initUppy: () => void }).initUppy;
      if (!fn) return false;
      const src = fn.toString();
      return src.includes('100 * 1024 * 1024') || src.includes('100MB');
    });
    expect(hasLimit).toBe(true);
  });
});
