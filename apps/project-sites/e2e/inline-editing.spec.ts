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
      const fn = (window as unknown as { validateSlugLocal: (s: string) => unknown })
        .validateSlugLocal;
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
      const fn = (window as unknown as { validateSlugLocal: (s: string) => unknown })
        .validateSlugLocal;
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
      const fn = (window as unknown as { validateSlugLocal: (s: string) => unknown })
        .validateSlugLocal;
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
      const fn = (window as unknown as { validateSlugLocal: (s: string) => unknown })
        .validateSlugLocal;
      return fn('a');
    });
    expect(result1).toMatchObject({ valid: false, reason: expect.stringContaining('3') });

    const result2 = await page.evaluate(() => {
      const fn = (window as unknown as { validateSlugLocal: (s: string) => unknown })
        .validateSlugLocal;
      return fn('ab');
    });
    expect(result2).toMatchObject({ valid: false, reason: expect.stringContaining('3') });
  });

  test('rejects slug that normalizes to empty', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as { validateSlugLocal: (s: string) => unknown })
        .validateSlugLocal;
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
        } catch {
          /* cross-origin */
        }
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
        } catch {
          /* cross-origin */
        }
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
            // Only match the specific base selector that defines color
            if (
              sel.includes('inline-save-btn') &&
              !sel.includes(':hover') &&
              !sel.includes(':disabled') &&
              rule.style.color
            ) {
              saveColor = rule.style.color;
            }
            if (sel.includes('inline-cancel-btn') && !sel.includes(':hover') && rule.style.color) {
              cancelColor = rule.style.color;
            }
          }
        } catch {
          /* cross-origin */
        }
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
        } catch {
          /* cross-origin */
        }
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
        } catch {
          /* cross-origin */
        }
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

test.describe('Copy Toast', () => {
  test('copyUrl function is defined', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).copyUrl === 'function';
    });
    expect(exists).toBe(true);
  });

  test('copy-toast CSS and toast-pop keyframe exist', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let hasToastCSS = false;
      let hasToastPop = false;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel === '.copy-toast') hasToastCSS = true;
            if ((rules[r] as CSSKeyframesRule).name === 'toast-pop') hasToastPop = true;
          }
        } catch {
          /* cross-origin */
        }
      }
      return { hasToastCSS, hasToastPop };
    });
    expect(result.hasToastCSS).toBe(true);
    expect(result.hasToastPop).toBe(true);
  });
});

test.describe('Inline Edit Button Styling', () => {
  test('inline-edit-btn uses accent color', async ({ page }) => {
    await page.goto('/');

    const color = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (
              rule.selectorText &&
              rule.selectorText.includes('.inline-edit-btn') &&
              !rule.selectorText.includes(':hover')
            ) {
              return rule.style.color;
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return '';
    });
    // Should be var(--accent) which resolves to #64ffda
    expect(color).toBeTruthy();
  });

  test('inline-edit-btn hover has color transition', async ({ page }) => {
    await page.goto('/');

    const hasHover = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText && rule.selectorText.includes('.inline-edit-btn:hover')) {
              return !!rule.style.color;
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return false;
    });
    expect(hasHover).toBe(true);
  });
});

test.describe('Slug Editable Click Target', () => {
  test('slug-editable CSS rule has cursor text (click to edit)', async ({ page }) => {
    await page.goto('/');

    const hasCursor = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (
              rule.selectorText &&
              rule.selectorText.includes('.slug-editable') &&
              !rule.selectorText.includes(':hover')
            ) {
              return rule.style.cursor === 'text';
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return false;
    });
    expect(hasCursor).toBe(true);
  });

  test('slug-editable hover CSS rule exists', async ({ page }) => {
    await page.goto('/');

    const hasHover = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText && rule.selectorText.includes('.slug-editable:hover')) {
              return true;
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return false;
    });
    expect(hasHover).toBe(true);
  });
});

test.describe('Slug Editor Styling', () => {
  test('inline slug input is transparent with text-decoration underline', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (
              rule.selectorText &&
              rule.selectorText.includes('.inline-edit-inline') &&
              rule.selectorText.includes('.inline-input')
            ) {
              return {
                border: rule.style.border || rule.style.borderStyle,
                textDecorationLine: rule.style.textDecorationLine || rule.style.getPropertyValue('text-decoration-line'),
                textDecorationStyle: rule.style.textDecorationStyle || rule.style.getPropertyValue('text-decoration-style'),
                textUnderlineOffset: rule.style.textUnderlineOffset || rule.style.getPropertyValue('text-underline-offset'),
                boxShadow: rule.style.boxShadow,
                background: rule.style.background || rule.style.backgroundColor,
                color: rule.style.color,
                borderRadius: rule.style.borderRadius,
              };
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return {
        border: '',
        textDecorationLine: '',
        textDecorationStyle: '',
        textUnderlineOffset: '',
        boxShadow: '',
        background: '',
        color: '',
        borderRadius: '',
      };
    });
    expect(result.border).toBe('none');
    expect(result.textDecorationLine).toBe('underline');
    expect(result.textDecorationStyle).toBe('solid');
    expect(result.textUnderlineOffset).toBe('2px');
    expect(result.boxShadow).toBe('none');
    expect(result.background).toBe('transparent');
    expect(result.color).toBe('inherit');
    expect(result.borderRadius).toBe('0px');
  });

  test('inline slug save/cancel buttons are fully transparent', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            const sel = rule.selectorText || '';
            if (sel.includes('.inline-edit-inline') && sel.includes('.inline-save-btn')) {
              return {
                background: rule.style.background || rule.style.backgroundColor,
                border: rule.style.border,
                outline: rule.style.outline,
                boxShadow: rule.style.boxShadow,
              };
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return { background: '', border: '', outline: '', boxShadow: '' };
    });
    expect(result.background).toBe('transparent');
    expect(result.border).toBe('none');
    expect(result.outline).toBe('none');
    expect(result.boxShadow).toBe('none');
  });
});

test.describe('Inline Button Alignment', () => {
  test('inline slug save/cancel buttons use inline-flex for vertical alignment', async ({
    page,
  }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            const sel = rule.selectorText || '';
            if (sel.includes('.inline-edit-inline') && sel.includes('.inline-save-btn')) {
              return {
                display: rule.style.display,
                alignItems: rule.style.alignItems,
              };
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return { display: '', alignItems: '' };
    });
    expect(result.display).toBe('inline-flex');
    expect(result.alignItems).toBe('center');
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

test.describe('Signin Page Compact Footer', () => {
  test('signin screen contains signin-footer with social links and legal', async ({ page }) => {
    await page.goto('/');

    const hasFooter = await page.evaluate(() => {
      const signinScreen = document.getElementById('screen-signin');
      if (!signinScreen) return false;
      const footer = signinScreen.querySelector('.signin-footer');
      if (!footer) return false;
      const social = footer.querySelector('.signin-footer-social');
      const legal = footer.querySelector('.signin-footer-legal');
      return !!(social && legal);
    });
    expect(hasFooter).toBe(true);
  });

  test('signin-footer CSS rules exist', async ({ page }) => {
    await page.goto('/');

    const hasCSS = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel === '.signin-footer') return true;
          }
        } catch {
          /* cross-origin */
        }
      }
      return false;
    });
    expect(hasCSS).toBe(true);
  });

  test('navigateTo signin scrolls to top', async ({ page }) => {
    await page.goto('/');

    const navigateScrolls = await page.evaluate(() => {
      const fn = (window as unknown as { navigateTo: (s: string) => void }).navigateTo;
      return fn.toString().includes('scrollTo(0, 0)');
    });
    expect(navigateScrolls).toBe(true);
  });
});

test.describe('Signin Button States', () => {
  test('signin-btn has :active and :focus CSS rules', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let hasActive = false;
      let hasFocus = false;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel.includes('.signin-btn:active')) hasActive = true;
            if (sel.includes('.signin-btn:focus')) hasFocus = true;
          }
        } catch {
          /* cross-origin */
        }
      }
      return { hasActive, hasFocus };
    });
    expect(result.hasActive).toBe(true);
    expect(result.hasFocus).toBe(true);
  });

  test('signin-btn is included in ripple click handler', async ({ page }) => {
    await page.goto('/');

    const includesSignin = await page.evaluate(() => {
      // Check the ripple JS click handler includes signin-btn
      const scripts = document.querySelectorAll('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].textContent || '';
        if (text.includes('.signin-btn') && text.includes('ripple-circle')) {
          return true;
        }
      }
      return false;
    });
    expect(includesSignin).toBe(true);
  });
});

test.describe('Inline Input Colors', () => {
  test('inline-input has transparent background and inherited color', async ({ page }) => {
    await page.goto('/');

    const colors = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (
              rule.selectorText &&
              rule.selectorText.includes('.inline-input') &&
              !rule.selectorText.includes('.inline-edit-inline')
            ) {
              return {
                background: rule.style.background || rule.style.backgroundColor,
                color: rule.style.color,
              };
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return { background: '', color: '' };
    });
    expect(colors.background).toBe('transparent');
    expect(colors.color).toBe('inherit');
  });
});

test.describe('Workflow Log Labels', () => {
  test('formatActionLabel includes workflow step labels', async ({ page }) => {
    await page.goto('/');

    const labels = await page.evaluate(() => {
      const fn = (window as unknown as { formatActionLabel: (a: string) => string })
        .formatActionLabel;
      return {
        queued: fn('workflow.queued'),
        started: fn('workflow.started'),
        profile: fn('workflow.step.profile_research_complete'),
        parallel: fn('workflow.step.parallel_research_complete'),
        html: fn('workflow.step.html_generation_complete'),
        legal: fn('workflow.step.legal_and_scoring_complete'),
        upload: fn('workflow.step.upload_to_r2_complete'),
        completed: fn('workflow.completed'),
        profileStarted: fn('workflow.step.profile_research_started'),
        parallelStarted: fn('workflow.step.parallel_research_started'),
        htmlStarted: fn('workflow.step.html_generation_started'),
        legalStarted: fn('workflow.step.legal_scoring_started'),
        uploadStarted: fn('workflow.step.upload_started'),
        publishStarted: fn('workflow.step.publishing_started'),
        stepFailed: fn('workflow.step.failed'),
      };
    });
    expect(labels.queued).toBe('Build Queued');
    expect(labels.started).toBe('Build Started');
    expect(labels.profile).toBe('Profile Research Done');
    expect(labels.parallel).toBe('Research Complete');
    expect(labels.html).toBe('Website Generated');
    expect(labels.legal).toBe('Legal Pages Ready');
    expect(labels.upload).toBe('Files Uploaded');
    expect(labels.completed).toBe('Build Completed');
    expect(labels.profileStarted).toBe('Researching Business');
    expect(labels.parallelStarted).toBe('Researching Details');
    expect(labels.htmlStarted).toBe('Generating Website');
    expect(labels.legalStarted).toBe('Creating Legal Pages');
    expect(labels.uploadStarted).toBe('Uploading Files');
    expect(labels.publishStarted).toBe('Publishing Site');
    expect(labels.stepFailed).toBe('Step Failed');
  });
});

test.describe('Material Ripple Effect Coverage', () => {
  test('ripple CSS selector covers all button classes', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const requiredClasses = [
        '.btn',
        '.site-card-btn',
        '.admin-btn',
        '.admin-btn-accent',
        '.logs-refresh-btn',
        '.domain-tab',
        '.hostname-delete-btn',
        '.signin-btn',
        '.back-link',
        '.modal-close',
        '.details-modal-close',
        '.header-auth-btn',
        '.site-card-new',
        '.site-card-upgrade-btn',
        '.inline-edit-btn',
        '.inline-save-btn',
        '.inline-cancel-btn',
        '.faq-question',
        '.btn-allow',
        '.btn-skip',
        '.improve-ai-link',
        '.plan-badge',
      ];

      const sheets = document.styleSheets;
      let rippleSelector = '';
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            const sel = rule.selectorText || '';
            if (
              sel.includes('.btn') &&
              rule.style.overflow === 'hidden' &&
              rule.style.position === 'relative'
            ) {
              rippleSelector = sel;
              break;
            }
          }
        } catch {
          /* cross-origin */
        }
        if (rippleSelector) break;
      }

      const missing: string[] = [];
      for (const cls of requiredClasses) {
        if (!rippleSelector.includes(cls)) {
          missing.push(cls);
        }
      }
      return { found: !!rippleSelector, missing };
    });
    expect(result.found).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('ripple JS handler covers all button classes', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const required = [
        'modal-close',
        'details-modal-close',
        'header-auth-btn',
        'site-card-new',
        'site-card-upgrade-btn',
        'inline-edit-btn',
        'inline-save-btn',
        'inline-cancel-btn',
        'faq-question',
        'btn-allow',
        'btn-skip',
        'improve-ai-link',
        'plan-badge',
        'signin-btn',
        'back-link',
      ];
      const scripts = document.querySelectorAll('script');
      let handlerCode = '';
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].textContent || '';
        if (text.includes('ripple-circle') && text.includes('.closest(')) {
          handlerCode = text;
          break;
        }
      }
      const missing: string[] = [];
      for (const cls of required) {
        if (!handlerCode.includes('.' + cls)) {
          missing.push(cls);
        }
      }
      return { found: !!handlerCode, missing };
    });
    expect(result.found).toBe(true);
    expect(result.missing).toEqual([]);
  });

  test('ripple-circle CSS keyframe and style exist', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let hasKeyframe = false;
      let hasClass = false;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            if ((rules[r] as CSSKeyframesRule).name === 'ripple-expand') hasKeyframe = true;
            if ((rules[r] as CSSStyleRule).selectorText === '.ripple-circle') hasClass = true;
          }
        } catch {
          /* cross-origin */
        }
      }
      return { hasKeyframe, hasClass };
    });
    expect(result.hasKeyframe).toBe(true);
    expect(result.hasClass).toBe(true);
  });
});

test.describe('Button State Coverage', () => {
  test('modal-close has :active and :focus states', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let hasActive = false;
      let hasFocus = false;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel.includes('.modal-close:active')) hasActive = true;
            if (sel.includes('.modal-close:focus')) hasFocus = true;
          }
        } catch {
          /* cross-origin */
        }
      }
      return { hasActive, hasFocus };
    });
    expect(result.hasActive).toBe(true);
    expect(result.hasFocus).toBe(true);
  });

  test('faq-question has :active and :focus states', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let hasActive = false;
      let hasFocus = false;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel.includes('.faq-question:active')) hasActive = true;
            if (sel.includes('.faq-question:focus')) hasFocus = true;
          }
        } catch {
          /* cross-origin */
        }
      }
      return { hasActive, hasFocus };
    });
    expect(result.hasActive).toBe(true);
    expect(result.hasFocus).toBe(true);
  });

  test('inline-edit-btn has :active and :focus states', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let hasActive = false;
      let hasFocus = false;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel.includes('.inline-edit-btn:active')) hasActive = true;
            if (sel.includes('.inline-edit-btn:focus')) hasFocus = true;
          }
        } catch {
          /* cross-origin */
        }
      }
      return { hasActive, hasFocus };
    });
    expect(result.hasActive).toBe(true);
    expect(result.hasFocus).toBe(true);
  });

  test('btn-allow and btn-skip have :active and :focus states', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let allowActive = false;
      let allowFocus = false;
      let skipActive = false;
      let skipFocus = false;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel.includes('.btn-allow:active')) allowActive = true;
            if (sel.includes('.btn-allow:focus')) allowFocus = true;
            if (sel.includes('.btn-skip:active')) skipActive = true;
            if (sel.includes('.btn-skip:focus')) skipFocus = true;
          }
        } catch {
          /* cross-origin */
        }
      }
      return { allowActive, allowFocus, skipActive, skipFocus };
    });
    expect(result.allowActive).toBe(true);
    expect(result.allowFocus).toBe(true);
    expect(result.skipActive).toBe(true);
    expect(result.skipFocus).toBe(true);
  });
});

test.describe('Ripple Dynamic Sizing', () => {
  test('ripple JS handler dynamically sizes circles based on button dimensions', async ({
    page,
  }) => {
    await page.goto('/');

    const hasSizing = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].textContent || '';
        if (
          text.includes('ripple-circle') &&
          text.includes('rect.width') &&
          text.includes('rect.height')
        ) {
          return true;
        }
      }
      return false;
    });
    expect(hasSizing).toBe(true);
  });

  test('btn-accent has custom brighter ripple color', async ({ page }) => {
    await page.goto('/');

    const hasRule = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            const sel = rule.selectorText || '';
            if (sel.includes('.btn-accent') && sel.includes('.ripple-circle')) {
              return true;
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return false;
    });
    expect(hasRule).toBe(true);
  });
});

test.describe('Accessibility Improvements', () => {
  test('Escape key handler is registered for modals', async ({ page }) => {
    await page.goto('/');

    const hasEscHandler = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].textContent || '';
        if (text.includes("e.key !== 'Escape'") || text.includes("e.key === 'Escape'")) {
          return true;
        }
      }
      return false;
    });
    expect(hasEscHandler).toBe(true);
  });

  test('prefers-reduced-motion CSS media query exists', async ({ page }) => {
    await page.goto('/');

    const hasMediaQuery = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSMediaRule;
            if (
              rule.media &&
              rule.media.mediaText &&
              rule.media.mediaText.includes('prefers-reduced-motion')
            ) {
              return true;
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return false;
    });
    expect(hasMediaQuery).toBe(true);
  });
});

test.describe('Slug Validation Hints', () => {
  test('slug-hint CSS classes exist for error, taken, available, checking', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const found = { error: false, taken: false, available: false, checking: false, base: false };
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel === '.slug-hint') found.base = true;
            if (sel.includes('.hint-error')) found.error = true;
            if (sel.includes('.hint-taken')) found.taken = true;
            if (sel.includes('.hint-available')) found.available = true;
            if (sel.includes('.hint-checking')) found.checking = true;
          }
        } catch {
          /* cross-origin */
        }
      }
      return found;
    });
    expect(result.base).toBe(true);
    expect(result.error).toBe(true);
    expect(result.taken).toBe(true);
    expect(result.available).toBe(true);
    expect(result.checking).toBe(true);
  });

  test('showSlugHint and clearSlugHint functions exist', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const w = window as unknown as { showSlugHint: unknown; clearSlugHint: unknown };
      return {
        hasShow: typeof w.showSlugHint === 'function',
        hasClear: typeof w.clearSlugHint === 'function',
      };
    });
    expect(result.hasShow).toBe(true);
    expect(result.hasClear).toBe(true);
  });
});

test.describe('Slug Checking Pulse Animation', () => {
  test('status-checking has pulse animation CSS', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      let hasAnimation = false;
      let hasKeyframe = false;
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText && rule.selectorText.includes('.status-checking')) {
              if (rule.style.animation || rule.style.animationName) hasAnimation = true;
            }
            if ((rules[r] as CSSKeyframesRule).name === 'slug-pulse') hasKeyframe = true;
          }
        } catch {
          /* cross-origin */
        }
      }
      return { hasAnimation, hasKeyframe };
    });
    expect(result.hasAnimation).toBe(true);
    expect(result.hasKeyframe).toBe(true);
  });
});

test.describe('Save Toast Feedback', () => {
  test('showSaveToast function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as { showSaveToast: unknown }).showSaveToast === 'function';
    });
    expect(exists).toBe(true);
  });
});

test.describe('Slug Editable Keyboard Accessibility', () => {
  test('slug-editable spans have tabindex and role=button in renderAdminSites', async ({
    page,
  }) => {
    await page.goto('/');

    const hasA11y = await page.evaluate(() => {
      const fn = (window as unknown as { renderAdminSites: () => void }).renderAdminSites;
      if (!fn) return false;
      const src = fn.toString();
      return src.includes('tabindex="0"') && src.includes('role="button"');
    });
    expect(hasA11y).toBe(true);
  });

  test('slug-editable spans have onkeydown handler for Enter/Space', async ({ page }) => {
    await page.goto('/');

    const hasKeydown = await page.evaluate(() => {
      const fn = (window as unknown as { renderAdminSites: () => void }).renderAdminSites;
      if (!fn) return false;
      const src = fn.toString();
      return src.includes('onkeydown') && src.includes('Enter') && src.includes('startInlineEdit');
    });
    expect(hasKeydown).toBe(true);
  });
});

test.describe('Title Click to Edit', () => {
  test('site-card-name in renderAdminSites has onclick for startInlineEdit', async ({ page }) => {
    await page.goto('/');

    const hasClick = await page.evaluate(() => {
      const fn = (window as unknown as { renderAdminSites: () => void }).renderAdminSites;
      if (!fn) return false;
      const src = fn.toString();
      return (
        src.includes('site-card-name') && src.includes('onclick') && src.includes('cursor:pointer')
      );
    });
    expect(hasClick).toBe(true);
  });
});

test.describe('Copy Button No Ripple', () => {
  test('site-card-copy-btn is excluded from ripple CSS selector', async ({ page }) => {
    await page.goto('/');

    const excluded = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            const sel = rule.selectorText || '';
            if (
              sel.includes('.btn') &&
              rule.style.overflow === 'hidden' &&
              rule.style.position === 'relative'
            ) {
              return !sel.includes('.site-card-copy-btn');
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return true;
    });
    expect(excluded).toBe(true);
  });
});

test.describe('Button Stability', () => {
  test('btn-accent active has no translateY or scale transform', async ({ page }) => {
    await page.goto('/');

    const noTransform = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText && rule.selectorText.includes('.btn-accent:active')) {
              const t = rule.style.transform;
              return !t || (!t.includes('translateY') && !t.includes('scale'));
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return true;
    });
    expect(noTransform).toBe(true);
  });
});

test.describe('Modified Date on Site Cards', () => {
  test('renderAdminSites includes updated_at for modified date', async ({ page }) => {
    await page.goto('/');

    const hasModified = await page.evaluate(() => {
      const fn = (window as unknown as { renderAdminSites: () => void }).renderAdminSites;
      if (!fn) return false;
      const src = fn.toString();
      return src.includes('updated_at') && src.includes('Modified');
    });
    expect(hasModified).toBe(true);
  });
});

test.describe('DVd Column Hover', () => {
  test('dvd-column has hover CSS rule', async ({ page }) => {
    await page.goto('/');

    const hasHover = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText && rule.selectorText.includes('.dvd-column:hover')) {
              return !!rule.style.boxShadow;
            }
          }
        } catch {
          /* cross-origin */
        }
      }
      return false;
    });
    expect(hasHover).toBe(true);
  });
});

test.describe('AI Business Validation', () => {
  test('submitBuild calls validate-business endpoint', async ({ page }) => {
    await page.goto('/');

    const hasValidation = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].textContent || '';
        if (text.includes('submitBuild') && text.includes('validate-business')) {
          return true;
        }
      }
      return false;
    });
    expect(hasValidation).toBe(true);
  });

  test('createSiteFromSearch function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return (
        typeof (window as unknown as { createSiteFromSearch: unknown }).createSiteFromSearch ===
        'function'
      );
    });
    expect(exists).toBe(true);
  });
});

test.describe('Deploy Index Warning', () => {
  test('checkFolderForIndex function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return (
        typeof (window as unknown as { checkFolderForIndex: unknown }).checkFolderForIndex ===
        'function'
      );
    });
    expect(exists).toBe(true);
  });
});

test.describe('Form Validation Reset', () => {
  test('closeDetailsModal clears validation errors', async ({ page }) => {
    await page.goto('/');

    const clears = await page.evaluate(() => {
      const fn = (window as unknown as { closeDetailsModal: () => void }).closeDetailsModal;
      if (!fn) return false;
      const src = fn.toString();
      return src.includes('hideMsg') && src.includes('boxShadow');
    });
    expect(clears).toBe(true);
  });
});
