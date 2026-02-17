/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  transform: { '^.+\\.(t|j)sx?$': ['@swc/jest'] },
  testMatch: ['**/__tests__/**/*.test.ts', '**/*.test.ts'],
  collectCoverageFrom: ['**/src/**/*.{ts,tsx}', '!**/src/**/index.ts'],
  coverageProvider: 'v8',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};

module.exports = config;
