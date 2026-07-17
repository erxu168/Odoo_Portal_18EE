import { test, expect } from '@playwright/test';

/**
 * Shift-template minimum-skill e2e — drives the real /shifts → Create Shift form
 * on staging. Verifies that a template carrying a skill requirement pre-fills the
 * "Who can take it" gate, and that an unrestricted template clears a prior one.
 *
 * Staging data (What a Jerk / co6): "Opening Shift" + "late Evening Shift" require
 * Level 2+; "Mid day Shift" is Anyone.
 *   SMOKE_MANAGER_EMAIL / SMOKE_MANAGER_PASSWORD (a manager or admin)
 */
const MGR = {
  email: process.env.SMOKE_ADMIN_EMAIL || 'biz@krawings.de',
  password: process.env.SMOKE_ADMIN_PASSWORD || 'test1234',
};

test('templates pre-fill the skill gate; an Anyone template clears a prior restriction', async ({ page, context }) => {
  // Log in as a manager.
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(MGR.email);
  await page.getByPlaceholder('Enter your password').fill(MGR.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });

  // Pin the active company to What a Jerk (co6) — templates are company-scoped.
  await context.addCookies([
    { name: 'kw_company_id', value: '6', domain: new URL(page.url()).hostname, path: '/' },
  ]);

  // Open the Create Shift form.
  await page.goto('/shifts');
  await page.getByText('Create Shift', { exact: true }).click();
  await expect(page.getByRole('heading', { name: /New Shift/i })).toBeVisible({ timeout: 20_000 });

  // Restricted templates carry a visible L2+ badge; unrestricted ones do not.
  const opening = page.getByRole('button', { name: /Opening Shift ·/i });
  await expect(opening).toBeVisible({ timeout: 20_000 });
  await expect(opening).toContainText('L2+');
  const midday = page.getByRole('button', { name: /Mid day Shift ·/i });
  await expect(midday).not.toContainText('L2+');

  // Apply the Opening template → the skill gate jumps to Level 2+.
  await opening.click();
  await expect(page.getByText(/Only Level 2 and Level 3 staff will be able to claim it/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Level 2+', exact: true })).toHaveClass(/border-green-600/);

  // Apply an Anyone template → the gate resets (restriction hint gone, "Anyone" selected).
  await midday.click();
  await expect(page.getByText(/will be able to claim it/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Anyone', exact: true })).toHaveClass(/border-green-600/);

  // Job-position roles were cleaned up to exactly Trainee / Associate / Team Lead —
  // the shift-name "roles" (Opening / Mid / Closing) are gone.
  await expect(page.getByRole('button', { name: 'Trainee', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Associate', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Team Lead', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Opening', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mid', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Closing', exact: true })).toHaveCount(0);
});
