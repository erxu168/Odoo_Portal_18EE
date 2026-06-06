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
