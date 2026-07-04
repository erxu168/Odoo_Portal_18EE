import { defineConfig } from '@playwright/test';

// Load local robot credentials for `npm run smoke` on a dev machine.
// In CI these come from GitHub secrets, so a missing file is fine.
try {
  process.loadEnvFile('.env.smoke.local');
} catch {
  /* no local env file — rely on process env (CI) */
}

const ENVS: Record<string, string> = {
  staging: 'https://portal.krawings.de',
  live: 'https://staff.krawings.de',
};

const target = process.env.SMOKE_ENV ?? 'staging';
const baseURL = ENVS[target] ?? ENVS.staging;

export default defineConfig({
  testDir: './tests',
  // Smoke tests hit a remote server; give pages room to load.
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['list']]
    : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'smoke',
      testMatch: /smoke\.spec\.ts/,
      dependencies: ['setup'],
      use: { storageState: '.auth/portal.json' },
    },
    {
      // Module e2e tests that log in themselves (manager + shared tablet) and
      // drive real screens. No storageState dependency. Run: npm run test:inventory
      name: 'modules',
      testMatch: /\.e2e\.spec\.ts/,
      use: { viewport: { width: 390, height: 844 } },
    },
  ],
});
