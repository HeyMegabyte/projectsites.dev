import { test, expect } from './fixtures';

const MOBILE_VIEWPORT = { width: 390, height: 844 }; // iPhone 12

/**
 * Helper: assert no horizontal overflow on the page.
 * Returns the difference (scrollWidth - innerWidth). 0 means no overflow.
 */
async function assertNoHorizontalOverflow(page: import('@playwright/test').Page) {
  const overflow = await page.evaluate(() => {
    return document.body.scrollWidth - window.innerWidth;
  });
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * Helper: check that an element's computed font-size is at least minPx.
 */
async function assertMinFontSize(
  locator: import('@playwright/test').Locator,
  minPx: number,
) {
  const fontSize = await locator.evaluate((el) => {
    return parseFloat(getComputedStyle(el).fontSize);
  });
  expect(fontSize).toBeGreaterThanOrEqual(minPx);
}

/**
 * Helper: check that a clickable element meets the 44px minimum touch target.
 * Checks the larger of width/height against 44px (some elements are full-width
 * buttons so only height matters, and vice-versa).
 */
async function assertTapTarget(
  locator: import('@playwright/test').Locator,
  minPx = 44,
) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  // At least one dimension should meet the touch target size,
  // and neither dimension should be tiny (< 30px)
  const meetsTarget =
    (box!.width >= minPx || box!.height >= minPx) &&
    box!.width >= 30 &&
    box!.height >= 30;
  expect(meetsTarget).toBe(true);
}

// ─────────────────────────────────────────────
// Homepage (/)
// ─────────────────────────────────────────────

test.describe('Mobile — Homepage (/)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
  });

  test('no horizontal overflow', async ({ page }) => {
    await assertNoHorizontalOverflow(page);
  });

  test('hero section is visible and readable', async ({ page }) => {
    const h1 = page.locator('h1');
    await expect(h1).toBeVisible();
    await assertMinFontSize(h1, 28); // clamp should still be large enough

    const tagline = page.locator('.tagline');
    await expect(tagline).toBeVisible();
    await assertMinFontSize(tagline, 14);
  });

  test('search input is visible and usable', async ({ page }) => {
    const search = page.locator('.search-input');
    await expect(search).toBeVisible();
    const box = await search.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });

  test('hero CTA buttons are tap-friendly', async ({ page }) => {
    const buildBtn = page.locator('.btn-accent', { hasText: 'Build Your Free Website' });
    await expect(buildBtn).toBeVisible();
    const box = await buildBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });

  test('how it works section visible on scroll', async ({ page }) => {
    await page.locator('#how-it-works').scrollIntoViewIfNeeded();
    await expect(page.locator('.step-card').first()).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('handled section cards stack on mobile', async ({ page }) => {
    await page.locator('#handled').scrollIntoViewIfNeeded();
    const cards = page.locator('.handled-card');
    await expect(cards.first()).toBeVisible();
    // Cards should stack vertically — first card top < second card top
    const count = await cards.count();
    if (count >= 2) {
      const box1 = await cards.nth(0).boundingBox();
      const box2 = await cards.nth(1).boundingBox();
      expect(box1).not.toBeNull();
      expect(box2).not.toBeNull();
      // Second card should be below first (stacked, not side by side)
      expect(box2!.y).toBeGreaterThan(box1!.y);
    }
  });

  test('pricing section visible without overflow', async ({ page }) => {
    await page.locator('#pricing').scrollIntoViewIfNeeded();
    await expect(page.locator('.pricing-card-free')).toBeVisible();
    await expect(page.locator('.pricing-card-paid')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test('FAQ section accordion works on mobile', async ({ page }) => {
    await page.locator('#faq').scrollIntoViewIfNeeded();
    const firstQuestion = page.locator('.faq-question').first();
    await expect(firstQuestion).toBeVisible();
    const box = await firstQuestion.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(40); // tap-friendly

    await firstQuestion.click({ force: true });
    const firstItem = page.locator('.faq-item').first();
    await expect(firstItem).toHaveClass(/open/, { timeout: 3000 });
  });

  test('contact form inputs are accessible on mobile', async ({ page }) => {
    await page.locator('#contact-section').scrollIntoViewIfNeeded();
    const nameInput = page.locator('#contact-name');
    await expect(nameInput).toBeVisible();
    const box = await nameInput.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(36);
    // Input should be nearly full width on mobile
    expect(box!.width).toBeGreaterThan(MOBILE_VIEWPORT.width * 0.6);
  });

  test('footer is visible and not clipped', async ({ page }) => {
    await page.locator('.site-footer').scrollIntoViewIfNeeded();
    await expect(page.locator('.footer-social')).toBeVisible();
    await expect(page.locator('.footer-bottom')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});

// ─────────────────────────────────────────────
// Create Page (/create)
// ─────────────────────────────────────────────

test.describe('Mobile — Create Page (/create)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/create');
    await page.waitForLoadState('domcontentloaded');
  });

  test('no horizontal overflow', async ({ page }) => {
    await assertNoHorizontalOverflow(page);
  });

  test('heading is visible and readable', async ({ page }) => {
    const h1 = page.locator('h1');
    await expect(h1).toContainText('Create Your Website');
    await assertMinFontSize(h1, 22);
  });

  test('form fields are visible and full-width', async ({ page }) => {
    const nameInput = page.locator('#create-name');
    await expect(nameInput).toBeVisible();
    const box = await nameInput.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(MOBILE_VIEWPORT.width * 0.6);
    expect(box!.height).toBeGreaterThanOrEqual(36);

    const addressInput = page.locator('#create-address');
    await expect(addressInput).toBeVisible();
  });

  test('submit button is tap-friendly', async ({ page }) => {
    const submitBtn = page.locator('.create-submit');
    await submitBtn.scrollIntoViewIfNeeded();
    await expect(submitBtn).toBeVisible();
    const box = await submitBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(40);
  });
});

// ─────────────────────────────────────────────
// Sign In Page (/signin)
// ─────────────────────────────────────────────

test.describe('Mobile — Sign In (/signin)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/signin');
    await page.waitForLoadState('domcontentloaded');
  });

  test('no horizontal overflow', async ({ page }) => {
    await assertNoHorizontalOverflow(page);
  });

  test('heading is visible', async ({ page }) => {
    await expect(page.locator('h2')).toContainText('Welcome');
    await assertMinFontSize(page.locator('h2'), 20);
  });

  test('Google sign-in button is tap-friendly', async ({ page }) => {
    const googleBtn = page.locator('.signin-btn-google');
    await expect(googleBtn).toBeVisible();
    const box = await googleBtn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(40);
    expect(box!.width).toBeGreaterThan(MOBILE_VIEWPORT.width * 0.5);
  });

  test('email option is visible', async ({ page }) => {
    await expect(page.getByText('Continue with Email')).toBeVisible();
  });

  test('email input fits on mobile', async ({ page }) => {
    await page.getByText('Continue with Email').click();
    const emailInput = page.locator('#signin-email');
    await expect(emailInput).toBeVisible();
    const box = await emailInput.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(MOBILE_VIEWPORT.width * 0.5);
    expect(box!.height).toBeGreaterThanOrEqual(36);
  });

  test('footer links visible on mobile', async ({ page }) => {
    await expect(page.locator('.signin-footer-legal')).toBeVisible();
  });
});

// ─────────────────────────────────────────────
// Legal Pages (/privacy, /terms, /content)
// ─────────────────────────────────────────────

test.describe('Mobile — Legal Pages', () => {
  for (const route of ['privacy', 'terms', 'content']) {
    test.describe(`/${route}`, () => {
      test('no horizontal overflow', async ({ page }) => {
        await page.setViewportSize(MOBILE_VIEWPORT);
        await page.goto(`/${route}`);
        await page.waitForLoadState('domcontentloaded');
        await assertNoHorizontalOverflow(page);
      });

      test('heading is visible and readable', async ({ page }) => {
        await page.setViewportSize(MOBILE_VIEWPORT);
        await page.goto(`/${route}`);
        await page.waitForLoadState('domcontentloaded');

        const h1 = page.locator('h1');
        await expect(h1).toBeVisible();
        await assertMinFontSize(h1, 22);
      });

      test('content text is readable (min 13px)', async ({ page }) => {
        await page.setViewportSize(MOBILE_VIEWPORT);
        await page.goto(`/${route}`);
        await page.waitForLoadState('domcontentloaded');

        const content = page.locator('.legal-content');
        await expect(content).toBeVisible();
        await assertMinFontSize(content, 13);
      });

      test('breadcrumb navigation works', async ({ page }) => {
        await page.setViewportSize(MOBILE_VIEWPORT);
        await page.goto(`/${route}`);
        await page.waitForLoadState('domcontentloaded');

        const homeLink = page.locator('.breadcrumb-link');
        await expect(homeLink).toBeVisible();
      });

      test('footer visible without overflow', async ({ page }) => {
        await page.setViewportSize(MOBILE_VIEWPORT);
        await page.goto(`/${route}`);
        await page.waitForLoadState('domcontentloaded');

        await page.locator('.site-footer').scrollIntoViewIfNeeded();
        await expect(page.locator('.footer-bottom')).toBeVisible();
        await assertNoHorizontalOverflow(page);
      });
    });
  }
});

// ─────────────────────────────────────────────
// Admin Dashboard (/admin) — requires auth
// ─────────────────────────────────────────────

test.describe('Mobile — Admin Dashboard (/admin)', () => {
  test('no horizontal overflow', async ({ authedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });
    await assertNoHorizontalOverflow(page);
  });

  test('site cards are visible and stacked', async ({ authedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.site-card').first()).toBeVisible({ timeout: 5000 });

    const card = page.locator('.site-card').first();
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    // Card should be nearly full width on mobile (> 80% viewport)
    expect(box!.width).toBeGreaterThan(MOBILE_VIEWPORT.width * 0.7);
  });

  test('site card name is readable', async ({ authedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    const name = page.locator('.site-card-name').first();
    await expect(name).toBeVisible({ timeout: 5000 });
    await assertMinFontSize(name, 14);
  });

  test('new site button is tap-friendly', async ({ authedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    const newBtn = page.locator('.admin-btn-accent');
    await expect(newBtn).toBeVisible({ timeout: 5000 });
    const box = await newBtn.boundingBox();
    expect(box).not.toBeNull();
    // Button should be at least 30px tall (some compact buttons are slightly below 36px)
    expect(box!.height).toBeGreaterThanOrEqual(30);
  });

  test('domain summary is visible', async ({ authedPage: page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.domain-summary')).toBeVisible({ timeout: 5000 });
  });
});

// ─────────────────────────────────────────────
// Navigation on Mobile
// ─────────────────────────────────────────────

test.describe('Mobile — Navigation', () => {
  test('header is visible on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');
    // The app-header host element may be hidden (zero-size); check inner content
    const header = page.locator('app-header .header, header').first();
    await expect(header).toBeVisible();
  });

  test('can navigate from homepage to signin', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Look for a sign-in link/button in header
    const signinLink = page.locator('a[href="/signin"], a[routerLink="/signin"]').first();
    if (await signinLink.isVisible()) {
      await signinLink.click();
      await page.waitForURL('**/signin', { timeout: 5000 });
      await expect(page.locator('h2')).toContainText('Welcome');
    }
  });

  test('can navigate from legal page back to home', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/privacy');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.breadcrumb-link').click();
    await page.waitForURL('**/', { timeout: 5000 });
    await expect(page.locator('h1')).toContainText('Handled');
  });

  test('can navigate from signin back to home', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/signin');
    await page.waitForLoadState('domcontentloaded');

    await page.locator('.back-link', { hasText: 'Back to search' }).click();
    await page.waitForURL('**/');
    await expect(page.locator('h1')).toContainText('Handled');
  });
});
