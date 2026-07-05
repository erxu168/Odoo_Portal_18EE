import { test as setup, expect } from '@playwright/test';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

const AUTH_FILE = '.auth/portal.json';

setup('log in to the portal', async ({ page }) => {
  const email = process.env.SMOKE_EMAIL;
  const password = process.env.SMOKE_PASSWORD;

  // No robot credentials (local dev / CI without secrets): don't fail the whole
  // run. Write an empty session so dependent projects can still load a storage
  // state, and skip — the `smoke` tests skip themselves too. Set SMOKE_EMAIL /
  // SMOKE_PASSWORD (e.g. a robot admin account) to enable the real login smoke.
  if (!email || !password) {
    mkdirSync(dirname(AUTH_FILE), { recursive: true });
    await page.context().storageState({ path: AUTH_FILE });
    setup.skip(true, 'SMOKE_EMAIL/SMOKE_PASSWORD not set — skipping login smoke');
    return;
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
