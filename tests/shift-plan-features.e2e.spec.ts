import { test, expect, type Page } from '@playwright/test';

/**
 * F1 (per-shift requirements) + F2 (duplicate a week) e2e on staging.
 * Seeds an open shift via the authenticated API, drives the real
 * /shifts → Manage Shifts screen for the edit sheet + Duplicate sheet, and
 * asserts the duplicate endpoint's behaviour (create once, dedup on re-run)
 * directly so the check doesn't race a transient toast.
 *   SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD (admin — sees What a Jerk / co6)
 */
const ADMIN = {
  email: process.env.SMOKE_ADMIN_EMAIL || 'biz@krawings.de',
  password: process.env.SMOKE_ADMIN_PASSWORD || 'test1234',
};
const COMPANY = 6;
const NOTE = 'E2E-DUP';

const todayISO = (): string => new Date().toISOString().slice(0, 10);

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ISO-8601 week key "YYYY-Www" (matches the app's Berlin week key at noon). */
function isoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  d.setUTCDate(d.getUTCDate() - day + 3); // Thursday of this ISO week
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function deleteNotedSlots(page: Page, week: string): Promise<void> {
  const res = await page.request.get(`/api/shifts/manage?company_id=${COMPANY}&week=${week}`);
  if (!res.ok()) return;
  const slots = (await res.json()).slots ?? [];
  for (const s of slots) {
    if (String(s.note ?? '').includes(NOTE)) {
      await page.request.delete(`/api/shifts/slots/${s.id}?company_id=${COMPANY}`).catch(() => {});
    }
  }
}

test('edit sheet sets skill; Duplicate sheet renders; duplicate endpoint creates then dedups', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(ADMIN.email);
  await page.getByPlaceholder('Enter your password').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  await context.addCookies([
    { name: 'kw_company_id', value: String(COMPANY), domain: new URL(page.url()).hostname, path: '/' },
  ]);

  const date = todayISO();
  const week = isoWeekKey(date);
  // An isolated far-future week for the deterministic endpoint check (no real data
  // there, so copying a whole day can't pollute the live schedule).
  const farDate = addDays(date, 140);
  const farWeek = isoWeekKey(farDate);
  const farNext = isoWeekKey(addDays(farDate, 7));

  // Start clean, then seed one open shift today (for the UI) + one far out (for the API).
  await deleteNotedSlots(page, week);
  await deleteNotedSlots(page, farWeek);
  await deleteNotedSlots(page, farNext);
  const seed = await page.request.post('/api/shifts/slots', {
    data: { company_id: COMPANY, date, start: '10:00', end: '14:00', note: NOTE },
  });
  expect(seed.ok()).toBeTruthy();

  try {
    // The seed is visible in the source week (also proves the week key is right).
    const check = await page.request.get(`/api/shifts/manage?company_id=${COMPANY}&week=${week}`);
    const seeded = (await check.json()).slots.filter((s: { note?: string }) => String(s.note ?? '').includes(NOTE));
    expect(seeded.length).toBe(1);

    await page.goto('/shifts');
    await page.getByText('Manage Shifts', { exact: true }).click();

    // --- Feature 1: edit sheet exposes the skill gate; the choice persists ---
    // (Department picker renders only when the company has hr.departments; co6 has none.)
    await page.getByText(NOTE).first().click();
    await expect(page.getByText('Who can take it')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Level 2+', exact: true }).click();
    await page.getByRole('button', { name: /Save changes/i }).click();
    await expect(page.getByText(/Shift updated/i)).toBeVisible({ timeout: 20_000 });
    await page.getByText(NOTE).first().click();
    await expect(page.getByRole('button', { name: 'Level 2+', exact: true })).toHaveClass(/border-green-600/);
    await page.getByRole('button', { name: /^Cancel$/ }).click();

    // --- Feature 2a: the Duplicate sheet renders with days + repeat options ---
    await page.getByRole('button', { name: /Duplicate…/ }).click();
    await expect(page.getByText('Duplicate this week')).toBeVisible();
    await expect(page.getByRole('button', { name: /Once \(next week\)/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Every week/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Duplicate$/ })).toBeVisible();
    await page.getByRole('button', { name: /^Cancel$/ }).click();

    // --- Feature 2b: the endpoint creates once, then dedups on a re-run ---
    // Isolated far-future week with a single seeded shift → deterministic counts.
    const seedFar = await page.request.post('/api/shifts/slots', {
      data: { company_id: COMPANY, date: farDate, start: '10:00', end: '14:00', note: NOTE },
    });
    expect(seedFar.ok()).toBeTruthy();

    const d1 = await page.request.post('/api/shifts/duplicate', {
      data: { company_id: COMPANY, source_week: farWeek, source_dates: [farDate], repeat: 'once' },
    });
    expect(d1.ok()).toBeTruthy();
    expect((await d1.json()).created).toBe(1);

    const d2 = await page.request.post('/api/shifts/duplicate', {
      data: { company_id: COMPANY, source_week: farWeek, source_dates: [farDate], repeat: 'once' },
    });
    const j2 = await d2.json();
    expect(j2.created).toBe(0); // idempotent re-run — never double-books
    expect(j2.skipped).toBe(1);
  } finally {
    await deleteNotedSlots(page, week);
    await deleteNotedSlots(page, farWeek);
    await deleteNotedSlots(page, farNext);
  }
});
