import { defineConfig } from '@playwright/test';

// Throwaway runner for the manager full-profile edit spec against staging.
export default defineConfig({
  testDir: './tests',
  testMatch: /profile-edit\.spec\.ts/,
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
