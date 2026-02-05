import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'miniflare',
  testEnvironmentOptions: {
    // Miniflare options
    kvNamespaces: ['CACHE_KV'],
    r2Buckets: ['SITES_BUCKET'],
    durableObjects: {
      RATE_LIMITER: 'RateLimiter',
    },
    bindings: {
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'error',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_ANON_KEY: 'test-anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      STRIPE_SECRET_KEY: 'sk_test_test',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_test',
      STRIPE_WEBHOOK_SECRET: 'whsec_test',
      CF_API_TOKEN: 'test-cf-token',
      CF_ZONE_ID: 'test-zone-id',
      CF_ACCOUNT_ID: 'test-account-id',
      SENDGRID_API_KEY: 'test-sendgrid-key',
      GOOGLE_PLACES_API_KEY: 'test-places-key',
      SENTRY_DSN: 'https://test@sentry.io/123',
    },
  },
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest'],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@project-sites/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@project-sites/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
  },
  testMatch: ['**/*.test.ts', '**/*.spec.ts'],
  collectCoverageFrom: [
    '**/src/**/*.{ts,tsx}',
    '!**/src/**/index.ts',
    '!**/node_modules/**',
  ],
  coverageProvider: 'v8',
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
};

export default config;
