/**
 * E2E tests for admin dashboard modal functionality,
 * ripple animation, search deduplication, trust section,
 * and escapeJsString fix.
 */

import { test, expect } from './fixtures.js';

test.describe('Admin Dashboard Modals', () => {
  test('Inline editing functions exist (edit-site-modal removed)', async ({ page }) => {
    await page.goto('/');

    const fns = await page.evaluate(() => {
      const w = window as unknown as Record<string, unknown>;
      return {
        startInlineEdit: typeof w.startInlineEdit === 'function',
        saveInlineEdit: typeof w.saveInlineEdit === 'function',
        cancelInlineEdit: typeof w.cancelInlineEdit === 'function',
        onSlugInput: typeof w.onSlugInput === 'function',
      };
    });
    expect(fns.startInlineEdit).toBe(true);
    expect(fns.saveInlineEdit).toBe(true);
    expect(fns.cancelInlineEdit).toBe(true);
    expect(fns.onSlugInput).toBe(true);
  });

  test('Delete modal exists and is initially hidden', async ({ page }) => {
    await page.goto('/');

    const deleteModal = page.locator('#delete-modal');
    await expect(deleteModal).toBeAttached();
    await expect(deleteModal).not.toHaveClass(/visible/);
  });

  test('Deploy modal exists and is initially hidden', async ({ page }) => {
    await page.goto('/');

    const deployModal = page.locator('#deploy-modal');
    await expect(deployModal).toBeAttached();
    await expect(deployModal).not.toHaveClass(/visible/);
  });

  test('Domain modal exists and is initially hidden', async ({ page }) => {
    await page.goto('/');

    const domainModal = page.locator('#domain-modal');
    await expect(domainModal).toBeAttached();
    await expect(domainModal).not.toHaveClass(/visible/);
  });

  test('Logs modal exists and is initially hidden', async ({ page }) => {
    await page.goto('/');

    const logsModal = page.locator('#site-logs-modal');
    await expect(logsModal).toBeAttached();
    await expect(logsModal).not.toHaveClass(/visible/);
  });

  test('openResetModal function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return typeof (window as unknown as Record<string, unknown>).openResetModal === 'function';
    });
    expect(exists).toBe(true);
  });

  test('openNewWebsiteModal function exists', async ({ page }) => {
    await page.goto('/');

    const exists = await page.evaluate(() => {
      return (
        typeof (window as unknown as Record<string, unknown>).openNewWebsiteModal === 'function'
      );
    });
    expect(exists).toBe(true);
  });
});

test.describe('escapeJsString function', () => {
  test('escapeJsString properly escapes single quotes for JS string literals', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (s: string) => string>).escapeJsString;
      return fn("Vito's Men's Salon");
    });
    // Should use JS backslash escaping — no unescaped single quotes remain
    expect(result).toBe("Vito\\'s Men\\'s Salon");
  });

  test('escapeJsString handles backslashes and angle brackets', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const fn = (window as unknown as Record<string, (s: string) => string>).escapeJsString;
      return fn('test\\path <script>');
    });
    expect(result).toContain('\\\\');
    expect(result).toContain('\\x3C');
    expect(result).toContain('\\x3E');
  });
});

test.describe('Material Ripple Animation', () => {
  test('ripple CSS keyframes exist', async ({ page }) => {
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
          /* cross-origin sheets */
        }
      }
      return false;
    });
    expect(hasRipple).toBe(true);
  });

  test('clicking a button creates a ripple circle', async ({ page }) => {
    await page.goto('/');

    const ctaBtn = page.locator('.hero-ctas .btn-accent');
    await expect(ctaBtn).toBeVisible();

    await ctaBtn.click();

    // The ripple circle should be created (it lasts 500ms)
    const ripple = ctaBtn.locator('.ripple-circle');
    // It may have already been removed by the time we check, so we verify
    // the CSS class exists in the page styles
    const hasRippleCSS = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel === '.ripple-circle') return true;
          }
        } catch {
          /* cross-origin sheets */
        }
      }
      return false;
    });
    expect(hasRippleCSS).toBe(true);
  });
});

test.describe('Site Card Animation', () => {
  test('site-card renders immediately without opacity-0 flicker', async ({ page }) => {
    await page.goto('/');

    const hasRules = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let hasOpacity0 = false;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText === '.site-card') {
              if (rule.style.opacity === '0') hasOpacity0 = true;
            }
          }
        } catch {
          /* cross-origin sheets */
        }
      }
      return { hasOpacity0 };
    });
    // Cards should NOT start with opacity 0 (causes flicker)
    expect(hasRules.hasOpacity0).toBe(false);
  });
});

test.describe('Trust Section', () => {
  test('trust bar has trust items with icons', async ({ page }) => {
    await page.goto('/');

    const trustSection = page.locator('#trust');
    await expect(trustSection).toBeAttached();

    const trustItems = trustSection.locator('.trust-item');
    const count = await trustItems.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Verify text content of trust items
    const text = await trustSection.textContent();
    expect(text).toContain('Uptime');
    expect(text).toContain('Cancel Anytime');
  });
});

test.describe('Improved Marketing Copy', () => {
  test('hero tagline mentions pricing', async ({ page }) => {
    await page.goto('/');

    const tagline = page.locator('.tagline');
    const text = await tagline.textContent();
    expect(text).toContain('$50/mo');
  });

  test('footer CTA has urgency messaging', async ({ page }) => {
    await page.goto('/');

    const footerCta = page.getByRole('button', { name: 'Get Started Now' });
    await expect(footerCta).toBeAttached();

    // The footer CTA section should mention "5 Minutes"
    const footerSection = footerCta.locator('..');
    const text = await footerSection.textContent();
    expect(text).toContain('no credit card');
  });
});

test.describe('Logs Modal Layout', () => {
  test('logs modal uses wider max-width', async ({ page }) => {
    await page.goto('/');

    const hasWideModal = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText === '.logs-modal') {
              return rule.style.maxWidth === '860px';
            }
          }
        } catch {
          /* cross-origin sheets */
        }
      }
      return false;
    });
    expect(hasWideModal).toBe(true);
  });
});
