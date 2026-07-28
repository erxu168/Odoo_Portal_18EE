/**
 * E2E: guided tutorials (Task Manager) — real-browser, staging.
 *
 * Exercises the full stack through an authenticated browser session: the
 * manager guide read, step-media serving, an aggregate save round-trip + the
 * optimistic-concurrency 409, the staff daily-snapshot read, and the manager
 * template page render. Targets the migrated "Grill Station Setup" guide
 * (template 4 / line 41; daily snapshot line 252).
 *
 * Env (defaults target staging): SMOKE_ADMIN_EMAIL / SMOKE_ADMIN_PASSWORD
 */
import { test, expect, Page } from '@playwright/test';

const ADMIN = {
  email: process.env.SMOKE_ADMIN_EMAIL || 'biz@krawings.de',
  password: process.env.SMOKE_ADMIN_PASSWORD || 'test1234',
};
const TEMPLATE_ID = 4;
const LINE_ID = 41;
const DAILY_LINE_ID = 252;

async function login(page: Page, email: string, password: string) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('Enter your password').fill(password);
  const btn = page.getByRole('button', { name: /sign in|log in|anmelden/i });
  if (await btn.count()) await btn.first().click(); else await page.keyboard.press('Enter');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25_000 });
}

test('unauthenticated guide API is not readable', async ({ request }) => {
  const r = await request.get(`/api/tasks/templates/${TEMPLATE_ID}/lines/${LINE_ID}/guide`, {
    failOnStatusCode: false, maxRedirects: 0,
  });
  expect(r.status()).not.toBe(200);
});

test('guided tutorial full stack: read, media, save round-trip, 409, staff read, page render', async ({ page }) => {
  await login(page, ADMIN.email, ADMIN.password);

  // 1) Manager reads the migrated guide.
  const r = await page.request.get(`/api/tasks/templates/${TEMPLATE_ID}/lines/${LINE_ID}/guide`);
  expect(r.ok()).toBeTruthy();
  const guide = await r.json();
  expect(guide.published).toBe(true);
  expect(Array.isArray(guide.steps)).toBeTruthy();
  expect(guide.steps.length).toBeGreaterThan(0);
  const step = guide.steps[0];
  expect(step.media_type).toBe('photo');
  expect(step.has_image).toBe(true);
  expect(step.pins.length).toBe(2);

  // 2) The step's photo serves as an image.
  const media = await page.request.get(
    `/api/tasks/templates/${TEMPLATE_ID}/lines/${LINE_ID}/guide/steps/${step.id}/media`,
  );
  expect(media.ok()).toBeTruthy();
  expect(media.headers()['content-type'] || '').toContain('image/');

  // 3) Aggregate save round-trip (keep the photo — no base64 re-sent). Revision bumps.
  const keptSteps = [{
    id: step.id,
    media_type: 'photo',
    explanation: step.explanation,
    pins: step.pins.map((p: { pin_x: number; pin_y: number; note: string }) => ({ pin_x: p.pin_x, pin_y: p.pin_y, note: p.note })),
  }];
  const put = await page.request.put(`/api/tasks/templates/${TEMPLATE_ID}/lines/${LINE_ID}/guide`, {
    data: { revision: guide.revision, published: true, steps: keptSteps },
  });
  expect(put.ok()).toBeTruthy();
  const putBody = await put.json();
  expect(putBody.revision).toBe(guide.revision + 1);

  // 4) A stale revision now conflicts (409), not last-write-wins.
  const stale = await page.request.put(`/api/tasks/templates/${TEMPLATE_ID}/lines/${LINE_ID}/guide`, {
    data: { revision: guide.revision, published: true, steps: keptSteps },
    failOnStatusCode: false,
  });
  expect(stale.status()).toBe(409);

  // 5) Staff read the daily snapshot (still shows the photo step + pins).
  const s = await page.request.get(`/api/tasks/lines/${DAILY_LINE_ID}/guide`);
  expect(s.ok()).toBeTruthy();
  const staffGuide = await s.json();
  expect(staffGuide.steps.length).toBeGreaterThan(0);
  expect(staffGuide.steps[0].media_type).toBe('photo');
  expect(staffGuide.steps[0].pins.length).toBe(2);

  // 6) The manager template page renders and shows the line.
  await page.goto(`/tasks/manager/templates/${TEMPLATE_ID}`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Grill Station Setup').first()).toBeVisible({ timeout: 20_000 });
});
