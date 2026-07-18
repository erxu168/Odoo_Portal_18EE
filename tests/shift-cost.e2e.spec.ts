import { test, expect } from '@playwright/test';

/**
 * F3 (fully-loaded shift cost incl. employer/AG on-costs) e2e on staging.
 * Checks the Settings "Labour cost" section, the manage API cost fields, and
 * that a euro figure surfaces in the planner + edit sheet.
 *   SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD (admin — sees What a Jerk / co6)
 */
const ADMIN = {
  email: process.env.SMOKE_ADMIN_EMAIL || 'biz@krawings.de',
  password: process.env.SMOKE_ADMIN_PASSWORD || 'test1234',
};
const COMPANY = 6;
const NOTE = 'E2E-COST';

const todayISO = (): string => new Date().toISOString().slice(0, 10);

function isoWeekKey(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week =
    1 + Math.round(((d.getTime() - firstThu.getTime()) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

test('Labour cost settings + per-shift/day/week cost on the planner', async ({ page, context }) => {
  await page.goto('/login');
  await page.getByPlaceholder('you@example.com').fill(ADMIN.email);
  await page.getByPlaceholder('Enter your password').fill(ADMIN.password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
  await context.addCookies([
    { name: 'kw_company_id', value: String(COMPANY), domain: new URL(page.url()).hostname, path: '/' },
  ]);

  // Pin known employer on-cost rates so the cost math is deterministic.
  const put = await page.request.put(`/api/shifts/settings?company_id=${COMPANY}`, {
    data: { company_id: COMPANY, agCostMinijob: 30, agCostRegular: 21 },
  });
  expect(put.ok()).toBeTruthy();
  const putBody = await put.json();
  expect(putBody.agCostRegular).toBe(21);
  expect(putBody.agCostMinijob).toBe(30);

  const date = todayISO();
  const week = isoWeekKey(date);

  // Clean, then seed a 4-hour OPEN shift today.
  const clean = async () => {
    const r = await page.request.get(`/api/shifts/manage?company_id=${COMPANY}&week=${week}`);
    for (const s of (await r.json()).slots ?? []) {
      if (String(s.note ?? '').includes(NOTE)) {
        await page.request.delete(`/api/shifts/slots/${s.id}?company_id=${COMPANY}`).catch(() => {});
      }
    }
  };
  await clean();
  const seed = await page.request.post('/api/shifts/slots', {
    data: { company_id: COMPANY, date, start: '10:00', end: '14:00', note: NOTE },
  });
  expect(seed.ok()).toBeTruthy();

  try {
    // API: the seeded 4h open shift is priced at min wage × (1 + 21%) = 4×13.90×1.21 = 67.28,
    // flagged estimated; week total is present.
    const m = await page.request.get(`/api/shifts/manage?company_id=${COMPANY}&week=${week}`);
    const mj = await m.json();
    const slot = mj.slots.find((s: { note?: string }) => String(s.note ?? '').includes(NOTE));
    expect(slot.cost).toBe(67.28);
    expect(slot.costEstimated).toBe(true);
    expect(typeof mj.totals.costWeek).toBe('number');

    // UI: the Settings "Labour cost" section renders.
    await page.goto('/shifts');
    await page.getByRole('button', { name: /Shift settings/i }).click();
    await expect(page.getByText('Labour cost')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Employer costs — Minijob/)).toBeVisible();

    // UI: the planner shows a euro figure (week total) and the edit sheet shows the shift cost.
    await page.goto('/shifts');
    await page.getByText('Manage Shifts', { exact: true }).click();
    await expect(page.getByText(/€/).first()).toBeVisible({ timeout: 20_000 });
    await page.getByText(NOTE).first().click();
    // The edit-sheet cost line shows the amount AND the label (one element → uniquely visible).
    await expect(page.getByText(/67[.,]28.*incl\. employer costs/i)).toBeVisible({ timeout: 20_000 });
  } finally {
    await clean();
  }
});
