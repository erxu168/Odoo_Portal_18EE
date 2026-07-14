import { defineConfig } from '@playwright/test';

// Throwaway runner for the Phase 3 (contracts & hours) UI spec against staging
// using a pre-supplied admin session (.auth/portal.json). Not part of the committed suite.
export default defineConfig({
  testDir: './tests',
  testMatch: /contract-hours\.spec\.ts/,
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
