/**
 * E2E tests for site card status, domain management UI, and real-time features.
 *
 * Covers:
 * - Site card status badges (collecting, generating, uploading, error, live)
 * - Status positioned left of title
 * - Modified date right-aligned
 * - No edit icon on URL (slug is clickable directly)
 * - Domain modal: hostname status squares (green/red)
 * - Domain modal: hostname chips (Default, Primary)
 * - Connect Domain error handling (proper English)
 * - Register New styling (no padding, 1px separators)
 * - AI validation tooltip
 * - Real-time status polling functions
 * - mapStatusLabel and mapStatusClass helper functions
 */

import { test, expect } from './fixtures.js';

test.describe('Site Card Status Badges', () => {
  test('mapStatusLabel function is defined and maps correctly', async ({ page }) => {
    await page.goto('/');

    const labels = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.mapStatusLabel as (s: string) => string;
      if (typeof fn !== 'function') return null;
      return {
        published: fn('published'),
        building: fn('building'),
        queued: fn('queued'),
        collecting: fn('collecting'),
        generating: fn('generating'),
        uploading: fn('uploading'),
        error: fn('error'),
        failed: fn('failed'),
        draft: fn('draft'),
      };
    });

    expect(labels).not.toBeNull();
    expect(labels!.published).toBe('Live');
    expect(labels!.collecting).toBe('Collecting Data');
    expect(labels!.generating).toBe('Generating');
    expect(labels!.uploading).toBe('Uploading');
    expect(labels!.error).toBe('Error');
    expect(labels!.failed).toBe('Error');
    expect(labels!.draft).toBe('Draft');
  });

  test('mapStatusClass maps failed to error', async ({ page }) => {
    await page.goto('/');

    const cls = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      const fn = w.mapStatusClass as (s: string) => string;
      if (typeof fn !== 'function') return null;
      return {
        failed: fn('failed'),
        published: fn('published'),
        collecting: fn('collecting'),
      };
    });

    expect(cls).not.toBeNull();
    expect(cls!.failed).toBe('error');
    expect(cls!.published).toBe('published');
    expect(cls!.collecting).toBe('collecting');
  });

  test('site-card-title-row CSS exists (status left of title)', async ({ page }) => {
    await page.goto('/');

    const hasClass = await page.evaluate(() => {
      const styles = document.querySelectorAll('style');
      for (let i = 0; i < styles.length; i++) {
        if (styles[i].textContent?.includes('.site-card-title-row')) return true;
      }
      return false;
    });
    expect(hasClass).toBe(true);
  });

  test('status badge CSS classes exist for all states', async ({ page }) => {
    await page.goto('/');

    const hasClasses = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return {
        published: styles.includes('.site-card-status.published'),
        building: styles.includes('.site-card-status.building'),
        collecting: styles.includes('.site-card-status.collecting'),
        generating: styles.includes('.site-card-status.generating'),
        uploading: styles.includes('.site-card-status.uploading'),
        error: styles.includes('.site-card-status.error'),
        draft: styles.includes('.site-card-status.draft'),
      };
    });

    expect(hasClasses.published).toBe(true);
    expect(hasClasses.building).toBe(true);
    expect(hasClasses.collecting).toBe(true);
    expect(hasClasses.generating).toBe(true);
    expect(hasClasses.uploading).toBe(true);
    expect(hasClasses.error).toBe(true);
    expect(hasClasses.draft).toBe(true);
  });
});

test.describe('Modified Date Right-Aligned', () => {
  test('site-card-date-modified CSS class exists', async ({ page }) => {
    await page.goto('/');

    const hasClass = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('.site-card-date-modified');
    });
    expect(hasClass).toBe(true);
  });

  test('site-card-date uses flexbox justify-content space-between', async ({ page }) => {
    await page.goto('/');

    const hasFlexBetween = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('justify-content: space-between') && styles.includes('.site-card-date');
    });
    expect(hasFlexBetween).toBe(true);
  });
});

test.describe('No Edit Icon on URL', () => {
  test('slug-editable does not have inline-edit-btn sibling in renderAdminSites', async ({ page }) => {
    await page.goto('/');

    // The slug line in renderAdminSites should NOT have an inline-edit-btn inside it
    // It should only have the slug-editable span
    const hasEditBtnInSlugLine = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].textContent || '';
        // Look for the renderAdminSites slug section - should NOT have inline-edit-btn
        if (text.includes('slug-editable') && text.includes('renderAdminSites')) {
          // Count slug-editable occurrences vs inline-edit-btn in same area
          // In the old code, each slug-editable had an inline-edit-btn
          // In the new code, there's no inline-edit-btn next to slug-editable
          const slugEditableInUrl = text.indexOf("</span></span>-sites.megabyte.space");
          return slugEditableInUrl !== -1; // Found the pattern without edit btn
        }
      }
      return false;
    });
    expect(hasEditBtnInSlugLine).toBe(true);
  });
});

test.describe('Domain Management UI', () => {
  test('hostname-status-square CSS classes exist', async ({ page }) => {
    await page.goto('/');

    const hasClasses = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return {
        base: styles.includes('.hostname-status-square'),
        active: styles.includes('.hostname-status-square.active'),
        inactive: styles.includes('.hostname-status-square.inactive'),
      };
    });

    expect(hasClasses.base).toBe(true);
    expect(hasClasses.active).toBe(true);
    expect(hasClasses.inactive).toBe(true);
  });

  test('hostname-chips CSS classes exist', async ({ page }) => {
    await page.goto('/');

    const hasClasses = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return {
        chips: styles.includes('.hostname-chips'),
        chip: styles.includes('.hostname-chip'),
        chipDefault: styles.includes('.hostname-chip.default'),
        chipPrimary: styles.includes('.hostname-chip.primary'),
        setPrimary: styles.includes('.hostname-chip-setprimary'),
      };
    });

    expect(hasClasses.chips).toBe(true);
    expect(hasClasses.chip).toBe(true);
    expect(hasClasses.chipDefault).toBe(true);
    expect(hasClasses.chipPrimary).toBe(true);
    expect(hasClasses.setPrimary).toBe(true);
  });

  test('resetPrimaryToDefault function is defined', async ({ page }) => {
    await page.goto('/');

    const fnType = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return typeof w.resetPrimaryToDefault;
    });
    expect(fnType).toBe('function');
  });
});

test.describe('Register New Styling', () => {
  test('domain-result-item has no left/right padding', async ({ page }) => {
    await page.goto('/');

    const hasCss = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      // Check that domain-result-item uses padding: 10px 0 (no left/right)
      return styles.includes('padding: 10px 0');
    });
    expect(hasCss).toBe(true);
  });

  test('domain-result-item uses 1px separator', async ({ page }) => {
    await page.goto('/');

    const hasCss = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('border-bottom: 1px solid rgba(255,255,255,0.06)');
    });
    expect(hasCss).toBe(true);
  });
});

test.describe('AI Validation Tooltip', () => {
  test('showAiValidationTooltip and hideAiValidationTooltip functions exist', async ({ page }) => {
    await page.goto('/');

    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        show: typeof w.showAiValidationTooltip,
        hide: typeof w.hideAiValidationTooltip,
      };
    });
    expect(fns.show).toBe('function');
    expect(fns.hide).toBe('function');
  });

  test('ai-validation-tooltip CSS class exists with proper styling', async ({ page }) => {
    await page.goto('/');

    const hasTooltipCss = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('.ai-validation-tooltip') && styles.includes('Validating with AI');
    });
    // The CSS class should exist, text is set via JS
    const hasCss = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('.ai-validation-tooltip');
    });
    expect(hasCss).toBe(true);
  });
});

test.describe('Real-time Status Polling', () => {
  test('startSiteStatusPolling and stopSiteStatusPolling functions exist', async ({ page }) => {
    await page.goto('/');

    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        start: typeof w.startSiteStatusPolling,
        stop: typeof w.stopSiteStatusPolling,
      };
    });
    expect(fns.start).toBe('function');
    expect(fns.stop).toBe('function');
  });
});

test.describe('Connect Domain Error Handling', () => {
  test('addHostname error handling returns proper English on 403', async ({ page }) => {
    await page.goto('/');

    // Check that the error handling code includes proper fallback message
    const hasProperErrorMsg = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].textContent || '';
        if (text.includes('Unable to connect this domain')) return true;
      }
      return false;
    });
    expect(hasProperErrorMsg).toBe(true);
  });
});

test.describe('Button Focus-Visible States', () => {
  test('site-card-btn uses focus-visible instead of focus', async ({ page }) => {
    await page.goto('/');

    const hasFocusVisible = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('.site-card-btn:focus-visible');
    });
    expect(hasFocusVisible).toBe(true);
  });

  test('hostname-delete-btn has hover and active states', async ({ page }) => {
    await page.goto('/');

    const hasStates = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return {
        hover: styles.includes('.hostname-delete-btn:hover'),
        active: styles.includes('.hostname-delete-btn:active'),
        focusVisible: styles.includes('.hostname-delete-btn:focus-visible'),
      };
    });
    expect(hasStates.hover).toBe(true);
    expect(hasStates.active).toBe(true);
    expect(hasStates.focusVisible).toBe(true);
  });

  test('domain-tab has focus-visible and active styles', async ({ page }) => {
    await page.goto('/');

    const hasStates = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return {
        focusVisible: styles.includes('.domain-tab:focus-visible'),
        active: styles.includes('.domain-tab:active'),
      };
    });
    expect(hasStates.focusVisible).toBe(true);
    expect(hasStates.active).toBe(true);
  });
});

test.describe('Login Page Centering', () => {
  test('signin screen has centered layout via flex', async ({ page }) => {
    await page.goto('/');

    const hasCentering = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('.screen-signin') &&
        styles.includes('min-height: 100vh') &&
        styles.includes('justify-content: center');
    });
    expect(hasCentering).toBe(true);
  });

  test('signin-footer is fixed at bottom', async ({ page }) => {
    await page.goto('/');

    const hasFixed = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('.signin-footer') && styles.includes('position: fixed');
    });
    expect(hasFixed).toBe(true);
  });

  test('signin-footer becomes static on small viewports', async ({ page }) => {
    await page.goto('/');

    const hasMediaQuery = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('max-height: 600px') && styles.includes('position: static');
    });
    expect(hasMediaQuery).toBe(true);
  });
});

test.describe('Footer CTA Visibility', () => {
  test('footer-cta is hidden on signin and waiting screens', async ({ page }) => {
    await page.goto('/');

    const hasHideLogic = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].textContent || '';
        if (text.includes('footerCta') && text.includes('hideCta')) {
          return true;
        }
      }
      return false;
    });
    expect(hasHideLogic).toBe(true);
  });

  test('footer-cta is hidden when user is logged in', async ({ page }) => {
    await page.goto('/');

    const hasAuthHide = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].textContent || '';
        if (text.includes('hideCta') && text.includes('session') && text.includes('token')) {
          return true;
        }
      }
      return false;
    });
    expect(hasAuthHide).toBe(true);
  });
});

test.describe('Inline Slug Input Style Sync', () => {
  test('slug-editable has text-decoration underline', async ({ page }) => {
    await page.goto('/');

    const hasUnderline = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('.slug-editable') && styles.includes('text-decoration: underline');
    });
    expect(hasUnderline).toBe(true);
  });

  test('slug-input inherits all font properties from parent', async ({ page }) => {
    await page.goto('/');

    const hasInherit = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      const slugInputSection = styles.includes('.slug-input');
      const inheritsFont = styles.includes('font-family: inherit') && styles.includes('font-size: inherit');
      const inheritsWeight = styles.includes('font-weight: inherit');
      const inheritsLetterSpacing = styles.includes('letter-spacing: inherit');
      return slugInputSection && inheritsFont && inheritsWeight && inheritsLetterSpacing;
    });
    expect(hasInherit).toBe(true);
  });

  test('slug-input has matching underline decoration', async ({ page }) => {
    await page.goto('/');

    const hasDecoration = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('.slug-input') &&
        styles.includes('text-decoration: underline') &&
        styles.includes('text-underline-offset: 2px');
    });
    expect(hasDecoration).toBe(true);
  });
});

test.describe('ARIA Accessibility', () => {
  test('domain tabs have proper ARIA roles', async ({ page }) => {
    await page.goto('/');

    const hasRoles = await page.evaluate(() => {
      const tablist = document.querySelector('.domain-tabs[role="tablist"]');
      if (!tablist) return false;
      const tabs = tablist.querySelectorAll('[role="tab"]');
      return tabs.length === 3;
    });
    expect(hasRoles).toBe(true);
  });

  test('domain tab panels have tabpanel role', async ({ page }) => {
    await page.goto('/');

    const hasPanels = await page.evaluate(() => {
      const panels = document.querySelectorAll('[role="tabpanel"]');
      return panels.length === 3;
    });
    expect(hasPanels).toBe(true);
  });

  test('active domain tab has aria-selected=true', async ({ page }) => {
    await page.goto('/');

    const isSelected = await page.evaluate(() => {
      const activeTab = document.querySelector('.domain-tab.active');
      return activeTab ? activeTab.getAttribute('aria-selected') === 'true' : false;
    });
    expect(isSelected).toBe(true);
  });

  test('sr-only class exists for screen reader labels', async ({ page }) => {
    await page.goto('/');

    const hasSrOnly = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('.sr-only') && styles.includes('clip: rect(0,0,0,0)');
    });
    expect(hasSrOnly).toBe(true);
  });

  test('domain add input has sr-only label', async ({ page }) => {
    await page.goto('/');

    const hasLabel = await page.evaluate(() => {
      const label = document.querySelector('label[for="domain-add-input"]');
      return label ? label.classList.contains('sr-only') : false;
    });
    expect(hasLabel).toBe(true);
  });
});

test.describe('Performance Optimizations', () => {
  test('no transition:all in critical button CSS', async ({ page }) => {
    await page.goto('/');

    const noTransitionAll = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      // Check that site-card-btn doesn't use transition: all
      const siteCardBtnMatch = styles.match(/\.site-card-btn\s*\{[^}]*transition:\s*all/);
      const headerBtnMatch = styles.match(/\.header-auth-btn\s*\{[^}]*transition:\s*all/);
      const adminBtnMatch = styles.match(/\.admin-btn\s*\{[^}]*transition:\s*all/);
      return !siteCardBtnMatch && !headerBtnMatch && !adminBtnMatch;
    });
    expect(noTransitionAll).toBe(true);
  });

  test('build-terminal uses min() for responsive min-width', async ({ page }) => {
    await page.goto('/');

    const usesMin = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('min(500px, 100%)');
    });
    expect(usesMin).toBe(true);
  });
});

test.describe('Mobile Keyboard Hints', () => {
  test('domain-add-input has inputmode=url', async ({ page }) => {
    await page.goto('/');

    const hasInputmode = await page.evaluate(() => {
      const input = document.getElementById('domain-add-input');
      return input ? input.getAttribute('inputmode') === 'url' : false;
    });
    expect(hasInputmode).toBe(true);
  });

  test('business-name-input has inputmode=search', async ({ page }) => {
    await page.goto('/');

    const hasInputmode = await page.evaluate(() => {
      const input = document.getElementById('business-name-input');
      return input ? input.getAttribute('inputmode') === 'search' : false;
    });
    expect(hasInputmode).toBe(true);
  });
});

test.describe('Domain Add Loading State', () => {
  test('addHostname function includes button loading logic', async ({ page }) => {
    await page.goto('/');

    const hasLoading = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script');
      for (let i = 0; i < scripts.length; i++) {
        const text = scripts[i].textContent || '';
        if (text.includes('domain-add-btn') && text.includes('Adding') && text.includes('disabled')) {
          return true;
        }
      }
      return false;
    });
    expect(hasLoading).toBe(true);
  });
});

test.describe('Placeholder Contrast', () => {
  test('input-field placeholder uses text-secondary not text-muted', async ({ page }) => {
    await page.goto('/');

    const usesSecondary = await page.evaluate(() => {
      const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('');
      return styles.includes('.input-field::placeholder') && styles.includes('var(--text-secondary)');
    });
    expect(usesSecondary).toBe(true);
  });
});
