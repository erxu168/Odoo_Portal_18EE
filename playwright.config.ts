import { defineConfig } from '@playwright/test';
import path from 'path';
import os from 'os';

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
// SMOKE_BASE_URL points a run at any server — e.g. a local dev server with a
// seeded scratch database, when staging's shared fixture accounts can't be
// touched. Named envs stay the default.
const baseURL = process.env.SMOKE_BASE_URL || (ENVS[target] ?? ENVS.staging);

// Unit specs exercise the real SQLite layer. Give EVERY worker its own scratch
// database so they can neither race each other on one file (which made the
// cooktimer specs flaky) nor mutate the developer's live data/portal.db.
// Playwright loads this config in each worker process and sets
// TEST_PARALLEL_INDEX there, so each worker lands on a distinct file.
if (!process.env.PORTAL_DB_PATH) {
  const worker = process.env.TEST_PARALLEL_INDEX ?? '0';
  process.env.PORTAL_DB_PATH = path.join(os.tmpdir(), `krawings-test-portal-${worker}.db`);
}

export default defineConfig({
  testDir: './tests',
  // Smoke tests hit a remote server; give pages room to load (and absorb a
  // cold Next.js start right after a deploy/restart).
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 2 : 0,
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
    {
      // Pure-function unit tests (no browser, no baseURL). Run: npm run test:unit
      name: 'unit',
      testMatch: /\.unit\.spec\.ts/,
    },
  ],
});
