import { defineConfig } from '@playwright/test';

// Throwaway runner for the Phase 4 (time off) UI spec against staging using a
// pre-supplied admin session (.auth/portal.json). Not part of the committed suite.
export default defineConfig({
  testDir: './tests',
  testMatch: /timeoff\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: 'list',
  use: {
    baseURL: 'https://portal.krawings.de',
    storageState: '.auth/portal.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
