/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vitest-angular/plugin';

export default defineConfig({
  plugins: [angular()],
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
});
