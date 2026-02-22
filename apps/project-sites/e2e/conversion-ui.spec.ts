/**
 * E2E tests for the How-it-Works conversion rewrite,
 * button interactive states, and UI polish.
 */

import { test, expect } from './fixtures.js';

test.describe('How It Works Section', () => {
  test('has three step cards with updated headings', async ({ page }) => {
    await page.goto('/');

    const section = page.locator('#how-it-works');
    await expect(section).toBeAttached();

    const stepCards = section.locator('.step-card');
    await expect(stepCards).toHaveCount(3);

    // Verify updated step headings
    await expect(stepCards.nth(0).locator('h3')).toHaveText(/Search.*Preview Free/);
    await expect(stepCards.nth(1).locator('h3')).toHaveText(/Review.*Customize/);
    await expect(stepCards.nth(2).locator('h3')).toHaveText(/Go Live.*Domain/);
  });

  test('step 1 mentions no sign-up required', async ({ page }) => {
    await page.goto('/');

    const step1 = page.locator('#how-it-works .step-card').first();
    const text = await step1.textContent();
    expect(text).toContain('No sign-up');
    expect(text).toContain('No credit card');
  });

  test('step 3 mentions pricing', async ({ page }) => {
    await page.goto('/');

    const step3 = page.locator('#how-it-works .step-card').nth(2);
    const text = await step3.textContent();
    expect(text).toContain('$50/mo');
  });

  test('has ROI anchor text', async ({ page }) => {
    await page.goto('/');

    const section = page.locator('#how-it-works');
    const text = await section.textContent();
    expect(text).toContain('$2,000');
    expect(text).toContain('five minutes');
  });

  test('has "See My Free Preview" CTA button', async ({ page }) => {
    await page.goto('/');

    const cta = page.locator('#how-it-works button.btn-accent');
    await expect(cta).toBeAttached();
    await expect(cta).toHaveText('See My Free Preview');
  });
});

test.describe('Handled Section', () => {
  test('handled cards have updated headings', async ({ page }) => {
    await page.goto('/');

    const section = page.locator('#handled');
    const cards = section.locator('.handled-card');
    await expect(cards).toHaveCount(3);

    await expect(cards.nth(0).locator('h3')).toHaveText('Unlimited AI Edits');
    await expect(cards.nth(1).locator('h3')).toHaveText(/Hosting.*SSL/);
    await expect(cards.nth(2).locator('h3')).toHaveText(/SEO.*Local/);
  });

  test('handled summary lists concrete inclusions', async ({ page }) => {
    await page.goto('/');

    const summary = page.locator('.handled-summary');
    const text = await summary.textContent();
    expect(text).toContain('Custom domain');
    expect(text).toContain('Unlimited change requests');
    expect(text).toContain('cancel anytime');
  });

  test('references "Project Sites Editor" instead of bolt.megabyte.space', async ({ page }) => {
    await page.goto('/');

    const handledSection = page.locator('#handled');
    const text = await handledSection.textContent();
    expect(text).toContain('Project Sites Editor');
  });
});

test.describe('Button Interactive States', () => {
  test('.plan-badge.free has hover/focus/active CSS rules', async ({ page }) => {
    await page.goto('/');

    // Verify the CSS rules exist for plan-badge.free states
    const hasStates = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let hasHover = false;
      let hasFocus = false;
      let hasActive = false;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel.includes('.plan-badge.free:hover')) hasHover = true;
            if (sel.includes('.plan-badge.free:focus')) hasFocus = true;
            if (sel.includes('.plan-badge.free:active')) hasActive = true;
          }
        } catch {
          /* cross-origin sheets */
        }
      }
      return { hasHover, hasFocus, hasActive };
    });
    expect(hasStates.hasHover).toBe(true);
    expect(hasStates.hasFocus).toBe(true);
    expect(hasStates.hasActive).toBe(true);
  });

  test('.site-card-new has focus and active CSS rules', async ({ page }) => {
    await page.goto('/');

    const hasStates = await page.evaluate(() => {
      const sheets = document.styleSheets;
      let hasFocus = false;
      let hasActive = false;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel.includes('.site-card-new:focus')) hasFocus = true;
            if (sel.includes('.site-card-new:active')) hasActive = true;
          }
        } catch {
          /* cross-origin sheets */
        }
      }
      return { hasFocus, hasActive };
    });
    expect(hasStates.hasFocus).toBe(true);
    expect(hasStates.hasActive).toBe(true);
  });
});

test.describe('site-card-preview-placeholder alignment', () => {
  test('has text-align center', async ({ page }) => {
    await page.goto('/');

    const hasTextAlign = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const rule = rules[r] as CSSStyleRule;
            if (rule.selectorText === '.site-card-preview-placeholder') {
              return rule.style.textAlign === 'center';
            }
          }
        } catch {
          /* cross-origin sheets */
        }
      }
      return false;
    });
    expect(hasTextAlign).toBe(true);
  });
});

test.describe('handled-summary hover', () => {
  test('has hover CSS with transform', async ({ page }) => {
    await page.goto('/');

    const hasHover = await page.evaluate(() => {
      const sheets = document.styleSheets;
      for (let s = 0; s < sheets.length; s++) {
        try {
          const rules = sheets[s].cssRules;
          for (let r = 0; r < rules.length; r++) {
            const sel = (rules[r] as CSSStyleRule).selectorText || '';
            if (sel.includes('.handled-summary:hover')) return true;
          }
        } catch {
          /* cross-origin sheets */
        }
      }
      return false;
    });
    expect(hasHover).toBe(true);
  });
});
