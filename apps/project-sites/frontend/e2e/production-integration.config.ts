import { defineConfig } from '@playwright/test';

/**
 * Playwright config for production integration tests.
 * These tests run against the real projectsites.dev API — no mock server.
 * Requires PROD_SESSION_TOKEN env var for authentication.
 *
 * Usage:
 *   PROD_SESSION_TOKEN=<token> npx playwright test --config e2e/production-integration.config.ts
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'production-*.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 300000, // 5 min for full build flow
  use: {
    baseURL: 'https://projectsites.dev',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
