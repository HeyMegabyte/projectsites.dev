import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:4300';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'node scripts/e2e_server.cjs',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
