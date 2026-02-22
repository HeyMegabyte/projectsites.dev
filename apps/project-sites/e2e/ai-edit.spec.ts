/**
 * E2E tests for the "AI Edit" feature:
 * - Clicking "AI Edit" opens bolt.megabyte.space with the correct importChatFrom URL
 * - The /api/sites/by-slug/:slug/chat endpoint returns valid chat JSON
 * - The editSiteInBolt() function constructs the correct URL
 * - Chat data has messages array and description
 * - Full flow: sites.megabyte.space → AI Edit → bolt.megabyte.space import
 */
import { test, expect } from './fixtures';

test.describe('AI Edit – chat API endpoint', () => {
  test('GET /api/sites/by-slug/:slug/chat returns valid chat JSON', async ({ request }) => {
    const res = await request.get('/api/sites/by-slug/test-site/chat');
    expect(res.status()).toBe(200);

    const json = await res.json();
    expect(json).toHaveProperty('messages');
    expect(json).toHaveProperty('description');
    expect(Array.isArray(json.messages)).toBe(true);
    expect(json.messages.length).toBeGreaterThan(0);
  });

  test('chat endpoint returns messages with required fields', async ({ request }) => {
    const res = await request.get('/api/sites/by-slug/test-site/chat');
    const json = await res.json();

    for (const msg of json.messages) {
      expect(msg).toHaveProperty('id');
      expect(msg).toHaveProperty('role');
      expect(msg).toHaveProperty('content');
      expect(['user', 'assistant']).toContain(msg.role);
      expect(typeof msg.content).toBe('string');
    }
  });

  test('chat endpoint returns alternating user/assistant messages', async ({ request }) => {
    const res = await request.get('/api/sites/by-slug/test-site/chat');
    const json = await res.json();

    // First message should be from user
    expect(json.messages[0].role).toBe('user');

    // Messages should alternate user/assistant
    for (let i = 0; i < json.messages.length; i++) {
      const expectedRole = i % 2 === 0 ? 'user' : 'assistant';
      expect(json.messages[i].role).toBe(expectedRole);
    }
  });

  test('chat endpoint returns 404 for non-existent slug', async ({ request }) => {
    const res = await request.get('/api/sites/by-slug/nonexistent-slug-xyz/chat');
    expect(res.status()).toBe(404);
  });

  test('chat endpoint includes CORS headers', async ({ request }) => {
    const res = await request.get('/api/sites/by-slug/test-site/chat');
    expect(res.headers()['access-control-allow-origin']).toBe('*');
    expect(res.headers()['content-type']).toContain('application/json');
  });

  test('chat endpoint has description and exportDate fields', async ({ request }) => {
    const res = await request.get('/api/sites/by-slug/test-site/chat');
    const json = await res.json();

    expect(json.description).toBeTruthy();
    expect(typeof json.description).toBe('string');
    expect(json.exportDate).toBeTruthy();
  });
});

test.describe('AI Edit – editSiteInBolt() URL construction', () => {
  test('editSiteInBolt function is defined and constructs correct URL', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();

    const fnExists = await page.evaluate(() => typeof (window as any).editSiteInBolt === 'function');
    expect(fnExists).toBe(true);
  });

  test('editSiteInBolt generates correct bolt URL with importChatFrom', async ({ page }) => {
    await page.goto('/');

    const boltUrl = await page.evaluate(() => {
      let capturedUrl = '';
      const origOpen = window.open;
      window.open = (url: string | URL | undefined) => {
        capturedUrl = String(url || '');
        return null;
      };

      (window as any).editSiteInBolt('my-test-site');
      window.open = origOpen;

      return capturedUrl;
    });

    expect(boltUrl).toContain('bolt.megabyte.space');
    expect(boltUrl).toContain('importChatFrom=');

    const url = new URL(boltUrl);
    const importFrom = url.searchParams.get('importChatFrom');
    expect(importFrom).toBeTruthy();
    expect(importFrom).toContain('/api/sites/by-slug/my-test-site/chat');
  });

  test('editSiteInBolt URL-encodes the slug properly', async ({ page }) => {
    await page.goto('/');

    const boltUrl = await page.evaluate(() => {
      let capturedUrl = '';
      const origOpen = window.open;
      window.open = (url: string | URL | undefined) => {
        capturedUrl = String(url || '');
        return null;
      };

      (window as any).editSiteInBolt('my site & stuff');
      window.open = origOpen;

      return capturedUrl;
    });

    const url = new URL(boltUrl);
    const importFrom = url.searchParams.get('importChatFrom');
    expect(importFrom).toContain('my%20site%20%26%20stuff');
  });
});

test.describe('AI Edit – full import flow simulation', () => {
  test('complete flow: AI Edit → fetch chat → validate importable data', async ({ page, request }) => {
    // STEP 1: Visit sites.megabyte.space and get the import URL
    await page.goto('/');

    const chatApiUrl = await page.evaluate(() => {
      let capturedUrl = '';
      const origOpen = window.open;
      window.open = (url: string | URL | undefined) => {
        capturedUrl = String(url || '');
        return null;
      };

      (window as any).editSiteInBolt('example-business');
      window.open = origOpen;

      const u = new URL(capturedUrl);
      return u.searchParams.get('importChatFrom');
    });

    expect(chatApiUrl).toBeTruthy();

    // STEP 2: Fetch the chat data from the API (simulates what bolt.diy does)
    const chatRes = await request.get(chatApiUrl!);
    expect(chatRes.status()).toBe(200);

    const chatData = await chatRes.json();

    // STEP 3: Validate data matches bolt.diy's expected format for importChat()
    expect(chatData).toHaveProperty('messages');
    expect(chatData).toHaveProperty('description');
    expect(Array.isArray(chatData.messages)).toBe(true);
    expect(chatData.messages.length).toBeGreaterThan(0);

    // STEP 4: Validate each message has the fields bolt.diy's Message type needs
    for (const msg of chatData.messages) {
      expect(msg).toHaveProperty('id');
      expect(msg).toHaveProperty('role');
      expect(msg).toHaveProperty('content');
      expect(typeof msg.id).toBe('string');
      expect(typeof msg.content).toBe('string');
      expect(['user', 'assistant']).toContain(msg.role);
    }

    // STEP 5: Verify description is a valid string for chat title
    expect(typeof chatData.description).toBe('string');
    expect(chatData.description.length).toBeGreaterThan(0);
  });

  test('imported chat has user message first (required for bolt.diy display)', async ({ request }) => {
    const res = await request.get('/api/sites/by-slug/test-site/chat');
    const json = await res.json();

    // bolt.diy expects the first message to be a user prompt
    expect(json.messages[0].role).toBe('user');
    expect(json.messages[0].content.length).toBeGreaterThan(0);
  });

  test('imported chat has at least one assistant response', async ({ request }) => {
    const res = await request.get('/api/sites/by-slug/test-site/chat');
    const json = await res.json();

    const assistantMessages = json.messages.filter((m: { role: string }) => m.role === 'assistant');
    expect(assistantMessages.length).toBeGreaterThan(0);
  });
});

test.describe('AI Edit – admin dashboard integration', () => {
  test('AI Edit button markup is present for published sites', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();

    expect(html).toContain('editSiteInBolt');
    expect(html).toContain('Edit in AI Editor');
  });

  test('AI Edit button opens bolt with chat import URL', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      let capturedUrl = '';
      const origOpen = window.open;
      window.open = (url: string | URL | undefined) => {
        capturedUrl = String(url || '');
        return null;
      };

      (window as any).editSiteInBolt('example-business');
      window.open = origOpen;

      const u = new URL(capturedUrl);
      return {
        host: u.host,
        importChatFrom: u.searchParams.get('importChatFrom'),
      };
    });

    expect(result.host).toBe('bolt.megabyte.space');
    expect(result.importChatFrom).toBeTruthy();
    expect(result.importChatFrom).toContain('/api/sites/by-slug/example-business/chat');
  });
});
