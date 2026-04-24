import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env['CI'];
const isShard = !!process.env['SHARD_TOTAL'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? (isShard ? 4 : 1) : undefined,
  reporter: isCI
    ? isShard
      ? [['blob', { outputDir: './blob-report' }], ['github']]
      : [['html', { open: 'never' }], ['github']]
    : 'html',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:4300',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/e2e_server.cjs 4300',
    port: 4300,
    reuseExistingServer: !isCI,
    timeout: 10000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(isCI ? {} : {
          channel: 'chrome',
        }),
      },
    },
  ],
});
