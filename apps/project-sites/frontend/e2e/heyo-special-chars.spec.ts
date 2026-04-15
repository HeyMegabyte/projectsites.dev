import { test, expect } from './fixtures';

test.describe('Special Characters Build — 택배 HEYO / EXPRESS HEYO', () => {
  test.describe.configure({ mode: 'serial' });

  test('create site with special characters navigates to waiting', async ({ authedPage: page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const t = msg.text();
        if (t.includes('favicon') || t.includes('net::ERR') || t.includes('404')) return;
        errors.push(t);
      }
    });

    await page.goto('/create');
    await page.waitForLoadState('networkidle');

    await page.fill('#create-name', '택배 HEYO / EXPRESS HEYO');
    await page.fill('#create-address', '123 Express Ln, Seoul District, NJ 07000');

    const nameValue = await page.locator('#create-name').inputValue();
    expect(nameValue).toBe('택배 HEYO / EXPRESS HEYO');

    await page.locator('.create-submit').click();

    await page.waitForURL('**/waiting**', { timeout: 10000 });
    expect(page.url()).toContain('/waiting');
    expect(page.url()).toContain('slug=');

    const url = new URL(page.url(), 'http://localhost');
    const slug = url.searchParams.get('slug') || '';
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug).toContain('heyo');

    await expect(page.locator('.waiting-card')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.spinner')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('multiple special character businesses build without errors', async ({ authedPage: page }) => {
    const specialNames = [
      { name: 'Café André & Fils', address: '100 French St, Montclair, NJ 07042' },
      { name: "O'Brien's Pub & Grill — Est. 1985", address: '200 Irish Way, Hoboken, NJ 07030' },
      { name: '日本料理 Sakura 🌸', address: '300 Sushi Blvd, Fort Lee, NJ 07024' },
      { name: 'Müller & Schmidt GmbH', address: '400 German Ave, Newark, NJ 07102' },
    ];

    for (const biz of specialNames) {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const t = msg.text();
          if (t.includes('favicon') || t.includes('net::ERR') || t.includes('404')) return;
          errors.push(t);
        }
      });

      await page.goto('/create');
      await page.waitForLoadState('networkidle');
      await page.fill('#create-name', biz.name);
      await page.fill('#create-address', biz.address);

      const val = await page.locator('#create-name').inputValue();
      expect(val).toBe(biz.name);

      await page.locator('.create-submit').click();
      await page.waitForURL('**/waiting**', { timeout: 10000 });

      const url = new URL(page.url(), 'http://localhost');
      const slug = url.searchParams.get('slug') || '';
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(slug.length).toBeGreaterThan(0);

      await expect(page.locator('.spinner')).toBeVisible({ timeout: 10000 });
      expect(errors).toEqual([]);
    }
  });
});
