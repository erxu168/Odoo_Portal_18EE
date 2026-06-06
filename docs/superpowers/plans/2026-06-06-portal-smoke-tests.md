# Portal Smoke Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Playwright smoke-test suite to the Krawings Portal that logs in once with a dedicated robot account and verifies every main page loads cleanly, runnable locally with one command and automatically on every push via GitHub Actions.

**Architecture:** A Playwright project lives in the portal repo. A `setup` test logs in via the `/login` form and saves the session to `.auth/portal.json`; a `smoke` test reuses that session and visits each route in an editable list, asserting status < 400, no bounce to `/login`, visible body text, no Next.js error overlay, and no uncaught page errors. The target site (`staging` vs `live`) is selected by the `SMOKE_ENV` env var; robot credentials come from `SMOKE_EMAIL` / `SMOKE_PASSWORD` (local `.env.smoke.local` or GitHub secrets). All checks are read-only.

**Tech Stack:** Next.js portal (existing), Playwright `@playwright/test` (browser already installed on dev machine; Node 22 with built-in `process.loadEnvFile`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-06-portal-smoke-tests-design.md`

**Branch:** Work directly on `main` (portal's normal workflow, confirmed). Commit per task; do not push until the user asks.

---

## File structure

- `playwright.config.ts` (create) — Playwright config: base URL from `SMOKE_ENV`, the `setup` + `smoke` projects, trace/screenshot on failure, loads `.env.smoke.local` if present.
- `tests/routes.ts` (create) — single editable list of routes to smoke-check.
- `tests/auth.setup.ts` (create) — logs in once, saves `.auth/portal.json`.
- `tests/smoke.spec.ts` (create) — visits each route, runs the assertions.
- `.env.smoke.local` (create, git-ignored) — local robot credentials for dev runs.
- `.github/workflows/portal-smoke.yml` (create) — CI: on push to `main` + manual `workflow_dispatch`.
- `package.json` (modify) — add `@playwright/test` devDependency + `smoke*` scripts.
- `.gitignore` (modify) — ignore `/.auth/`, `/test-results/`, `/playwright-report/`, `.env.smoke.local`.

---

## Task 1: Install Playwright and wire up scripts

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add Playwright as a dev dependency**

Run from the repo root:

```bash
cd /Users/ethan/Odoo_Portal_18EE
npm install --save-dev @playwright/test@^1.60.0
```

Expected: `package.json` gains `"@playwright/test"` under `devDependencies`; `package-lock.json` updates.

- [ ] **Step 2: Ensure the Chromium browser binary is installed**

```bash
npx playwright install chromium
```

Expected: "chromium ... downloaded" or "is already installed".

- [ ] **Step 3: Add npm scripts**

In `package.json`, change the `"scripts"` block from:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
```

to:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "smoke": "playwright test",
    "smoke:staging": "SMOKE_ENV=staging playwright test",
    "smoke:live": "SMOKE_ENV=live playwright test"
  },
```

- [ ] **Step 4: Update `.gitignore`**

Append to `.gitignore`:

```gitignore

# playwright smoke tests
/.auth/
/test-results/
/playwright-report/
/playwright/.cache/
.env.smoke.local
```

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json .gitignore
git commit -m "[ADD] krawings-portal: add Playwright dev dependency and smoke scripts"
```

---

## Task 2: Define the route list

**Files:**
- Create: `tests/routes.ts`

- [ ] **Step 1: Create `tests/routes.ts`**

```ts
// The top-level portal pages the smoke test visits.
// Add or remove a line here to change coverage — keep it to pages that
// require login and should always render for the robot account.
export const ROUTES: string[] = [
  '/',             // home / dashboard
  '/hr',
  '/tasks',
  '/manufacturing',
  '/recipes',
  '/inventory',
  '/purchase',
  '/reports',
  '/rentals',
  '/prep-planner',
  '/kds',
  '/admin',
  '/termination',
];
```

- [ ] **Step 2: Commit**

```bash
git add tests/routes.ts
git commit -m "[ADD] krawings-portal: smoke test route list"
```

---

## Task 3: Create the Playwright config

**Files:**
- Create: `playwright.config.ts`

- [ ] **Step 1: Create `playwright.config.ts`**

```ts
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
  ],
});
```

- [ ] **Step 2: Verify the config parses (no credentials needed yet)**

```bash
npx playwright test --list
```

Expected: it prints something. It is OK at this point if it reports it found **no tests** (we haven't written them) — the important thing is it does **not** crash with a config/syntax error. If you see a TypeScript or config error, fix it before moving on.

- [ ] **Step 3: Commit**

```bash
git add playwright.config.ts
git commit -m "[ADD] krawings-portal: Playwright config with staging/live switch"
```

---

## Task 4: Login setup (saves a reusable session)

**Files:**
- Create: `tests/auth.setup.ts`

Login form facts (verified in `src/app/login/page.tsx`): email field
`placeholder="you@example.com"`, password field `placeholder="Enter your
password"`, submit button text `Sign in`. On success the app navigates away
from `/login` (default `/hr`). Labels are not associated with inputs, so we
locate by placeholder, not by label.

- [ ] **Step 1: Create `tests/auth.setup.ts`**

```ts
import { test as setup, expect } from '@playwright/test';

const AUTH_FILE = '.auth/portal.json';

setup('log in to the portal', async ({ page }) => {
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'SMOKE_EMAIL and SMOKE_PASSWORD must be set (see .env.smoke.local or GitHub secrets).',
    );
  }

  // The login page itself must render — covers the public /login check.
  await page.goto('/login');
  await expect(page.getByPlaceholder('you@example.com')).toBeVisible();

  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();

  // Successful login navigates away from /login (default target is /hr).
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
    timeout: 15_000,
  });

  // Guard against the robot account being stuck on a forced password change.
  expect(
    page.url(),
    'robot account was redirected to change-password — set a permanent password for it',
  ).not.toContain('/change-password');

  await page.context().storageState({ path: AUTH_FILE });
});
```

- [ ] **Step 2: Verify the setup test is discovered**

```bash
npx playwright test --list --project=setup
```

Expected: lists `[setup] › tests/auth.setup.ts › log in to the portal`. No run yet (needs credentials).

- [ ] **Step 3: Commit**

```bash
git add tests/auth.setup.ts
git commit -m "[ADD] krawings-portal: Playwright login setup with session reuse"
```

---

## Task 5: The smoke test

**Files:**
- Create: `tests/smoke.spec.ts`

- [ ] **Step 1: Create `tests/smoke.spec.ts`**

```ts
import { test, expect } from '@playwright/test';
import { ROUTES } from './routes';

for (const route of ROUTES) {
  test(`page loads cleanly: ${route}`, async ({ page }) => {
    // Collect uncaught JavaScript errors thrown while the page runs.
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });

    // 1. The server returned a real, non-error response.
    expect(response, `no response received for ${route}`).toBeTruthy();
    expect(
      response!.status(),
      `server returned ${response!.status()} for ${route}`,
    ).toBeLessThan(400);

    // 2. We were not bounced back to the login page (session works).
    expect(
      new URL(page.url()).pathname,
      `got redirected to login when visiting ${route}`,
    ).not.toMatch(/^\/login/);

    // 3. The page shows real content, not a blank/white screen.
    const bodyText = (await page.locator('body').innerText()).trim();
    expect(bodyText.length, `page appears blank at ${route}`).toBeGreaterThan(0);

    // 4. No Next.js crash overlay is present.
    await expect(
      page.locator('nextjs-portal'),
      `Next.js error overlay shown at ${route}`,
    ).toHaveCount(0);

    // 5. No uncaught JavaScript errors fired while loading.
    expect(
      pageErrors,
      `uncaught page errors at ${route}: ${pageErrors.join(' | ')}`,
    ).toHaveLength(0);
  });
}
```

- [ ] **Step 2: Verify all smoke tests are discovered**

```bash
npx playwright test --list --project=smoke
```

Expected: lists one `[smoke]` test per route (13 tests), e.g.
`[smoke] › tests/smoke.spec.ts › page loads cleanly: /hr`. No run yet (needs credentials).

- [ ] **Step 3: Commit**

```bash
git add tests/smoke.spec.ts
git commit -m "[ADD] krawings-portal: page-load smoke test across main routes"
```

---

## Task 6: GitHub Actions workflow

**Files:**
- Create: `.github/workflows/portal-smoke.yml`

- [ ] **Step 1: Create `.github/workflows/portal-smoke.yml`**

```yaml
name: Portal Smoke Test

on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: Which site to test
        type: choice
        options:
          - staging
          - live
        default: staging

jobs:
  smoke:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - run: npx playwright install --with-deps chromium

      - name: Run smoke test
        run: npm run smoke
        env:
          SMOKE_ENV: ${{ github.event.inputs.environment || 'staging' }}
          SMOKE_EMAIL: ${{ secrets.SMOKE_EMAIL }}
          SMOKE_PASSWORD: ${{ secrets.SMOKE_PASSWORD }}

      - name: Upload report on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/portal-smoke.yml
git commit -m "[ADD] krawings-portal: GitHub Actions smoke test on push + manual run"
```

---

## Task 7: Robot account, local credentials, and first real run

This task needs **input from the user** (a robot login). Do not invent
credentials. If the user has not yet created the robot account, stop after
Step 1 and ask them to do so.

**Files:**
- Create: `.env.smoke.local` (git-ignored — never committed)

- [ ] **Step 1: Confirm the robot account exists**

Ask the user for a dedicated robot login (email + password) that can log into
the portal on **both** staging and live. It must be a normal Odoo user allowed
into the portal, with a permanent password (not a forced-change temporary one).

- [ ] **Step 2: Create the local credentials file**

Create `.env.smoke.local` in the repo root (this file is git-ignored):

```bash
SMOKE_EMAIL=robot@krawings.de
SMOKE_PASSWORD=the-robot-password
```

(Replace with the real robot email/password from Step 1.)

- [ ] **Step 3: Run the smoke test against staging**

```bash
npm run smoke:staging
```

Expected: `[setup]` logs in, then 13 `[smoke]` tests report `ok`. If a page
legitimately fails, a screenshot/trace is saved under `test-results/` and an
HTML report under `playwright-report/` — open it with
`npx playwright show-report`.

- [ ] **Step 4: (Optional) Confirm the live target also passes**

```bash
npm run smoke:live
```

Expected: same 13 tests pass against `staff.krawings.de`. (Read-only — safe.)

- [ ] **Step 5: Add the GitHub secrets**

In GitHub → the `Odoo_Portal_18EE` repo → Settings → Secrets and variables →
Actions → New repository secret, add:
- `SMOKE_EMAIL` = the robot email
- `SMOKE_PASSWORD` = the robot password

(No commit — secrets are stored in GitHub, never in the repo.)

- [ ] **Step 6: Verify CI (after the user pushes)**

When the user pushes `main`, the "Portal Smoke Test" workflow runs
automatically. The manual run button (Actions → Portal Smoke Test → Run
workflow) lets them choose `staging` or `live`. Confirm a green check.

---

## Self-review notes

- **Spec coverage:** smoke-only ✓ (Task 5); portal-only main pages ✓ (Task 2);
  login + all pages load ✓ (Tasks 4–5); both staging & live switchable ✓
  (Task 3 `SMOKE_ENV`); dedicated robot account ✓ (Task 7); automatic on push +
  manual button ✓ (Task 6); read-only ✓ (Task 5 only navigates/reads);
  screenshots/traces on failure ✓ (Task 3 `use`); straight onto `main` ✓.
- **Out-of-scope items** (Odoo, reports deep-dive, mobile, CI-built app) are not
  implemented, per spec.
- **Type/name consistency:** `ROUTES` (Task 2) used in Task 5; `.auth/portal.json`
  written in Task 4 and read in Task 3; `SMOKE_ENV`/`SMOKE_EMAIL`/`SMOKE_PASSWORD`
  consistent across Tasks 3, 4, 6, 7. Selectors (`you@example.com`,
  `Enter your password`, `Sign in`) match `src/app/login/page.tsx`.
- **Note:** Full end-to-end verification (actually running the tests) is gated on
  the user supplying robot credentials in Task 7. Tasks 1–6 are verified
  structurally via `playwright test --list`.
```
