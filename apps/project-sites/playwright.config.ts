import { defineConfig } from '@playwright/test';

const baseURL = process.env.BASE_URL || 'http://localhost:8787';

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
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_PATH ||
            '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',
        },
      },
    },
  ],
  webServer: {
    command: 'node scripts/e2e_server.cjs',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
