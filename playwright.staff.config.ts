import { defineConfig } from '@playwright/test';

// Throwaway runner for the staff-management UI spec against staging using a
// pre-supplied session (.auth/portal.json). Not part of the committed suite.
export default defineConfig({
  testDir: './tests',
  testMatch: /staff-management\.spec\.ts/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: 'list',
  use: {
    baseURL: 'https://portal.krawings.de',
    storageState: '.auth/portal.json',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
