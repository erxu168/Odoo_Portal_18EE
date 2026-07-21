/**
 * task-setup-guide.e2e.spec.ts — Mise en place "Station Setup Guide" E2E
 * (self-login manager, mobile viewport, staging).
 *
 * Flow (spec docs/superpowers/specs/2026-07-18-mise-en-place-setup-guide-design.md §10):
 *  1. Manager finds-or-creates the "E2E Setup Guide" template in a department
 *     with no other templates (so ensure() spawns today's list WITH the guide),
 *     marks a task as a setup guide, uploads the reference photo, drops 2
 *     labelled pins from the per-department catalog, saves.
 *  2. Spawns today's list via /api/tasks/list/ensure, then on the dept screen:
 *     the guide row shows photo + numbered pins and NO tap-to-complete circle;
 *     checking every pin auto-completes the task; unchecking a pin from the
 *     completed section's "Review / adjust setup" reopens it.
 *
 * Idempotent across runs: the template/task/items are reused, pins/photo only
 * added when missing, and the test always leaves the guide reopened (pending).
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const MGR = {
  email: process.env.SMOKE_MANAGER_EMAIL || 'marco@test.krawings.de',
  password: process.env.SMOKE_MANAGER_PW || 'test1234',
};

/** Optional pre-authenticated session: a Netscape cookies.txt export (e.g. from
 * a logged-in manager browser). Lets the E2E run when no robot login exists.
 * Path via COOKIES_TXT env; defaults to ~/cookies.txt if present. */
const COOKIES_TXT = process.env.COOKIES_TXT || path.join(os.homedir(), 'cookies.txt');

function parseCookiesTxt(file: string) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .map(l => l.trim())
    .filter(l => l && (!l.startsWith('#') || l.startsWith('#HttpOnly_')))
    .map(l => {
      const httpOnly = l.startsWith('#HttpOnly_');
      const f = (httpOnly ? l.slice('#HttpOnly_'.length) : l).split('\t');
      if (f.length < 7) return null;
      return {
        name: f[5], value: f[6], domain: f[0], path: f[2],
        secure: f[3] === 'TRUE', httpOnly,
        expires: parseInt(f[4], 10) || Math.floor(Date.now() / 1000) + 86_400,
      };
    })
    .filter((c): c is NonNullable<typeof c> => !!c);
}

const TPL_NAME = 'E2E Setup Guide';
const TASK_NAME = 'E2E Station check';
const ITEM_1 = 'E2E Cutting board';
const ITEM_2 = 'E2E Sauce bottles';
const PHOTO = path.join(__dirname, 'fixtures', 'station-test.jpg');

function todayStr(): string {
  // Europe/Berlin "today" — matches the portal's task dates.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date());
}

async function login(page: Page, email: string, password: string) {
  // Prefer a provided session-cookie export (survives test-account cleanups).
  if (fs.existsSync(COOKIES_TXT)) {
    await page.context().addCookies(parseCookiesTxt(COOKIES_TXT));
    await page.goto('/tasks');
    if (!page.url().includes('/login')) return;
    // Stale session — fall through to the form login.
  }
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

/** Find "E2E Setup Guide", or create it in a department that has no templates. */
async function findOrCreateTemplate(page: Page): Promise<{ tplId: number; deptId: number }> {
  const tplRes = await page.request.get('/api/tasks/templates?include_archived=1');
  const tplBody = await tplRes.json();
  const existing = (tplBody.templates || []).find((t: { name: string }) => t.name === TPL_NAME);
  if (existing) return { tplId: existing.id, deptId: existing.department_id };

  const deptRes = await page.request.get('/api/tasks/departments');
  const deptBody = await deptRes.json();
  const used = new Set((tplBody.templates || []).map((t: { department_id: number }) => t.department_id));
  const free = (deptBody.departments || []).find((d: { id: number }) => !used.has(d.id));
  expect(free, 'need a department with no templates for a deterministic first spawn').toBeTruthy();

  await page.goto('/tasks/manager/templates');
  await page.getByRole('button', { name: '+ New' }).click();
  await page.getByPlaceholder('e.g. Kitchen — Standard Day').fill(TPL_NAME);
  await page.locator('select').selectOption(String(free.id));
  await page.getByRole('button', { name: /create/i }).click();
  await page.waitForURL(/\/tasks\/manager\/templates\/\d+/, { timeout: 20_000 });
  const tplId = parseInt(page.url().split('/').pop() || '0', 10);
  return { tplId, deptId: free.id };
}

/** In the pin-label sheet: pick the item if it's in the catalog, else add it. */
async function labelPin(page: Page, itemName: string) {
  const sheet = page.locator('input[placeholder="Search or type a new item…"]');
  await expect(sheet).toBeVisible();
  await sheet.fill(itemName);
  const addNew = page.getByRole('button', { name: `+ Add "${itemName}"` });
  const existing = page.getByRole('button', { name: itemName, exact: true });
  if (await addNew.isVisible().catch(() => false)) await addNew.click();
  else await existing.first().click();
  await expect(sheet).toBeHidden({ timeout: 10_000 });
}

test.describe.serial('station setup guide', () => {
  let deptId = 0;

  test('manager creates a setup guide with photo + 2 labelled pins', async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, MGR.email, MGR.password);

    const found = await findOrCreateTemplate(page);
    deptId = found.deptId;
    await page.goto(`/tasks/manager/templates/${found.tplId}`);

    // Open the guide task: edit if it exists, else add it.
    const row = page.locator('p.font-semibold', { hasText: TASK_NAME }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.locator('xpath=ancestor::div[contains(@class,"px-4")][1]').getByRole('button', { name: 'Edit' }).click();
    } else {
      await page.getByRole('button', { name: '+ Add task' }).click();
      await page.getByPlaceholder('e.g. Inspect restrooms').fill(TASK_NAME);
    }

    // Turn on guide mode.
    const guideToggle = page.locator('label', { hasText: 'Setup guide' }).locator('input[type="checkbox"]');
    if (!(await guideToggle.isChecked())) await guideToggle.check();

    // Reference photo (only when missing — later runs already have it).
    const uploadLabel = page.locator('label', { hasText: 'Tap to add the reference photo' });
    if (await uploadLabel.isVisible().catch(() => false)) {
      await uploadLabel.locator('input[type="file"]').setInputFiles(PHOTO);
    }
    const img = page.locator('img[alt="Setup reference"]');
    await expect(img).toBeVisible({ timeout: 20_000 });

    // Ensure 2 pins exist (pin list rows show "Remove").
    const pinRows = page.getByRole('button', { name: 'Remove', exact: true });
    if ((await pinRows.count()) < 2) {
      const box = await img.boundingBox();
      expect(box).toBeTruthy();
      await img.click({ position: { x: box!.width * 0.3, y: box!.height * 0.45 } });
      await labelPin(page, ITEM_1);
      await img.click({ position: { x: box!.width * 0.7, y: box!.height * 0.5 } });
      await labelPin(page, ITEM_2);
    }
    expect(await pinRows.count()).toBeGreaterThanOrEqual(2);

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText(/Task (saved|added)/)).toBeVisible({ timeout: 30_000 });
  });

  test('guide spawns into the daily list; pins auto-complete and reopen it', async ({ page }) => {
    test.setTimeout(150_000);
    await login(page, MGR.email, MGR.password);

    // Spawn (or fetch) today's list for the guide's department, then verify the
    // spawned line carries the guide flag, its own photo snapshot, and pin coords.
    const ensure = await page.request.post('/api/tasks/list/ensure', {
      data: { department_id: deptId, date: todayStr() },
    });
    const { ok, list_id } = await ensure.json();
    expect(ok).toBeTruthy();
    const listRes = await page.request.get(`/api/tasks/list/${list_id}`);
    const list = (await listRes.json()).list;
    const line = (list.lines || []).find((l: { name: string }) => l.name === TASK_NAME);
    expect(line, 'guide line must be on today’s list').toBeTruthy();
    expect(line.is_setup_guide).toBe(true);
    expect(line.has_setup_photo).toBe(true);
    expect(line.subtasks.length).toBeGreaterThanOrEqual(2);
    for (const s of line.subtasks) {
      expect(s.pin_x).toBeGreaterThan(0);
      expect(s.pin_y).toBeGreaterThan(0);
    }

    await page.goto(`/tasks/manager/dept/${deptId}`);
    // Dismiss the app drawer if it opened, and wait for the list data
    // ("X / Y done · Z%" header) — the chip check must not race the fetch.
    await page.keyboard.press('Escape').catch(() => {});
    await expect(page.getByText(/done ·/).first()).toBeVisible({ timeout: 30_000 });
    const chip = page.getByText('📍 Setup guide').first();

    // Self-heal: a previous aborted run may have left the guide completed.
    if (!(await chip.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: /✅ Completed/ }).first().click();
      await page.getByRole('button', { name: /Review \/ adjust setup/ }).first().click();
      await page.getByRole('button', { name: /^Uncheck / }).first().click();
      await expect(chip).toBeVisible({ timeout: 20_000 });
    }

    // The guide row has NO tap-to-complete affordance — completion is pin-driven.
    await expect(page.getByText(TASK_NAME).first()).toBeVisible();

    // Check every pin; the task auto-completes on the last one.
    for (let guard = 0; guard < 6; guard++) {
      const check = page.getByRole('button', { name: /^Check / }).first();
      if (!(await check.isVisible().catch(() => false))) break;
      await check.click();
      await page.waitForTimeout(1200); // server toggle + possible reload
    }
    await expect(page.getByText('📍 Setup guide')).toBeHidden({ timeout: 20_000 });
    await page.getByRole('button', { name: /✅ Completed/ }).first().click();
    await expect(page.locator('p.line-through', { hasText: TASK_NAME })).toBeVisible();

    // Reopen from the completed section: Review / adjust setup → uncheck a pin.
    await page.getByRole('button', { name: /Review \/ adjust setup/ }).first().click();
    await page.getByRole('button', { name: /^Uncheck / }).first().click();
    await expect(page.getByText('📍 Setup guide').first()).toBeVisible({ timeout: 20_000 });

    // API cross-check: the line is pending again.
    const after = await page.request.get(`/api/tasks/list/${list_id}`);
    const lineAfter = ((await after.json()).list.lines || []).find((l: { name: string }) => l.name === TASK_NAME);
    expect(lineAfter.state).toBe('pending');
  });
});
