import { defineConfig } from '@playwright/test';

// Throwaway runner: all four staff-management UI specs against staging with a
// pre-supplied admin session (.auth/portal.json). Sequential (workers:1) so the
// mutating specs don't overlap. Not part of the committed suite.
export default defineConfig({
  testDir: './tests',
  testMatch: /(staff-management|dept-roles|contract-hours|timeoff)\.spec\.ts/,
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
