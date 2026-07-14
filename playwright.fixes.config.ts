import { defineConfig } from '@playwright/test';

// Throwaway runner for the two employee-card fixes (filter persistence + open
// documents) against staging with a pre-supplied admin session. Not in CI.
export default defineConfig({
  testDir: './tests',
  testMatch: /employee-fixes\.spec\.ts/,
  workers: 1,
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
